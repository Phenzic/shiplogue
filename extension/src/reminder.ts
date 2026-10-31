import * as vscode from "vscode";
import { cfg } from "./config";
import { State } from "./state";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Fires a once-a-day local-time notification nudging the user to send their
// stand-up. First run asks what time they want it.
export class Reminder {
  private timer: NodeJS.Timeout | undefined;
  private snoozeUntil = 0;

  constructor(private state: State, private onGenerate: () => void) {}

  // First-time-usage prompt to pick the reminder time.
  async ensureSetup(): Promise<void> {
    if (this.state.isSetupDone()) {
      return;
    }
    await this.pickTime("Shiplogue will nudge you to send your stand-up daily. What time? (24h, local)");
    await this.state.setSetupDone();
  }

  // Used both at setup and by the "Set Reminder Time" command.
  async pickTime(prompt: string): Promise<void> {
    const current = cfg().reminderTime;
    const picked = await vscode.window.showInputBox({
      prompt,
      value: current,
      validateInput: (v) =>
        /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? undefined : "Use 24h HH:MM, e.g. 16:00",
    });
    if (picked) {
      await vscode.workspace
        .getConfiguration("shiplogue")
        .update("reminder.time", picked.trim(), vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Stand-up reminder set for ${picked.trim()} daily.`);
    }
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), 60_000);
    this.tick();
  }

  private tick(): void {
    const c = cfg();
    if (!c.reminderEnabled) {
      return;
    }
    const now = new Date();
    if (now.getTime() < this.snoozeUntil) {
      return;
    }
    if (this.state.getLastReminderYmd() === ymd(now)) {
      return;
    }
    const [h, m] = c.reminderTime.split(":").map(Number);
    const past = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
    if (!past) {
      return;
    }

    // Mark now so we don't re-pop every minute while the toast is open.
    void this.state.setLastReminderYmd(ymd(now));
    vscode.window
      .showInformationMessage("🕓 Time to send your stand-up.", "Generate now", "Snooze 1h")
      .then((choice) => {
        if (choice === "Generate now") {
          this.onGenerate();
        } else if (choice === "Snooze 1h") {
          this.snoozeUntil = Date.now() + 60 * 60 * 1000;
          void this.state.setLastReminderYmd(""); // let it re-fire after the snooze
        }
      });
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
