import * as vscode from "vscode";
import { cfg } from "./config";
import { State } from "./state";
import { FEEDBACK_URL, RATE_URL, REPO_URL } from "./links";

// Feedback & rating prompts. Everything is a local counter — nothing is sent
// unless the user opens a link. Policy: no prompt before a few successful
// drafts, once per extension version, 30-day snooze, permanent opt-out; the
// star nudge fires at most once per version after a 👍.
const THIRTY_DAYS_MS = 30 * 24 * 3600_000;

export async function openFeedback(_backend?: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(FEEDBACK_URL));
}

export async function openStar(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(REPO_URL));
}

export async function openRate(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(RATE_URL));
}

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
    if (!c.feedbackEnabled || this.state.getFeedbackOptOut()) return;
    if (n < c.feedbackPromptAfter) return;

    const promptedThisVersion = this.state.getFeedbackPromptedVersion() === this.version;
    const snoozedUntil = this.state.getFeedbackSnoozedUntil();
    if (promptedThisVersion && (snoozedUntil === 0 || Date.now() < snoozedUntil)) return;

    await this.state.setFeedbackPromptedVersion(this.version);
    const pick = await vscode.window.showInformationMessage(
      "How's Shiplogue working for you?",
      "Share feedback",
      "Star on GitHub",
      "Not now",
      "Don't ask again",
    );
    if (pick === "Share feedback") {
      await openFeedback(backend);
      await this.state.setFeedbackSnoozedUntil(0);
    } else if (pick === "Star on GitHub") {
      await openStar();
      await this.state.setStarPromptedVersion(this.version);
      await this.state.setFeedbackSnoozedUntil(0);
    } else if (pick === "Not now") {
      await this.state.setFeedbackSnoozedUntil(Date.now() + THIRTY_DAYS_MS);
    } else if (pick === "Don't ask again") {
      await this.state.setFeedbackOptOut(true);
    } else {
      await this.state.setFeedbackSnoozedUntil(0); // dismissed: not again this version
    }
  }

  // Panel thumbs. 👎 opens the feedback form; 👍 counts and occasionally asks
  // for a star (once per version).
  async recordThumbs(value: "up" | "down", _backend: string): Promise<void> {
    if (value === "down") {
      await openFeedback();
      return;
    }
    await this.state.setThumbsUp(this.state.getThumbsUp() + 1);
    if (!cfg().feedbackEnabled || this.state.getFeedbackOptOut()) return;
    if (this.state.getStarPromptedVersion() === this.version) return;
    await this.state.setStarPromptedVersion(this.version);
    const pick = await vscode.window.showInformationMessage(
      "If Shiplogue saved you time, a star on GitHub helps others find it.",
      "Star on GitHub",
      "Rate on Marketplace",
      "Not now",
    );
    if (pick === "Star on GitHub") await openStar();
    else if (pick === "Rate on Marketplace") await openRate();
  }
}
