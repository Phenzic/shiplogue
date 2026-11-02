import * as vscode from "vscode";

export type DetailLevel = "concise" | "standard" | "elaborate";
export type Tone = "neutral" | "junior" | "mid" | "senior";

// Small typed wrapper over globalState (first-run flag, reminder log).
// The stand-up format itself is fixed — see the base template in summarize.ts.
export class State {
  constructor(private ctx: vscode.ExtensionContext) {}

  hasDetail(): boolean {
    return this.ctx.globalState.get<DetailLevel>("detail") !== undefined;
  }

  getDetail(): DetailLevel {
    return this.ctx.globalState.get<DetailLevel>("detail", "concise");
  }

  setDetail(d: DetailLevel): Thenable<void> {
    return this.ctx.globalState.update("detail", d);
  }

  getTone(): Tone {
    return this.ctx.globalState.get<Tone>("tone", "neutral");
  }

  setTone(t: Tone): Thenable<void> {
    return this.ctx.globalState.update("tone", t);
  }

  isSetupDone(): boolean {
    return this.ctx.globalState.get<boolean>("setupDone", false);
  }
  setSetupDone(): Thenable<void> {
    return this.ctx.globalState.update("setupDone", true);
  }

  getLastReminderYmd(): string {
    return this.ctx.globalState.get<string>("lastReminderYmd", "");
  }
  setLastReminderYmd(ymd: string): Thenable<void> {
    return this.ctx.globalState.update("lastReminderYmd", ymd);
  }

  // --- Feedback loop (Q2): all local counters/flags; nothing is transmitted.
  getSuccessfulDrafts(): number {
    return this.ctx.globalState.get<number>("successfulDrafts", 0);
  }
  setSuccessfulDrafts(n: number): Thenable<void> {
    return this.ctx.globalState.update("successfulDrafts", n);
  }
  getFeedbackPromptedVersion(): string {
    return this.ctx.globalState.get<string>("feedbackPromptedVersion", "");
  }
  setFeedbackPromptedVersion(v: string): Thenable<void> {
    return this.ctx.globalState.update("feedbackPromptedVersion", v);
  }
  getFeedbackSnoozedUntil(): number {
    return this.ctx.globalState.get<number>("feedbackSnoozedUntil", 0);
  }
  setFeedbackSnoozedUntil(ms: number): Thenable<void> {
    return this.ctx.globalState.update("feedbackSnoozedUntil", ms);
  }
  getFeedbackOptOut(): boolean {
    return this.ctx.globalState.get<boolean>("feedbackOptOut", false);
  }
  setFeedbackOptOut(v: boolean): Thenable<void> {
    return this.ctx.globalState.update("feedbackOptOut", v);
  }
  getLastRating(): number {
    return this.ctx.globalState.get<number>("lastRating", 0);
  }
  setLastRating(n: number): Thenable<void> {
    return this.ctx.globalState.update("lastRating", n);
  }
  // One-time migration flag: legacy webhook.type/url → posting.targets.
  getPostingMigrated(): boolean {
    return this.ctx.globalState.get<boolean>("postingMigrated", false);
  }
  setPostingMigrated(): Thenable<void> {
    return this.ctx.globalState.update("postingMigrated", true);
  }

  // Auto-post (P1): once-per-day marker, per-target dedupe log, and the last
  // failed draft kept for manual recovery.
  getLastAutoPostYmd(): string {
    return this.ctx.globalState.get<string>("lastAutoPostYmd", "");
  }
  setLastAutoPostYmd(v: string): Thenable<void> {
    return this.ctx.globalState.update("lastAutoPostYmd", v);
  }
  getAutoPostPostedTargets(): Record<string, string[]> {
    return this.ctx.globalState.get<Record<string, string[]>>("autoPostPostedTargets", {});
  }
  setAutoPostPostedTargets(v: Record<string, string[]>): Thenable<void> {
    return this.ctx.globalState.update("autoPostPostedTargets", v);
  }
  getAutoPostPendingDraft(): string {
    return this.ctx.globalState.get<string>("autoPostPendingDraft", "");
  }
  setAutoPostPendingDraft(md: string): Thenable<void> {
    return this.ctx.globalState.update("autoPostPendingDraft", md);
  }

  getStarPromptedVersion(): string {
    return this.ctx.globalState.get<string>("starPromptedVersion", "");
  }
  setStarPromptedVersion(v: string): Thenable<void> {
    return this.ctx.globalState.update("starPromptedVersion", v);
  }
}
