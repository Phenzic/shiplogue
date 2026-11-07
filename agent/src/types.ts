// Shared agent data shapes. The event schema mirrors ARCHITECTURE.md §4.1;
// keeping it in one place makes schema-version tests and the store agree.

export const SOURCES = [
  "claude-code",
  "cursor",
  "copilot",
  "codex",
  "gemini",
  "vscode",
  "git",
  "fs",
] as const;

export type AgentSource = (typeof SOURCES)[number];

export const EVENT_KINDS = [
  "session_start",
  "session_end",
  "prompt",
  "response",
  "thought",
  "tool_call",
  "tool_result",
  "tool_error",
  "file_edit",
  "file_read",
  "shell",
  "commit",
  "branch",
  "comment",
  "error",
] as const;

export type AgentEventKind = (typeof EVENT_KINDS)[number];

export type AgentActor = "user" | "agent" | "system";

export interface AgentEvent {
  schemaVersion: number;
  id: string;
  ts: string;
  source: AgentSource;
  sourceVersion?: string;
  sessionId?: string;
  sourceEventId?: string;
  workspaceRoot: string;
  workspaceId: string;
  repo?: string;
  kind: AgentEventKind;
  actor: AgentActor;
  file?: string;
  command?: string;
  text?: string;
  diff?: { added: number; removed: number; hunks?: string[] };
  meta?: Record<string, string | number | boolean>;
}

/**
 * An event before the store assigns schema/id/workspaceId. Adapters produce
 * this shape; the store is the only writer.
 */
export type AgentEventDraft = Omit<
  AgentEvent,
  "schemaVersion" | "id" | "workspaceId"
> & {
  schemaVersion?: number;
  workspaceId?: string;
};

export interface AgentConfig {
  capturePrompts: boolean;
  captureFileReads: boolean;
  retentionDays: number;
  lookbackHours: number;
}

export interface AgentState {
  schemaVersion: number;
  agentVersion: string;
  deviceId: string;
  cursors: Record<string, string | number>;
  lastSync?: string;
}
