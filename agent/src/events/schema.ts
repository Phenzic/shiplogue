// The AgentEvent schema (ARCHITECTURE.md §4.1), version 1. Readers refuse
// unknown newer schema versions with an actionable error rather than
// mis-parsing them.
import { AgentEvent } from "../types";

export const SCHEMA_VERSION = 1;

export class SchemaVersionError extends Error {
  constructor(public readonly found: number) {
    super(
      `Event schema v${found} is newer than this agent supports (v${SCHEMA_VERSION}). ` +
        `Upgrade the shiplogue agent (npm i -g @phenzic/shiplogue-agent).`,
    );
    this.name = "SchemaVersionError";
  }
}

/**
 * Parse one JSONL line into an AgentEvent. Throws SchemaVersionError on a newer
 * schema; returns null on malformed JSON (caller logs and skips).
 */
export function parseEventLine(line: string): AgentEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const event = parsed as Partial<AgentEvent>;
  if (
    typeof event.schemaVersion === "number" &&
    event.schemaVersion > SCHEMA_VERSION
  ) {
    throw new SchemaVersionError(event.schemaVersion);
  }
  return event as AgentEvent;
}
