// ~/.shiplogue/agent/state.json — schema/agent versions, device id, watcher
// cursors, last sync. Local only.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { statePath } from "./config";

export interface AgentState {
  schemaVersion: number;
  agentVersion: string;
  deviceId: string;
  cursors: Record<string, string>;
  lastSync?: string;
}

export function loadState(agentVersion: string, file = statePath()): AgentState {
  let existing: Partial<AgentState> = {};
  try {
    existing = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* fresh */
  }
  return {
    schemaVersion: 1,
    agentVersion,
    deviceId: existing.deviceId ?? crypto.randomUUID(),
    cursors: existing.cursors ?? {},
    lastSync: existing.lastSync,
  };
}

export function saveState(state: AgentState, file = statePath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
