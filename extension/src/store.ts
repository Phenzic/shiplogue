import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ActivityEvent } from "./types";

// Local, on-disk activity log. One JSON file per day under the extension's
// global storage dir. Nothing here ever leaves the machine.
export class Store {
  private dir: string;
  private buffer: ActivityEvent[] = [];
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.dir = path.join(context.globalStorageUri.fsPath, "activity");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private fileFor(dateKey: string): string {
    return path.join(this.dir, `activity-${dateKey}.json`);
  }

  private static dateKey(d: Date): string {
    // Local YYYY-MM-DD so a "day" matches the user's wall clock.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Queue an event; flushed to disk on a short debounce.
  add(ev: ActivityEvent): void {
    this.buffer.push(ev);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 3000);
    }
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.buffer.length === 0) {
      return;
    }
    const pending = this.buffer;

    // Group by day in case a flush straddles midnight.
    const byDay = new Map<string, ActivityEvent[]>();
    for (const ev of pending) {
      const key = Store.dateKey(new Date(ev.ts));
      const arr = byDay.get(key) ?? [];
      arr.push(ev);
      byDay.set(key, arr);
    }

    // Only clear the buffer for days that were actually written — a failed
    // write re-queues its events (bounded) so activity is never silently lost.
    const failed: ActivityEvent[] = [];
    for (const [key, evs] of byDay) {
      const file = this.fileFor(key);
      const tmp = `${file}.tmp`;
      try {
        const existing = this.readFile(file);
        existing.push(...evs);
        // Temp file + rename: a crash mid-write never leaves a torn JSON file.
        fs.writeFileSync(tmp, JSON.stringify(existing), "utf8");
        fs.renameSync(tmp, file);
      } catch (e) {
        console.error("[shiplogue] failed to write activity — events kept for the next flush:", e);
        failed.push(...evs);
        try {
          fs.rmSync(tmp, { force: true });
        } catch {
          /* ignore */
        }
      }
    }

    if (failed.length === 0) {
      this.buffer = [];
    } else {
      // Bound memory if the disk keeps failing.
      const MAX_REQUEUE = 500;
      if (failed.length > MAX_REQUEUE) {
        console.error(`[shiplogue] dropping ${failed.length - MAX_REQUEUE} activity events — storage keeps failing`);
      }
      this.buffer = failed.slice(0, MAX_REQUEUE);
    }
  }

  // Delete day files older than the retention window (0 = keep forever).
  // Returns the number of files removed.
  pruneOld(retentionDays: number): number {
    if (retentionDays <= 0) {
      return 0;
    }
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffKey = Store.dateKey(cutoff); // YYYY-MM-DD compares lexicographically
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const f of files) {
      const m = f.match(/^activity-(\d{4}-\d{2}-\d{2})\.json$/);
      if (m && m[1] < cutoffKey) {
        try {
          fs.rmSync(path.join(this.dir, f));
          removed++;
        } catch {
          /* ignore */
        }
      }
    }
    if (removed > 0) {
      console.log(`[shiplogue] pruned ${removed} activity file(s) older than ${retentionDays} days`);
    }
    return removed;
  }

  private readFile(file: string): ActivityEvent[] {
    try {
      if (!fs.existsSync(file)) {
        return [];
      }
      return JSON.parse(fs.readFileSync(file, "utf8")) as ActivityEvent[];
    } catch {
      return [];
    }
  }

  // All events between two dates (inclusive of the days they fall in).
  readRange(since: Date, until: Date): ActivityEvent[] {
    this.flush();
    const out: ActivityEvent[] = [];
    const cursor = new Date(since);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= until) {
      const evs = this.readFile(this.fileFor(Store.dateKey(cursor)));
      for (const ev of evs) {
        const t = new Date(ev.ts);
        if (t >= since && t <= until) {
          out.push(ev);
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }
}
