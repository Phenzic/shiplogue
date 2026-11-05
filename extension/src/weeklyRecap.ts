import * as vscode from "vscode";
import { cfg } from "./config";
import { DraftEntry, DraftHistory } from "./draftHistory";
import { StandupStore } from "./standupStore";
import { buildWeeklyRecap } from "./recap";

const LAST_WEEK_KEY = "shiplogue.weeklyRecap.lastWeek";
const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function weekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timeParts(value: string): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return [18, 0];
  return [Math.min(23, Math.max(0, Number(match[1]))), Math.min(59, Math.max(0, Number(match[2])))];
}

function thisWeekOccurrence(now: Date): Date {
  const day = DAY_INDEX[cfg().weeklyRecapDay] ?? 5;
  const [hours, minutes] = timeParts(cfg().weeklyRecapTime);
  // Monday-based week: Thursday must not treat last Friday as this week's due.
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const mondayBasedDay = (day + 6) % 7;
  monday.setDate(monday.getDate() + mondayBasedDay);
  monday.setHours(hours, minutes, 0, 0);
  return monday;
}

function nextOccurrence(now: Date): Date {
  const day = DAY_INDEX[cfg().weeklyRecapDay] ?? 5;
  const [hours, minutes] = timeParts(cfg().weeklyRecapTime);
  const target = new Date(now);
  const offset = (day - target.getDay() + 7) % 7;
  target.setDate(target.getDate() + offset);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 7);
  return target;
}

/**
 * Static weekly recap scheduler. It compiles the daily drafts already stored in
 * StandupStore; it never scans repos, commits, prompts, or the network.
 */
export class WeeklyRecapScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposables: vscode.Disposable[] = [];
  private running = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly history: StandupStore,
    private readonly draftHistory: DraftHistory,
    private readonly onReady: (entry: DraftEntry) => void | Promise<void>,
  ) {}

  start(): void {
    if (this.disposables.length > 0) return;
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("shiplogue.weeklyRecap")) {
          this.stopTimer();
          this.schedule();
          void this.runIfDue().catch(() => {
            /* a config change must not surface an unhandled rejection */
          });
        }
      }),
    );
    void this.runIfDue().catch(() => {
      /* recap must never break activation */
    });
    this.schedule();
  }

  dispose(): void {
    this.stopTimer();
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables = [];
  }

  /** Manual command: compile now and add it to draft history. */
  async generateNow(): Promise<DraftEntry | undefined> {
    return this.generate(true);
  }

  private schedule(): void {
    if (!cfg().weeklyRecapEnabled) return;
    const delay = Math.max(1000, nextOccurrence(new Date()).getTime() - Date.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.generate(false)
        .catch(() => {
          /* keep the scheduler alive after a failed write */
        })
        .finally(() => this.schedule());
    }, delay);
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async runIfDue(): Promise<void> {
    if (!cfg().weeklyRecapEnabled) return;
    const now = new Date();
    const due = thisWeekOccurrence(now);
    if (now.getTime() < due.getTime()) return;
    if (this.context.globalState.get<string>(LAST_WEEK_KEY) === weekKey(now)) return;
    await this.generate(false);
  }

  private async generate(manual: boolean): Promise<DraftEntry | undefined> {
    if (this.running) return undefined;
    this.running = true;
    try {
      const now = new Date();
      if (!manual && !cfg().weeklyRecapEnabled) return undefined;
      const recap = buildWeeklyRecap(this.history.recent(7, now), now);
      if (!recap) return undefined;

      const entry = this.draftHistory.add({
        ts: now.toISOString(),
        markdown: recap.markdown,
        detail: cfg().detail,
        tone: cfg().tone,
        title: recap.title,
        kind: "weekly",
        sources: recap.sources,
        projects: recap.projects,
        projectName: recap.projects.length === 1 ? recap.projects[0] : undefined,
        summary: recap.summary,
      });

      await this.context.globalState.update(LAST_WEEK_KEY, weekKey(now));
      if (!manual) {
        await this.onReady(entry);
      }
      return entry;
    } finally {
      this.running = false;
    }
  }
}
