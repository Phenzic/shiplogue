// Shiplogue agent — public surface. Later chunks add watch/hook/mcp/post.
export {
  loadConfig,
  writeConfig,
  eventsDir,
  agentDir,
  shiplogueHome,
  statePath,
  configPath,
  DEFAULTS,
} from "./config";
export {
  SCHEMA_VERSION,
  SchemaVersionError,
  parseEventLine,
} from "./events/schema";
export { EventStore, dayKey } from "./events/store";
export {
  DedupeSet,
  computeEventId,
  workspaceIdFor,
} from "./events/dedupe";
export { redactText, redactAndCap, shouldSkipPath, CAPS } from "./events/redact";
export { loadState, saveState, STATE_SCHEMA_VERSION } from "./state";
export { countCommitsSince } from "./git";
export type {
  AgentActor,
  AgentConfig,
  AgentEvent,
  AgentEventDraft,
  AgentEventKind,
  AgentSource,
  AgentState,
} from "./types";
