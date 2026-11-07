// Hook payload normalization for the three first-class agents. Each adapter
// turns a host-specific JSON payload into AgentEventDraft values; the store is
// the only writer. Hooks must stay fail-open and never block the agent.
import * as path from "path";
import { AgentActor, AgentEventDraft, AgentEventKind, AgentSource } from "../types";
import { normalizeSlashes } from "../core";

export type HookAgent = "claude" | "cursor" | "codex";

export interface HookContext {
  now?: Date;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface NormalizeOptions extends HookContext {
  /** Cursor does not always put the event name in stdin; the installer passes it. */
  eventHint?: string;
}

type Payload = Record<string, unknown>;

function str(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function firstStr(...values: unknown[]): string | undefined {
  for (const value of values) {
    const s = str(value);
    if (s) return s;
  }
  return undefined;
}

function obj(value: unknown): Payload | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Payload)
    : undefined;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pick(payload: Payload, ...keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] !== undefined) return payload[key];
    const hyphen = key.replace(/_/g, "-");
    if (payload[hyphen] !== undefined) return payload[hyphen];
    const snake = key.replace(/-/g, "_");
    if (payload[snake] !== undefined) return payload[snake];
  }
  return undefined;
}

function iso(value: unknown, fallback: Date): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Accept seconds or milliseconds.
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback.toISOString();
}

function sourceFor(agent: HookAgent): AgentSource {
  switch (agent) {
    case "claude":
      return "claude-code";
    case "cursor":
      return "cursor";
    case "codex":
      return "codex";
  }
}

function actorFor(kind: AgentEventKind, agent: HookAgent): AgentActor {
  if (kind === "prompt") return "user";
  if (kind === "session_start" || kind === "session_end") return "system";
  if (kind === "commit" || kind === "branch") return "system";
  if (kind === "error") return "system";
  return agent === "codex" ? "agent" : "agent";
}

function workspaceRoot(payload: Payload, ctx: NormalizeOptions): string {
  const roots = arr(payload.workspace_roots ?? payload.workspaceRoots);
  const env = ctx.env ?? process.env;
  return normalizeSlashes(
    firstStr(
      payload.cwd,
      roots[0],
      env.CLAUDE_PROJECT_DIR,
      env.CURSOR_PROJECT_DIR,
      env.CODEX_PROJECT_DIR,
      ctx.cwd,
      process.cwd(),
    ) ?? process.cwd(),
  );
}

function fileFor(payload: Payload, root: string): string | undefined {
  const toolInput = obj(payload.tool_input ?? payload.toolInput);
  const raw = firstStr(
    payload.file_path,
    payload.filePath,
    payload.path,
    toolInput?.file_path,
    toolInput?.filePath,
    toolInput?.path,
    toolInput?.notebook_path,
  );
  if (!raw) return undefined;
  const normalized = normalizeSlashes(raw);
  if (path.isAbsolute(normalized)) {
    const rel = normalizeSlashes(path.relative(root, normalized));
    return rel.startsWith("..") ? normalized : rel;
  }
  return normalized.replace(/^\.\//, "");
}

function commandFor(payload: Payload): string | undefined {
  const toolInput = obj(payload.tool_input ?? payload.toolInput);
  const raw = payload.command ?? toolInput?.command;
  if (Array.isArray(raw)) {
    return raw.map((part) => str(part) ?? "").join(" ").trim() || undefined;
  }
  return str(raw);
}

function textFor(payload: Payload): string | undefined {
  const toolInput = obj(payload.tool_input ?? payload.toolInput);
  const toolResponse = payload.tool_response ?? payload.tool_output ?? payload.toolResponse;
  const responseText =
    typeof toolResponse === "string"
      ? toolResponse
      : toolResponse && typeof toolResponse === "object"
        ? JSON.stringify(toolResponse)
        : undefined;
  const messages = arr(payload["input-messages"] ?? payload.input_messages);
  return firstStr(
    payload.prompt,
    payload.text,
    payload.last_assistant_message,
    payload.lastAssistantMessage,
    payload.response,
    payload.summary,
    payload.message,
    payload.error_message,
    payload.reason,
    payload.output,
    toolInput?.description,
    toolInput?.query,
    responseText,
    messages.length ? messages.map((m) => str(m) ?? "").join("\n") : undefined,
  );
}

function tokenMeta(payload: Payload): Record<string, string | number | boolean> {
  const usage = obj(payload.usage) ?? obj(payload.token_usage ?? payload.tokenUsage);
  const out: Record<string, string | number | boolean> = {};
  const pairs: Array<[string, unknown]> = [
    ["model", payload.model ?? payload.model_id ?? payload.modelId],
    ["model_id", payload.model_id ?? payload.modelId],
    ["input_tokens", usage?.input_tokens ?? usage?.inputTokens ?? payload.input_tokens],
    ["output_tokens", usage?.output_tokens ?? usage?.outputTokens ?? payload.output_tokens],
    [
      "cache_read_tokens",
      usage?.cache_read_input_tokens ?? usage?.cacheReadInputTokens ?? payload.cache_read_tokens,
    ],
    [
      "cache_write_tokens",
      usage?.cache_creation_input_tokens ??
        usage?.cacheCreationInputTokens ??
        payload.cache_write_tokens,
    ],
  ];
  for (const [key, value] of pairs) {
    const n = num(value);
    if (n !== undefined) out[key] = n;
    else {
      const s = str(value);
      if (s) out[key] = s;
    }
  }
  const cost = num(payload.cost_usd ?? payload.costUsd ?? payload.amount_spent ?? payload.amountSpent);
  if (cost !== undefined) out.cost_usd = cost;
  return out;
}

function metaFor(
  payload: Payload,
  event: string,
  agent: HookAgent,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {
    hook: event,
    agent,
    ...tokenMeta(payload),
  };
  const tool = obj(payload.tool_input ?? payload.toolInput);
  const toolName = firstStr(payload.tool_name, payload.toolName, tool?.name);
  if (toolName) out.tool = toolName;
  for (const [key, value] of [
    ["duration_ms", payload.duration ?? payload.duration_ms],
    ["status", payload.status],
    ["reason", payload.reason],
    ["agent_id", payload.agent_id],
    ["agent_type", payload.agent_type],
    ["subagent_type", payload.subagent_type],
    ["permission_mode", payload.permission_mode],
    ["is_background_agent", payload.is_background_agent],
    ["composer_mode", payload.composer_mode],
  ] as const) {
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else {
      const s = str(value);
      if (s) out[key] = s;
    }
  }
  const usage = obj(payload.usage) ?? obj(payload.token_usage ?? payload.tokenUsage);
  const total = num(usage?.total_tokens ?? usage?.totalTokens ?? payload.total_tokens);
  if (total !== undefined) out.total_tokens = total;
  return out;
}

function diffStats(edits: unknown[]): { added: number; removed: number } | undefined {
  if (edits.length === 0) return undefined;
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    const e = obj(edit);
    if (!e) continue;
    const oldText = str(e.old_string ?? e.oldString ?? e.old_line ?? e.oldLine) ?? "";
    const newText = str(e.new_string ?? e.newString ?? e.new_line ?? e.newLine) ?? "";
    removed += oldText ? oldText.split("\n").length : 0;
    added += newText ? newText.split("\n").length : 0;
  }
  return added || removed ? { added, removed } : undefined;
}

