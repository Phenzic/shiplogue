// Event identity + dedupe. Primary key: (source, sessionId, sourceEventId).
// Fallback when a source gives no ids: sha256 of kind+file+text truncated to the
// minute, so the same logical event reported twice (hook + watcher) lands once.
import * as crypto from "crypto";
import { AgentEventDraft } from "../types";

/** Stable, privacy-safe workspace identity: hash of the real path. */
export function workspaceIdFor(root: string): string {
  return crypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
}

export function computeEventId(
  ev: AgentEventDraft,
  workspaceId: string,
): string {
  const sid = ev.sessionId;
  if (ev.sourceEventId) {
    return `${ev.source}:${sid ?? ""}:${ev.sourceEventId}`;
  }
  const minute = ev.ts.slice(0, 16); // YYYY-MM-DDTHH:mm
  const basis = [
    ev.kind,
    ev.file ?? "",
    ev.command ?? "",
    ev.text ?? "",
    minute,
  ].join("|");
  const hash = crypto
    .createHash("sha256")
    .update(workspaceId + basis)
    .digest("hex")
    .slice(0, 24);
  return `${ev.source}:hash:${hash}`;
}

/** In-memory per-process dedupe; the store layers a persisted check on top. */
export class DedupeSet {
  private readonly seen = new Set<string>();

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
