import * as vscode from "vscode";
import { cfg } from "./config";
import { State } from "./state";

// Feedback plumbing. All destinations are constants here. The form vendor is
// TBD (Tally or Google Form); until a form exists, the GitHub feedback issue
// page is used because it works today. Swap FEEDBACK_FORM_URL when the form
// lands — nothing else changes.
export const FEEDBACK_FORM_URL =
  "https://github.com/Phenzic/shiplogue/issues/new?labels=feedback&title=Standup+Draft+feedback";
export const GITHUB_REPO_URL = "https://github.com/Phenzic/shiplogue";
export const MARKETPLACE_REVIEW_URL =
  "https://marketplace.visualstudio.com/items?itemName=phenzic.standup-draft&ssr=false#review-details";

const THIRTY_DAYS_MS = 30 * 24 * 3600_000;

// The form URL carries version/os/backend only — never draft or activity text.
export function feedbackFormUrl(opts: { version: string; backend?: string }): string {
  const q = new URLSearchParams({
    version: opts.version,
    os: process.platform,
    backend: opts.backend ?? "unknown",
  });
  const sep = FEEDBACK_FORM_URL.includes("?") ? "&" : "?";
  return `${FEEDBACK_FORM_URL}${sep}${q.toString()}`;
}

export async function openFeedback(version: string, backend?: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(feedbackFormUrl({ version, backend })));
}

export async function openStar(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(GITHUB_REPO_URL));
}

export async function openRate(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_REVIEW_URL));
}

// The feedback state machine. Prompt policy: no startup modal, no prompt on
// error/cancel, once per extension version, plus a re-prompt after a "Not now"
// snooze expires; "Don't ask again" opts out permanently.
export class Feedback {
  constructor(
    private state: State,
    private version: string,
  ) {}

  // Called only after a draft reaches the panel (never on error/cancel).
  async recordSuccess(backend: string): Promise<void> {
    const n = this.state.getSuccessfulDrafts() + 1;
    await this.state.setSuccessfulDrafts(n);

    const c = cfg();
    if (!c.feedbackEnabled || this.state.getFeedbackOptOut()) {
      return;
    }
    if (n < c.feedbackPromptAfter) {
      return;
    }
    const promptedThisVersion = this.state.getFeedbackPromptedVersion() === this.version;
    const snoozedUntil = this.state.getFeedbackSnoozedUntil();
    if (promptedThisVersion && (snoozedUntil === 0 || Date.now() < snoozedUntil)) {
      return;
    }
    await this.state.setFeedbackPromptedVersion(this.version);
    const pick = await vscode.window.showInformationMessage(
      "How's Standup Draft working for you?",
      "Share feedback",
      "Not now",
      "Don't ask again",
    );
    if (pick === "Share feedback") {
      await openFeedback(this.version, backend);
      await this.state.setFeedbackSnoozedUntil(0);
    } else if (pick === "Not now") {
      await this.state.setFeedbackSnoozedUntil(Date.now() + THIRTY_DAYS_MS);
    } else if (pick === "Don't ask again") {
      await this.state.setFeedbackOptOut(true);
    } else {
      // Dismissed without a choice: don't re-prompt for this version.
      await this.state.setFeedbackSnoozedUntil(0);
    }
  }

  // Panel thumbs. 👎 opens the form (with version/os/backend only). 👍 counts
  // the rating and, once per version, offers the star/rate links.
  async recordThumbs(value: "up" | "down", backend: string): Promise<void> {
    if (value === "down") {
      await openFeedback(this.version, backend);
      return;
    }
    await this.state.setLastRating(this.state.getLastRating() + 1);
    if (!cfg().feedbackEnabled || this.state.getFeedbackOptOut()) {
      return;
    }
    if (this.state.getStarPromptedVersion() === this.version) {
      return;
    }
    await this.state.setStarPromptedVersion(this.version);
    const pick = await vscode.window.showInformationMessage(
      "If Standup Draft saved you time, a star helps others find it.",
      "Star on GitHub",
      "Rate on Marketplace",
      "Not now",
    );
    if (pick === "Star on GitHub") {
      await openStar();
    } else if (pick === "Rate on Marketplace") {
      await openRate();
    }
  }
}
