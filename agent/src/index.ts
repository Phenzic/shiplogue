// Shiplogue agent — public surface. Later chunks add watch/mcp/post.
export {
  loadConfig,
  writeConfig,
  eventsDir,
  agentDir,
  shiplogueHome,
  statePath,
  configPath,
  logsDir,
  draftsDir,
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
export { gatherActivity } from "./activity";
export { currentAgentStatus } from "./status";
export { createServer } from "./mcp/server";
export { runMcp } from "./mcp/run";
export { runHook, hookResponse } from "./hooks/command";
export { normalizeHook } from "./hooks/normalize";
export {
  installHooks,
  eventsFor,
  configFile,
  defaultHookCommand,
} from "./hooks/install";
export type { AgentActor, AgentConfig, AgentEvent, AgentEventDraft, AgentEventKind, AgentSource, AgentState } from "./types";
export type { HookAgent, HookContext, NormalizeOptions } from "./hooks/normalize";
export type { ActivityOptions, ActivityResult, ActivityStats } from "./activity";
export type { AgentStatus } from "./status";
export type { InstallOptions, InstallResult } from "./hooks/install";