function baseDraft(
  agent: HookAgent,
  payload: Payload,
  event: string,
  kind: AgentEventKind,
  ctx: NormalizeOptions,
): AgentEventDraft {
  const root = workspaceRoot(payload, ctx);
  return {
    ts: iso(pick(payload, "timestamp", "ts", "time", "triggered_at"), ctx.now ?? new Date()),
    source: sourceFor(agent),
    sourceVersion: firstStr(
      payload.claude_version,
      payload.cursor_version,
      payload.codex_version,
      payload.version,
    ),
    sessionId: firstStr(
      payload.session_id,
      payload.sessionId,
      payload.conversation_id,
      payload.conversationId,
      payload.thread_id,
      payload.threadId,
    ),
    sourceEventId: firstStr(
      payload.tool_use_id,
      payload.toolUseId,
      payload.event_id,
      payload.eventId,
      payload.prompt_id,
      payload.turn_id,
      payload.turnId,
    ),
    workspaceRoot: root,
    kind,
    actor: actorFor(kind, agent),
    meta: metaFor(payload, event, agent),
  };
}

function withFile(
  draft: AgentEventDraft,
  payload: Payload,
  root: string,
): AgentEventDraft {
  const file = fileFor(payload, root);
  return file ? { ...draft, file } : draft;
}

function withText(
  draft: AgentEventDraft,
  payload: Payload,
  max = 2048,
): AgentEventDraft {
  const text = textFor(payload);
  return text ? { ...draft, text: text.slice(0, max) } : draft;
}

function withCommand(
  draft: AgentEventDraft,
  payload: Payload,
): AgentEventDraft {
  const command = commandFor(payload);
  return command ? { ...draft, command } : draft;
}

function normalizeClaude(
  payload: Payload,
  event: string,
  ctx: NormalizeOptions,
): AgentEventDraft[] {
  const kind = (() => {
    switch (event) {
      case "SessionStart":
        return "session_start" as const;
      case "SessionEnd":
        return "session_end" as const;
      case "UserPromptSubmit":
        return "prompt" as const;
      case "PreToolUse":
        return "tool_call" as const;
      case "PostToolUse":
      case "PostToolBatch":
        return "tool_result" as const;
      case "PostToolUseFailure":
      case "StopFailure":
        return "tool_error" as const;
      case "Stop":
      case "SubagentStop":
        return "response" as const;
      case "Notification":
        return "error" as const;
      default:
        return undefined;
    }
  })();
  if (!kind) return [];
  const draft = baseDraft("claude", payload, event, kind, ctx);
  return [withText(withCommand(withFile(draft, payload, draft.workspaceRoot), payload), payload)];
}

