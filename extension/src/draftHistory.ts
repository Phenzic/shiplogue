import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { cfg } from "./config";
import { DetailLevel, Tone } from "./state";

// Per-draft history for the panel's History tab. Distinct from StandupStore
// (which keeps one record per day/workspace for recaps, reminders and cloud
// sync): this log keeps every generated draft, with its verification and
// send state.
//
// One JSON file in global storage, capped by retention
// (7 days on the free tier) and by entry count. Pro users will additionally
// sync every draft to the cloud (see historySync.ts) and page older drafts
// back into this view — the cursor-based list() contract supports that now.

import type { PanelVerification } from "./panelVerification";

export interface DraftEntry {
  id: string;
  ts: string;
  markdown: string;
  detail: DetailLevel;
  tone: Tone;
  projectName?: string;
  title?: string;
  kind?: "daily" | "weekly";
  sources?: string[];
  projects?: string[];
  modelLabel?: string;
  verification?: PanelVerification;
  summary?: { commits: number; files: number; github: number; notes?: string[] };
  stats?: { durationMs?: number; inputTokens?: number; outputTokens?: number };
  windowHours?: number;
  sentTo: string[];
  scheduled?: { at: string; targets: string[]; status: string };
  copied?: boolean;
  needsReview: boolean;
}

export interface HistoryPage {
  entries: DraftEntry[];
  cursor?: string;
  total: number;
}

interface HistoryFile {
  version: number;
  entries: DraftEntry[];
}

export class DraftHistory {
  private file: string;

  constructor(context: vscode.ExtensionContext) {
    this.file = path.join(context.globalStorageUri.fsPath, "history.json");
  }

  private read(): HistoryFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (Array.isArray(parsed?.entries)) {
        return { version: 1, entries: parsed.entries };
      }
    } catch {
      /* missing or corrupt → start clean */
    }
    return { version: 1, entries: [] };
  }

  private write(entries: DraftEntry[]): void {
    const trimmed = entries.slice(0, Math.max(1, cfg().historyMaxEntries));
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries: trimmed } satisfies HistoryFile), "utf8");
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error("[shiplogue] failed to write draft history:", e);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  add(input: Omit<DraftEntry, "id" | "sentTo" | "needsReview"> & { sentTo?: string[] }): DraftEntry {
    const entry: DraftEntry = {
      ...input,
      id: `${Date.parse(input.ts) || Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      sentTo: input.sentTo ?? [],
      needsReview: input.verification?.needsReview ?? false,
    };
    const { entries } = this.read();
    this.write([entry, ...entries]);
    return entry;
  }

  list(opts: { query?: string; cursor?: string; limit?: number } = {}): HistoryPage {
    const limit = opts.limit ?? 20;
    let entries = this.read().entries.slice().sort((a, b) => b.ts.localeCompare(a.ts));
    const q = (opts.query ?? "").trim().toLowerCase();
    if (q) {
      entries = entries.filter(
        (e) =>
          e.markdown.toLowerCase().includes(q) ||
          (e.modelLabel ?? "").toLowerCase().includes(q) ||
          (e.projectName ?? "").toLowerCase().includes(q),
      );
    }
    const total = entries.length;
    let start = 0;
    if (opts.cursor) {
      const at = entries.findIndex((e) => e.id === opts.cursor);
      start = at === -1 ? 0 : at + 1;
    }
    const page = entries.slice(start, start + limit);
    return {
      entries: page,
      cursor: start + limit < total ? page[page.length - 1]?.id : undefined,
      total,
    };
  }

  get(id: string): DraftEntry | undefined {
    return this.read().entries.find((e) => e.id === id);
  }

  markSent(id: string, targets: string[]): void {
    const { entries } = this.read();
    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      return;
    }
    entry.sentTo = [...new Set([...entry.sentTo, ...targets])];
    this.write(entries);
  }

  markCopied(id: string): void {
    const { entries } = this.read();
    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      return;
    }
    entry.copied = true;
    this.write(entries);
  }

  // Drop entries outside the retention window and beyond the entry cap.
  prune(): number {
    const { entries } = this.read();
    const days = cfg().historyRetentionDays;
    const cutoff = days > 0 ? Date.now() - days * 24 * 3600_000 : 0;
    const kept = entries
      .filter((e) => !cutoff || Date.parse(e.ts) >= cutoff)
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, Math.max(1, cfg().historyMaxEntries));
    const removed = entries.length - kept.length;
    if (removed > 0) {
      this.write(kept);
    }
    return removed;
  }

  count(): number {
    return this.read().entries.length;
  }
}
