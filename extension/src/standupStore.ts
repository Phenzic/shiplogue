import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { StandupCoverage } from "./types";
import type { StandupDocument } from "./standupDocument";
import type { StandupQuality } from "./standupQuality";

// Local, durable stand-up history. One JSON file per day under the extension's
// global storage dir; each file holds at most one record per local workspace.
// This is the fallback users can always open, even when cloud sync is off or
// offline. The cloud remains the long-term history.
export const LOCAL_HISTORY_DAYS = 7;

export type StandupRecord = {
  id: string;
  date: string; // local YYYY-MM-DD
  workspaceId?: string;
  projectName?: string;
  sources?: string[];
  coverage?: StandupCoverage;
  document?: StandupDocument;
  quality?: StandupQuality;
  summary?: { commits: number; files: number; github: number; notes?: string[] };
  markdown: string;
  status: "generated" | "reviewed";
  modelLabel?: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
};

export type HistoryOptions = {
  workspaceId?: string;
  projectName?: string;
  modelLabel?: string;
  sources?: string[];
  coverage?: StandupCoverage;
  document?: StandupDocument;
  quality?: StandupQuality;
  summary?: { commits: number; files: number; github: number; notes?: string[] };
};

export function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export class StandupStore {
  private readonly dir: string;
  private readonly cache = new Map<string, StandupRecord[]>();

  constructor(context: vscode.ExtensionContext) {
    this.dir = path.join(context.globalStorageUri.fsPath, "standups");
    fs.mkdirSync(this.dir, { recursive: true });
    this.loadRecent();
    this.pruneOld();
  }

  private fileFor(date: string): string {
    return path.join(this.dir, `standups-${date}.json`);
  }

  private recordId(date: string, workspaceId?: string): string {
    return `${date}:${workspaceId ?? "all"}`;
  }

  private loadDate(date: string): StandupRecord[] {
    const cached = this.cache.get(date);
    if (cached) return cached;
    let records: StandupRecord[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.fileFor(date), "utf8"));
      if (Array.isArray(raw)) {
        records = raw.filter(
          (r): r is StandupRecord =>
            Boolean(r) &&
            typeof r.markdown === "string" &&
            typeof r.date === "string" &&
            typeof r.id === "string",
        );
      }
    } catch {
      /* missing or corrupt file — treat as no history */
    }
    this.cache.set(date, records);
    return records;
  }

  private persist(date: string): void {
    const records = this.cache.get(date) ?? [];
    const file = this.fileFor(date);
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(records), "utf8");
      fs.renameSync(tmp, file);
    } catch (error) {
      console.error("[shiplogue] failed to write stand-up history:", error);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  private upsert(date: string, record: StandupRecord): StandupRecord {
    const records = this.loadDate(date);
    const index = records.findIndex((r) => r.id === record.id);
    if (index >= 0) {
      records[index] = record;
    } else {
      records.push(record);
    }
    this.cache.set(date, records);
    this.persist(date);
    return record;
  }

  /** Save a freshly generated draft. Regenerating the same day updates it. */
  saveGenerated(markdown: string, options: HistoryOptions = {}, now = new Date()): StandupRecord {
    const date = localDateKey(now);
    const id = this.recordId(date, options.workspaceId);
    const existing = this.loadDate(date).find((r) => r.id === id);
    const timestamp = now.toISOString();
    return this.upsert(date, {
      id,
      date,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      ...(options.projectName ? { projectName: options.projectName } : {}),
      ...(options.modelLabel ? { modelLabel: options.modelLabel } : {}),
      ...(options.sources ? { sources: options.sources } : {}),
      ...(options.coverage ? { coverage: options.coverage } : {}),
      ...(options.document ? { document: options.document } : {}),
      ...(options.quality ? { quality: options.quality } : {}),
      ...(options.summary ? { summary: options.summary } : {}),
      markdown,
      status: "generated",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
  }

  /** Mark the current draft as reviewed and persist the user's final text. */
  markReviewed(markdown: string, options: HistoryOptions = {}, now = new Date()): StandupRecord {
    const date = localDateKey(now);
    const id = this.recordId(date, options.workspaceId);
    const existing = this.loadDate(date).find((r) => r.id === id);
    const timestamp = now.toISOString();
    return this.upsert(date, {
      id,
      date,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : existing?.workspaceId ? { workspaceId: existing.workspaceId } : {}),
      ...(options.projectName ? { projectName: options.projectName } : existing?.projectName ? { projectName: existing.projectName } : {}),
      ...(options.modelLabel ? { modelLabel: options.modelLabel } : existing?.modelLabel ? { modelLabel: existing.modelLabel } : {}),
      ...(options.sources ? { sources: options.sources } : existing?.sources ? { sources: existing.sources } : {}),
      ...(options.coverage ? { coverage: options.coverage } : existing?.coverage ? { coverage: existing.coverage } : {}),
      ...(options.document ? { document: options.document } : existing?.document ? { document: existing.document } : {}),
      ...(options.quality ? { quality: options.quality } : existing?.quality ? { quality: existing.quality } : {}),
      ...(options.summary ? { summary: options.summary } : existing?.summary ? { summary: existing.summary } : {}),
      markdown,
      status: "reviewed",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      reviewedAt: timestamp,
    });
  }

  get(date: string, workspaceId?: string): StandupRecord | undefined {
    const records = this.loadDate(date);
    const matching = workspaceId ? records.filter((r) => r.workspaceId === workspaceId) : records;
    return [...matching].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  /** Yesterday's latest stand-up, read from the in-memory cache (no scan). */
  getYesterday(workspaceId?: string, now = new Date()): StandupRecord | undefined {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return this.get(localDateKey(yesterday), workspaceId);
  }

  /** Newest first, for the history command/fallback UI. */
  recent(days = LOCAL_HISTORY_DAYS, now = new Date()): StandupRecord[] {
    const out: StandupRecord[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      out.push(...this.loadDate(localDateKey(d)));
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Remove day files older than the free-plan window. Returns files removed. */
  pruneOld(days = LOCAL_HISTORY_DAYS, now = new Date()): number {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffKey = localDateKey(cutoff);
    let removed = 0;
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dir);
    } catch {
      return 0;
    }
    for (const file of files) {
      const match = file.match(/^standups-(\d{4}-\d{2}-\d{2})\.json$/);
      if (match && match[1] <= cutoffKey) {
        try {
          fs.rmSync(path.join(this.dir, file));
          this.cache.delete(match[1]);
          removed++;
        } catch {
          /* ignore */
        }
      }
    }
    return removed;
  }

  private loadRecent(now = new Date()): void {
    for (let i = 0; i < LOCAL_HISTORY_DAYS; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      this.loadDate(localDateKey(d));
    }
  }
}
