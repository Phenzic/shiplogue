// ~/.shiplogue/agent/state.json — schema/agent versions, device id, watcher
// cursors, last sync. Local only. Writes use temp-file + rename so a crash
// never leaves a half-written state file.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { statePath } from "./config";
import { AgentState } from "./types";

export const STATE_SCHEMA_VERSION = 1;

export function loadState(
  agentVersion: string,
  file: string = statePath(),
): AgentState {
  let existing: Partial<AgentState> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (parsed && typeof parsed === "object") {
      existing = parsed as Partial<AgentState>;
    }
  } catch {
    /* fresh install or unreadable state */
  }
  return {
    schemaVersion:
      existing.schemaVersion ?? STATE_SCHEMA_VERSION,
    agentVersion,
    deviceId: existing.deviceId ?? crypto.randomUUID(),
    cursors: existing.cursors ?? {},
    lastSync: existing.lastSync,
  };
}

export function saveState(
  state: AgentState,
  file: string = statePath(),
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
