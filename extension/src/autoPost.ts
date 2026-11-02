import * as vscode from "vscode";
import { cfg } from "./config";
import { State } from "./state";
import { isProFeatureEnabled } from "./entitlements";
import { postToWebhook, TargetType } from "./post";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export interface AutoPostDeps {
  // Produces the draft markdown, or undefined when there's no activity / an
  // error (already logged by the producer).
  generateDraft: () => Promise<string | undefined>;
  // Test seams: real defaults are 60 s undo window and exponential backoff.
  undoWindowMs?: number;
  backoffBaseMs?: number;
}

// Scheduled daily auto-posting (Pro feature — entitlement is a local mock
// until billing exists; see entitlements.ts). Works only while the editor is
// running; a cloud-side scheduler is the later phase. Dedupe is per day AND
// per target, so a retry never double-posts a target that already succeeded.
export class AutoPost {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private state: State,
    private deps: AutoPostDeps,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), 60_000);
    void this.tick();
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async tick(now = new Date()): Promise<void> {
    const c = cfg();
    if (!c.autoPostEnabled || this.running) {
      return;
    }
    if (!c.autoPostDays.includes(now.getDay())) {
      return;
    }
    const time = c.autoPostTime || c.reminderTime;
    const [h, m] = time.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) {
      return;
    }
    const past = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
    if (!past) {
      return;
    }
    const day = ymd(now);
    if (this.state.getLastAutoPostYmd() === day) {
      return;
    }
    if (!(await isProFeatureEnabled("autoPost"))) {
      return;
    }

    // Once-a-day semantics: mark the day up front so nothing below (a slow
    // generation, a dismissed prompt, a crash) can retrigger it this day.
    await this.state.setLastAutoPostYmd(day);
    this.running = true;
    try {
      const markdown = await this.deps.generateDraft();
      if (!markdown) {
        vscode.window.showInformationMessage(
          "Shiplogue auto-post: no activity found today — skipping.",
        );
        return;
      }

      const mode = c.autoPostMode;
      if (mode === "review") {
        const pick = await vscode.window.showInformationMessage(
          "Shiplogue: your stand-up draft is ready.",
          "Post now",
          "Open panel",
          "Skip today",
        );
        if (pick === "Post now") {
          await this.postWithRetry(markdown, day);
        } else if (pick === "Open panel") {
          await vscode.commands.executeCommand("shiplogue.generate");
        }
        return;
      }

      // auto mode: 60-second undo window, then post.
      const undo = await Promise.race([
        vscode.window.showInformationMessage(
          "Shiplogue: posting your stand-up in 60 seconds…",
          "Undo",
        ),
        new Promise<void>((r) => setTimeout(r, this.deps.undoWindowMs ?? 60_000)).then(
          () => undefined,
        ),
      ]);
      if (undo === "Undo") {
        return; // not marked as posted — user can post manually
      }
      await this.postWithRetry(markdown, day);
    } finally {
      this.running = false;
    }
  }

  private async postWithRetry(markdown: string, day: string): Promise<void> {
    const attempts = 3;
    let pending: TargetType[] | undefined; // undefined = all targets
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, (this.deps.backoffBaseMs ?? 1000) * 2 ** (attempt - 1)));
      }
      const result = await postToWebhook(markdown, markdown, pending);
      const okTypes = result.results.filter((r) => r.ok).map((r) => r.type);
      const badTypes = result.results.filter((r) => !r.ok).map((r) => r.type);
      if (okTypes.length > 0) {
        // Dedupe per target: remember which targets got today's post.
        const log = this.state.getAutoPostPostedTargets();
        log[day] = [...new Set([...(log[day] ?? []), ...okTypes])];
        await this.state.setAutoPostPostedTargets(log);
      }
      if (badTypes.length === 0) {
        await this.state.setAutoPostPendingDraft("");
        vscode.window.showInformationMessage(`Shiplogue: stand-up auto-posted to ${okTypes.join(", ")}.`);
        return;
      }
      pending = badTypes; // retry only the failed targets
    }

    // All retries exhausted: keep the draft for manual recovery.
    await this.state.setAutoPostPendingDraft(markdown);
    const remaining = (pending ?? []).join(", ");
    const pick = await vscode.window.showErrorMessage(
      `Shiplogue auto-post failed${remaining ? ` (${remaining})` : ""}. Your draft is saved.`,
      "Retry now",
      "Open panel",
    );
    if (pick === "Retry now") {
      await this.postWithRetry(markdown, day);
    } else if (pick === "Open panel") {
      await vscode.commands.executeCommand("shiplogue.generate");
    }
  }
}
