// Event identity + dedupe (A1). Primary key: (source, sessionId, sourceEventId).
// Fallback when a source gives no ids: sha256 of kind+file+text truncated to
// the minute, so the same logical event reported twice (hook + watcher) lands once.
import * as crypto from "crypto";
import { AgentEvent } from "./schema";

export function workspaceIdFor(root: string): string {
  // Stable, privacy-safe workspace identity: hash of the real path.
  return crypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
}

export interface EventDraft extends Omit<AgentEvent, "id" | "schemaVersion" | "workspaceId"> {
  sourceEventId?: string;
}

export function computeEventId(ev: EventDraft, workspaceId: string): string {
  const sid = (ev as { sessionId?: string }).sessionId;
  if (ev.sourceEventId) {
    return `${ev.source}:${sid ?? ""}:${ev.sourceEventId}`;
  }
  const minute = ev.ts.slice(0, 16); // YYYY-MM-DDTHH:mm
  const basis = [ev.kind, ev.file ?? "", ev.command ?? "", ev.text ?? "", minute].join("|");
  return `${ev.source}:hash:${crypto.createHash("sha256").update(workspaceId + basis).digest("hex").slice(0, 24)}`;
}

// In-memory per-process dedupe; the store layers a persisted check on top.
export class DedupeSet {
  private seen = new Set<string>();

  has(id: string): boolean {
    return this.seen.has(id);
  }

  add(id: string): void {
    this.seen.add(id);
  }

  prime(ids: Iterable<string>): void {
    for (const id of ids) {
      this.seen.add(id);
    }
  }
}
