// The local event store: one JSONL file per day under
// ~/.shiplogue/agent/events/YYYY-MM-DD.jsonl. Append-only, redacted on write,
// deduped, pruned to the retention window. Readers tolerate corrupt lines and
// refuse unknown newer schema versions.
import * as fs from "fs";
import * as path from "path";
import { AgentEvent, AgentEventDraft } from "../types";
import {
  SchemaVersionError,
  SCHEMA_VERSION,
  parseEventLine,
} from "./schema";
import { DedupeSet, computeEventId, workspaceIdFor } from "./dedupe";
import { CAPS, redactAndCap, shouldSkipPath } from "./redact";

export { SchemaVersionError };

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export class EventStore {
  private readonly dedupe = new DedupeSet();
  private readonly primedDays = new Set<string>();

  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  dirPath(): string {
    return this.dir;
  }

  private fileFor(key: string): string {
    return path.join(this.dir, `${key}.jsonl`);
  }

  private primIds(key: string): void {
    if (this.primedDays.has(key)) return;
    this.primedDays.add(key);
    try {
      for (const ev of this.readDay(key)) {
        this.dedupe.add(ev.id);
      }
    } catch {
      /* schema mismatch is surfaced on explicit reads */
    }
  }

  /**
   * Append one event. Returns the stored event, or null when the event is
   * skipped (sensitive path) or a duplicate.
   */
  append(draft: AgentEventDraft): AgentEvent | null {
    if (draft.file && shouldSkipPath(draft.file)) {
      return null;
    }
    const workspaceId =
      draft.workspaceId ?? workspaceIdFor(draft.workspaceRoot);
    const ev: AgentEvent = {
      ...draft,
      schemaVersion: SCHEMA_VERSION,
      workspaceId,
      id: computeEventId(draft, workspaceId),
      ...(draft.text
        ? { text: redactAndCap(draft.text, CAPS.text) }
        : {}),
      ...(draft.command
        ? { command: redactAndCap(draft.command, CAPS.toolOutput) }
        : {}),
      ...(draft.diff
        ? {
            diff: {
              ...draft.diff,
              hunks: draft.diff.hunks?.map((h) =>
                redactAndCap(h, CAPS.diff),
              ),
            },
          }
        : {}),
    };
    // JSON round-trips drop undefined; strip them here so append() and
    // readDay() return the same shape.
    for (const key of ["text", "command", "diff", "file"] as const) {
      if (ev[key] === undefined) {
        delete ev[key];
      }
    }

    const key = dayKey(new Date(ev.ts));
    this.primIds(key);
    if (this.dedupe.has(ev.id)) {
      return null;
    }
    this.dedupe.add(ev.id);
    fs.appendFileSync(this.fileFor(key), `${JSON.stringify(ev)}\n`, "utf8");
    return ev;
  }

  readDay(key: string): AgentEvent[] {
    const file = this.fileFor(key);
    if (!fs.existsSync(file)) {
      return [];
    }
    const out: AgentEvent[] = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const ev = parseEventLine(line); // throws SchemaVersionError
      if (ev === null) {
        console.error(`[shiplogue] skipping corrupt event line in ${file}`);
        continue;
      }
      out.push(ev);
    }
    return out.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  readRange(since: Date, until: Date): AgentEvent[] {
    const out: AgentEvent[] = [];
    const cursor = new Date(since);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= until) {
      for (const ev of this.readDay(dayKey(cursor))) {
        const t = new Date(ev.ts);
        if (t >= since && t <= until) {
          out.push(ev);
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }

  countToday(now: Date = new Date()): number {
    return this.readDay(dayKey(now)).length;
  }

  /** Delete day files older than the retention window (0 = keep forever). */
  pruneOld(retentionDays: number, now: Date = new Date()): number {
    if (retentionDays <= 0) {
      return 0;
    }
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffKey = dayKey(cutoff);
    let removed = 0;
    for (const f of fs.readdirSync(this.dir)) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (m && m[1] < cutoffKey) {
        fs.rmSync(path.join(this.dir, f));
        removed++;
      }
    }
    return removed;
  }
}
