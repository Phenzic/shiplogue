// Shiplogue agent — public surface. Later chunks add watch/hook/mcp/post.
export { loadConfig, writeConfig, eventsDir, shiplogueHome, statePath } from "./config";
export { AgentEvent, EventKind, EventSource, SCHEMA_VERSION, SchemaVersionError } from "./events/schema";
export { EventStore, dayKey } from "./events/store";
export { DedupeSet, computeEventId, workspaceIdFor } from "./events/dedupe";
export { redactText, redactAndCap, shouldSkipPath, CAPS } from "./events/redact";
export { loadState, saveState, AgentState } from "./state";
