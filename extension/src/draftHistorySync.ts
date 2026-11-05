import { DraftEntry, HistoryPage } from "./draftHistory";
import type { CloudClient } from "./cloud";
import { cfg } from "./config";

// Cloud sync seam for the per-draft history (Pro). Free users are local-only: the
// store keeps 7 days (configurable) and prunes. Pro users will sync every draft
// to the cloud and page older ones back into the history view — the page contract
// below (cursor-based) already supports fetching chunk by chunk.
export interface DraftSync {
  push(entry: DraftEntry): Promise<void>;
  fetchPage(opts: { cursor?: string; limit: number }): Promise<HistoryPage>;
  isEnabled(): boolean;
}

// No-op implementation used until accounts/billing exist. Every method is a
// safe no-op, so callers never need to branch on cloud availability.
export class LocalOnlySync implements DraftSync {
  push(_entry: DraftEntry): Promise<void> {
    return Promise.resolve();
  }
  fetchPage(_opts: { cursor?: string; limit: number }): Promise<HistoryPage> {
    return Promise.resolve({ entries: [], cursor: undefined, total: 0 });
  }
  isEnabled(): boolean {
    return false;
  }
}

/** Cloud-backed Pro history. Free users keep the local-only implementation. */
export class CloudDraftSync implements DraftSync {
  constructor(private readonly cloud: CloudClient) {}

  isEnabled(): boolean {
    return true;
  }

  async push(_entry: DraftEntry): Promise<void> {
    // Revisions are pushed against a known standup id by the caller; the generic
    // history entry does not include it. Canonical daily sync already happens
    // through CloudClient.syncStandup.
  }

  async fetchPage(opts: { cursor?: string; limit: number }): Promise<HistoryPage> {
    const page = await this.cloud.listHistory({ before: opts.cursor, limit: opts.limit });
    const entries: DraftEntry[] = page.entries.map((entry) => ({
      id: entry.id,
      ts: entry.createdAt,
      markdown: entry.bodyMarkdown,
      detail: cfg().detail,
      tone: cfg().tone,
      ...(entry.title ? { title: entry.title } : {}),
      kind: "daily" as const,
      ...(entry.localWorkspace?.name ? { projectName: entry.localWorkspace.name } : {}),
      ...(entry.model ? { modelLabel: entry.model } : {}),
      ...(entry.sources?.length ? { sources: entry.sources } : {}),
      ...(entry.scheduled ? { scheduled: entry.scheduled } : {}),
      sentTo: entry.sent?.targets ?? [],
      needsReview: false,
    }));
    return { entries, cursor: page.cursor, total: page.total ?? entries.length };
  }
}

let sync: DraftSync = new LocalOnlySync();

export function getDraftSync(): DraftSync {
  return sync;
}

// Test seam / future cloud wiring.
export function setDraftSync(next: DraftSync): void {
  sync = next;
}