function normalizeCursor(
  payload: Payload,
  event: string,
  ctx: NormalizeOptions,
): AgentEventDraft[] {
  const kind = (() => {
    switch (event) {
      case "sessionStart":
      case "workspaceOpen":
        return "session_start" as const;
      case "sessionEnd":
        return "session_end" as const;
      case "beforeSubmitPrompt":
        return "prompt" as const;
      case "afterAgentResponse":
      case "stop":
        return "response" as const;
      case "afterAgentThought":
        return "thought" as const;
      case "preToolUse":
        return "tool_call" as const;
      case "postToolUse":
        return "tool_result" as const;
      case "postToolUseFailure":
        return "tool_error" as const;
      case "beforeShellExecution":
      case "afterShellExecution":
        return "shell" as const;
      case "afterFileEdit":
        return "file_edit" as const;
      case "beforeReadFile":
        return "file_read" as const;
      case "subagentStart":
        return "session_start" as const;
      case "subagentStop":
        return "session_end" as const;
      default:
        return undefined;
    }
  })();
  if (!kind) return [];
  const draft = baseDraft("cursor", payload, event, kind, ctx);
  const withPath = withFile(draft, payload, draft.workspaceRoot);
  const withBody = withText(withCommand(withPath, payload), payload);
  const edits = arr(payload.edits);
  const diff = kind === "file_edit" ? diffStats(edits) : undefined;
  return [diff ? { ...withBody, diff } : withBody];
}

function codexPatchDrafts(
  payload: Payload,
  draft: AgentEventDraft,
): AgentEventDraft[] {
  const tool = obj(payload.tool_input ?? payload.toolInput);
  const patch = firstStr(tool?.patch, payload.patch);
  if (!patch) return [];
  const entries: Array<{ file: string; added: number; removed: number }> = [];
  let current: { file: string; added: number; removed: number } | undefined;
  for (const line of patch.split("\n")) {
    const header = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
    if (header) {
      current = { file: header[1].trim(), added: 0, removed: 0 };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) current.added++;
    else if (line.startsWith("-") && !line.startsWith("---")) current.removed++;
  }
  return entries.map((entry, index) => ({
    ...draft,
    kind: "file_edit" as const,
    actor: "agent" as const,
    file: entry.file,
    sourceEventId: `${draft.sourceEventId ?? "patch"}:${index}`,
    diff: { added: entry.added, removed: entry.removed },
  }));
}

function normalizeCodex(
  payload: Payload,
  event: string,
  ctx: NormalizeOptions,
): AgentEventDraft[] {
  // `codex notify` passes a single JSON argument and currently emits
  // agent-turn-complete. Hooks use the same event names as Claude.
  const type = firstStr(payload.type) ?? event;
  if (type === "agent-turn-complete") {
    const drafts: AgentEventDraft[] = [];
    const messages = arr(payload["input-messages"] ?? payload.input_messages);
    const prompt = messages.map((m) => str(m) ?? "").filter(Boolean).join("\n");
    if (prompt) {
      drafts.push(
        withText(
          baseDraft("codex", payload, "agent-turn-complete", "prompt", ctx),
          { prompt },
        ),
      );
    }
    const response = firstStr(
      payload["last-assistant-message"],
      payload.last_assistant_message,
      payload.message,
    );
    if (response) {
      drafts.push(
        withText(
          baseDraft("codex", payload, "agent-turn-complete", "response", ctx),
          { text: response },
        ),
      );
    }
    return drafts;
  }

  const kind = (() => {
    switch (event) {
      case "SessionStart":
        return "session_start" as const;
      case "UserPromptSubmit":
        return "prompt" as const;
      case "PreToolUse":
        return "tool_call" as const;
      case "PostToolUse":
        return "tool_result" as const;
      case "PostToolUseFailure":
        return "tool_error" as const;
      case "Stop":
      case "SubagentStop":
        return "response" as const;
      case "PreCompact":
      case "PostCompact":
        return "tool_result" as const;
      default:
        return undefined;
    }
  })();
  if (!kind) return [];
  const draft = baseDraft("codex", payload, event, kind, ctx);
  if (kind === "tool_call" || kind === "tool_result") {
    const patched = codexPatchDrafts(payload, draft);
    if (patched.length > 0) return patched;
  }
  return [
    withText(
      withCommand(withFile(draft, payload, draft.workspaceRoot), payload),
      payload,
    ),
  ];
}

/**
 * Normalize a host hook payload. Unknown events return [] rather than throwing:
 * hooks must never block the agent because a host added a new event.
 */
export function normalizeHook(
  agent: HookAgent,
  payload: Payload,
  options: NormalizeOptions = {},
): AgentEventDraft[] {
  const event =
    firstStr(
      payload.hook_event_name,
      payload.hookEventName,
      payload.event,
      payload.type,
      options.eventHint,
    ) ?? options.eventHint;
  if (!event) return [];
  switch (agent) {
    case "claude":
      return normalizeClaude(payload, event, options);
    case "cursor":
      return normalizeCursor(payload, event, options);
    case "codex":
      return normalizeCodex(payload, event, options);
  }
}
