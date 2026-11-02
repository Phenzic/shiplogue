// The AgentEvent schema (ARCHITECTURE.md §4.1), version 1. Readers refuse
// unknown newer schema versions with an actionable error rather than
// mis-parsing them.

export const SCHEMA_VERSION = 1;

export type EventSource = "claude-code" | "cursor" | "copilot" | "codex" | "gemini" | "vscode" | "git" | "fs";

export type EventKind =
  | "session_start"
  | "session_end"
  | "prompt"
  | "response"
  | "thought"
  | "tool_call"
  | "tool_result"
  | "tool_error"
  | "file_edit"
  | "file_read"
  | "shell"
  | "commit"
  | "branch"
  | "comment"
  | "error";

export interface AgentEvent {
  schemaVersion: number;
  id: string; // source + session + sourceEventId, or sha256 fallback
  ts: string; // ISO
  source: EventSource;
  sourceVersion?: string;
  sessionId?: string;
  workspaceRoot: string;
  workspaceId: string; // sha256(realpath)
  repo?: string;
  kind: EventKind;
  actor: "user" | "agent" | "system";
  file?: string; // workspace-relative, "/" normalized
  command?: string;
  text?: string;
  diff?: { added: number; removed: number; hunks?: string[] };
  meta?: Record<string, string | number | boolean>;
}

export class SchemaVersionError extends Error {
  constructor(found: number) {
    super(
      `Event schema v${found} is newer than this agent supports (v${SCHEMA_VERSION}). ` +
        `Upgrade the shiplogue agent (npm i -g @phenzic/shiplogue-agent).`,
    );
    this.name = "SchemaVersionError";
  }
}

// Parse one JSONL line into an AgentEvent. Throws SchemaVersionError on a newer
// schema; returns null on malformed JSON (caller logs and skips).
export function parseEventLine(line: string): AgentEvent | null {
  let parsed: any;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed?.schemaVersion === "number" && parsed.schemaVersion > SCHEMA_VERSION) {
    throw new SchemaVersionError(parsed.schemaVersion);
  }
  return parsed as AgentEvent;
}
