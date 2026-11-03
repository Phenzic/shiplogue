import * as vscode from "vscode";
import { CursorPrompt } from "./types";
import { collectAllPrompts } from "./promptSources";
import { cfg } from "./config";

// Keeps a warm picture of prompt activity while the editor runs. The gather
// path still reads fresh data, so a missed poll cannot lose a generation; this
// watcher is what makes capture continuous rather than one-shot.
export class PromptWatcher {
  private timer: NodeJS.Timeout | undefined;
  private cache: CursorPrompt[] = [];
  private running = false;

  constructor(private intervalMs = 15_000) {}

  start(): void {
    if (this.timer) return;
    const tick = () => void this.poll();
    void tick();
    this.timer = setInterval(tick, this.intervalMs);
    this.timer.unref?.();
  }

  async poll(): Promise<void> {
    if (this.running || !cfg().cursorEnabled) return;
    this.running = true;
    try {
      const folders = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? null;
      const now = new Date();
      const since = new Date(now.getTime() - 24 * 3600e3);
      const fresh = await collectAllPrompts(
        since,
        now,
        cfg().scope === "workspace" ? folders : null,
      );
      const seen = new Set(this.cache.map((p) => `${p.ts.slice(0, 16)}|${p.text}`));
      for (const p of fresh) {
        const key = `${p.ts.slice(0, 16)}|${p.text}`;
        if (!seen.has(key)) {
          seen.add(key);
          this.cache.push(p);
        }
      }
      this.cache = this.cache.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 200);
    } catch {
      /* capture must never break activation */
    } finally {
      this.running = false;
    }
  }

  snapshot(): CursorPrompt[] {
    return [...this.cache];
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
