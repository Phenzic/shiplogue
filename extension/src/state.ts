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
}
