# Shiplogue Architecture

> Status: revised 2026-11-01. This replaces the MCP-only framing in the previous revision.
> The product is **Shiplogue Agent**: a local, agent-native stand-up worker. MCP is one
> interface to it, not the product.
>
> Implementation plan: `IMPLEMENTATION_PLAN_4.md`. Cloud/web/API plan:
> `IMPLEMENTATION_PLAN_3.md` (its MCP track is superseded by Plan 4).

## 1. What we are building

Shiplogue Agent captures what a developer does with an AI coding agent — prompts, responses,
tool calls, file edits, shell commands, subagents, sessions, git activity and comments — turns
it into a reviewed stand-up, renders it for copy/edit, keeps it in sync with the IDE extension
and cloud, and posts it on request or on a schedule.

Four layers:

| Layer | Responsibility | Surfaces |
|---|---|---|
| **Capture** | Collect activity from the agent and the workspace | Hooks, workspace watcher, transcript tailer, git watcher |
| **Brain** | Normalize, redact, budget, prompt, ground, model call | Shared `extension/src/core` |
| **Interface** | Let the agent use it | MCP tools/resources/prompts, CLI, skills/slash commands |
| **Sync & delivery** | Keep IDE + cloud drafts in step; render; post | Draft files, local preview, webhooks, cloud API |

**Why not just MCP:** MCP has no event capture, no persistent store, no scheduler, no draft file,
no cross-agent hooks, no version/conflict handling, and is request/response only. Those live in
the agent hub; MCP exposes them.

## 2. Repo decision

**Keep the agent in `Phenzic/shiplogue` for v1.** It is a separate package (`agent/`), not a
separate repo.

Reasons:

- The agent and extension must share capture semantics, prompt, grounding, budget and provider
  code. A separate repo forces a published `@phenzic/shiplogue-core` and version coordination
  before there is a second maintainer.
- `agent/` is a separate npm package (`@phenzic/shiplogue-agent`) and a separate plugin/CLI
  distribution; that is enough separation for v1.
- The cloud stays a separate repo because it is a separate deployable and commercial surface.

**Split trigger:** a second maintainer, an independent release cadence, or a plugin marketplace
that requires its own repo. Then publish `@phenzic/shiplogue-core` and move `agent/` +
`plugins/` to `Phenzic/shiplogue-agent`.

**Supersedes:** Plan 2/3 “MCP server in `mcp/`”, `@phenzic/shiplogue-mcp`, and the
`/shiplogue:daily`-only framing. The agent package includes the MCP server; there is no
MCP-only package.

| Repo | Contents | Deployables |
|---|---|---|
| `Phenzic/shiplogue` (public) | `extension/`, `agent/`, `plugins/shiplogue/`, `.claude-plugin/marketplace.json`, core, plans | VSIX, npm `@phenzic/shiplogue-agent`, Claude/Copilot plugin |
| `Phenzic/shiplogue-cloud` (private) | `apps/web`, `apps/docs`, `apps/api`, `packages/contracts`, `infra/` | Pages (web/docs), Workers (api), D1 |
| `Phenzic/shiplogue` docs | `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN_*.md`, `docs/adr/*` | GitHub |

## 3. System context

```
┌─────────────────────────────────────────────────────────────────────┐
│ AI coding agents                                                   │
│ Claude Code · Cursor · VS Code Copilot · Codex CLI · Gemini CLI     │
│                                                                    │
│ hooks / plugins / MCP config                                       │
└───────────────┬─────────────────────────────────────────────────────┘
                │ hook JSON (stdin), MCP stdio, config
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Shiplogue Agent (local, per user)                                   │
│                                                                    │
│  Capture                   Brain                    Interface       │
│  ─ hooks adapters          ─ normalize/redact      ─ MCP server    │
│  ─ fs + git watcher        ─ event → context       ─ CLI            │
│  ─ transcript tailer       ─ prompt/ground/budget  ─ skills/slash   │
│  ─ git enrichment          ─ BYOK/Ollama           ─ local preview  │
│                                                                    │
│  Store: ~/.shiplogue/agent/ (events, sessions, drafts, state)       │
│  Render: Markdown + draft file + preview URL                        │
│  Post: Slack/Discord/Teams webhook with confirmation                │
│  Sync: drafts/revisions to cloud; IDE reads the same store          │
└───────────────┬─────────────────────────────────────────────────────┘
                │ HTTPS (opt-in Pro)
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Shiplogue Cloud                                                     │
│ api.shiplogue.com · D1/KV · hosted model · draft sync · cron posts  │
│ web/docs on Pages                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.1 Process model

- **`shiplogue` CLI** — one package with subcommands; no always-on requirement.
- **Hooks are short-lived** — append one event and exit; no model/network calls; timeout ≤ 10 s;
  fail-open so the agent never blocks.
- **Optional `shiplogue watch` daemon** — file/git/transcript watchers for agents without rich
  hooks and for activity hooks miss. Not required for hook-only capture.
- **MCP server** — `shiplogue mcp`, stdio; reads the local store; tools return draft/render/post.
- **IDE extension** — unchanged capture; additionally reads agent events, shows agent activity,
  opens agent drafts, and syncs.

## 4. Local store

```
~/.shiplogue/agent/
  config.json                  # workspace roots, source toggles, provider, posting, sync
  state.json                   # schemaVersion, agentVersion, deviceId, cursors, last sync
  events/2026-11-01.jsonl      # append-only normalized events
  sessions/<source>/<id>.jsonl # optional raw session/transcript tails
  drafts/2026-11-01.md         # rendered draft
  drafts/2026-11-01.json       # metadata, revisions, source breakdown
  logs/agent.log               # capped; no prompt text by default
```

Retention default 14 days (same as extension); configurable. Event files compacted by day.

### 4.1 Event schema

```ts
interface AgentEvent {
  schemaVersion: 1;
  id: string;                 // source + session + sourceEventId, or sha256
  ts: string;                 // ISO
  source: "claude-code" | "cursor" | "copilot" | "codex" | "gemini" | "vscode" | "git" | "fs";
  sourceVersion?: string;
  sessionId?: string;
  workspaceRoot: string;
  workspaceId: string;        // hash(realpath)
  repo?: string;
  kind:
    | "session_start" | "session_end"
    | "prompt" | "response" | "thought"
    | "tool_call" | "tool_result" | "tool_error"
    | "file_edit" | "file_read"
    | "shell" | "commit" | "branch" | "comment" | "error";
  actor: "user" | "agent" | "system";
  file?: string;              // workspace-relative, "/" normalized
  command?: string;
  text?: string;
  diff?: { added: number; removed: number; hunks?: string[] };
  meta?: Record<string, string | number | boolean>;
}
```

Rules:

- **No full file contents.** Paths, diff stats, capped snippets: prompt/response ≤ 2 KB, tool
  output ≤ 1 KB, diff ≤ 4 KB.
- **Redact** tokens/keys (`sk-`, `ghp_`, `AKIA`, `Bearer`, `api_key=`, `.env` contents) before write.
- **Skip** `.env*`, keys/certs, binaries, `node_modules`, `.git` internals, build output.
- **Prompts** capture intent; default on with redaction; `capturePrompts: false` disables. Never
  synced to cloud in v1.
- **Dedupe** by `(source, sessionId, sourceEventId)`; fallback hash of kind+file+text+minute.
- Append-only; readers sort by `ts`; tolerate clock skew.

## 5. Capture

| Agent | Primary | Hook events used | Fallback |
|---|---|---|---|
| **Claude Code** | Plugin hooks (`hooks/hooks.json`) | `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolBatch`, `Stop`, `StopFailure` | Transcript tail under `~/.claude/projects/` |
| **Cursor** | `~/.cursor/hooks.json` or project `.cursor/hooks.json` | `sessionStart/End`, `beforeSubmitPrompt`, `postToolUse`, `afterFileEdit`, `afterAgentResponse`, `stop`, `subagentStop`, `afterShellExecution` | Cursor chat DB (read-only) + watcher |
| **VS Code Copilot** | Agent plugin (skills/hooks/MCP; experimental) + MCP | lifecycle hooks exposed by Copilot; Claude-format `hooks/hooks.json` | VS Code extension activity + watcher |
| **Codex CLI** | `[hooks]` / `notify` + MCP | lifecycle/tool events | Session files + watcher |
| **Gemini CLI** | Hooks (v0.26+) + MCP/extension | lifecycle/tool events | Session files + watcher |
| **Any agent** | `shiplogue watch` | — | fs watcher + git + transcript tails |

Watcher coverage (agent-agnostic):

- File changes: debounce 300 ms, ignore noise, record `file_edit` + add/remove counts.
- Git: watch `.git/HEAD`, `refs`, `index`; run `git log`/`git status` deltas; record commits/branches.
- Transcript tailer: per-agent known locations; parse new lines into prompt/response/tool events;
  stop at last cursor.
- GitHub comments/reviews (optional): PR review comments and issue comments by the user via
  REST/`gh`; only when a token is configured.

### 5.1 Hook installer

`shiplogue hooks install --agent claude|cursor|copilot|codex|gemini`:

- Writes the minimum hook config and a command that calls the installed CLI
  (`shiplogue hook <agent>`), not `npx` on every event.
- Backs up existing config; idempotent; `--dry-run`; `uninstall`.
- Never edits outside the agent config dir or a confirmed workspace `.cursor` file.
- Verifies with one synthetic event and prints the event path.

## 6. Brain: generation and rendering

- Reuses `extension/src/core` after extraction: prompt, grounding, budget, providers.
- Backends: **BYOK** (Anthropic/OpenAI/Google/compatible), **Ollama**, and the hosted
  Shiplogue provider (paid) in v1. There is **no bundled model**; do not add
  `node-llama-cpp` to the agent or extension packages.
- Modes `concise|standard|elaborate`; tone `neutral|junior|mid|senior`; format
  `done-next-blockers|yesterday-today-blockers`.
- Draft metadata: source counts, omissions, grounding removals, `needsReview`, backend/model,
  revision.

### 6.1 Render contract

```json
{
  "markdown": "...",
  "plainText": "...",
  "draftPath": "~/.shiplogue/agent/drafts/2026-11-01.md",
  "metadataPath": "~/.shiplogue/agent/drafts/2026-11-01.json",
  "previewUrl": "http://127.0.0.1:<port>/draft/2026-11-01",
  "sourceBreakdown": { "claude-code": 12, "cursor": 4, "git": 7, "fs": 9 },
  "revision": 3
}
```

- The agent can show Markdown in chat and give the file path.
- `shiplogue preview` serves a local read-only HTML render with Copy/Markdown/Plain-text tabs;
  no cloud, no telemetry.
- `revise_standup` accepts full Markdown or `{section, bullet}` append/replace; writes a new
  revision, keeps the previous.

## 7. Interface

### 7.1 MCP tools

| Tool | Purpose | Safety |
|---|---|---|
| `get_activity` | Activity for lookback/workspace, text + JSON | read-only |
| `generate_standup` | Draft via BYOK/Ollama | local read-only |
| `render_standup` | Markdown + draft path + preview | writes local draft |
| `revise_standup` | Append/replace section or full Markdown | writes local draft |
| `post_standup` | Post to configured webhook | **destructive**; `confirm: true`; host elicitation where supported |
| `sync_standup` | Push/pull cloud draft | auth; returns revision/conflict |
| `get_agent_status` | Sources, last event, versions, sync | read-only |

Resources: `shiplogue://activity/today`, `shiplogue://draft/latest`, `shiplogue://status`.
Prompt: `shiplogue-daily`.

**Posting confirmation:** MCP 2026-07-28 supports elicitation; use it when the host supports it
(VS Code/Copilot), otherwise return a preview and require `confirm: true` plus host tool
approval. Never post on generation.

### 7.2 CLI

```
shiplogue init [--workspace .]
shiplogue status [--json]
shiplogue watch [--workspace .]
shiplogue hook <agent>          # hook JSON on stdin -> append event
shiplogue hooks install|uninstall --agent <agent>
shiplogue mcp
shiplogue standup [--detail ...] [--tone ...] [--json]
shiplogue render [--open]
shiplogue preview [--port 0]
shiplogue post [--confirm] [--target slack|discord|teams]
shiplogue sync push|pull|status
shiplogue config get|set
```

### 7.3 Agent plugins/skills

- **Claude Code:** plugin with hooks + MCP + `skills/daily/SKILL.md`;
  `/shiplogue:daily`; no key required (agent writes from `get_activity`), BYOK optional.
- **Cursor:** hooks + MCP config + rule/skill.
- **VS Code Copilot:** agent plugin (skills/hooks/MCP) when stable; MCP + instruction fallback.
- **Codex/Gemini:** MCP config + hook installer; CLI fallback.

## 8. Sync

### 8.1 Local (agent ↔ extension)

- Both read `~/.shiplogue/agent/events/` and the extension's existing store.
- Extension settings: `shiplogue.agent.enabled` (default true),
  `shiplogue.agent.eventsDir` (default).
- Merge into `gatherContext`; dedupe extension `save` + agent `file_edit` for the same
  file/minute into one touch with source counts.
- Commands: `Shiplogue: Show Agent Activity`, `Shiplogue: Open Latest Agent Draft`.
- Version handshake: `state.json` has `schemaVersion` + `agentVersion`; extension warns on
  incompatible schema or stale agent.

### 8.2 Cloud

Default: **drafts only**, not raw events.

```
GET    /v1/agent/drafts/:date          -> { markdown, revision, source, updatedAt, sections }
PUT    /v1/agent/drafts/:date          { markdown, revision? } -> { revision }
PATCH  /v1/agent/drafts/:date          { operations, baseRevision } -> { revision } | 409
POST   /v1/agent/drafts/:date/compile  -> hosted-model version { markdown, revision }
POST   /v1/agent/posts                 { date, target, scheduledFor? } -> { id, status }
```

- `PUT`/`PATCH` with `If-Match`/`baseRevision`; `409` returns server draft; agent chooses merge.
- Merge: section-level (Done/Next/Blockers/References), then bullet union; keep both on
  ambiguity, mark `(merged)`.
- "Compiled cloud version": cloud can regenerate with the hosted model into a new revision; the
  agent can append local-only work and push.
- Event sync (cross-device activity) is later, opt-in and encrypted.

### 8.3 Version compatibility

- `schemaVersion` in every event and `state.json`; unknown newer schema → refuse write.
- `agentVersion` + extension version shown by `shiplogue status`; extension warns on mismatch.
- Cloud API versioned (`/v1`); agent sends `X-Shiplogue-Agent-Version`.

## 9. Auto-post

- **Agent-triggered:** `post_standup` after explicit confirmation. Never on generation.
- **Local scheduler:** `shiplogue watch` checks `autoPost.time/days/mode`; `review` notifies,
  `auto` posts after a short undo window; dedupe per day/target; retry with backoff.
- **Cloud scheduler (Pro):** final draft only; Cron posts when the machine is off; 24 h
  retention; idempotency; cancel window.
- **Targets:** Slack, Discord and Microsoft Teams (Workflows Adaptive Card) as a multi-target
  list; per-target status; one post per target per day for auto-post.
- **MCP:** destructive annotation; `confirm` required; returns exact text/target before posting.

## 10. Feature parity: extension vs agent

| Extension | Agent | Notes |
|---|---|---|
| Tracker + Cursor + git + GitHub | Hooks + watcher + transcripts + git + optional GitHub comments | Richer tool/session data; same core |
| Local/BYOK/Ollama | BYOK/Ollama; optional extension bridge later | 4B stays in extension v1 |
| Webview review | Markdown + draft file + preview + `revise_standup` | No webview inside agent |
| Copy / plain text | Tool output + draft file + preview Copy; CLI `--copy` | OS clipboard tools |
| Send to Slack/Discord | `post_standup` with confirmation | Teams added |
| Reminder | CLI/OS scheduler; cloud | Agent cannot own OS notifications |
| Settings | `~/.shiplogue/agent/config.json` + env + plugin `userConfig` | No Settings UI |
| Sync windows | Shared local store; cloud drafts | Extension reads agent events |

## 11. Security and privacy

- Hooks fail-open, ≤ 10 s, never block the agent; synthetic test on install.
- Redaction before write; no full file contents; prompts optional; no cloud event sync v1.
- MCP `get_activity` read-only; `post_standup` destructive + confirmation.
- Path access limited to configured roots; no arbitrary file read.
- Keys in OS keychain or env/userConfig; never in `config.json` when avoidable.
- Logs exclude prompt text by default; diagnostics expose versions/counts only.
- Cloud stores drafts, not events; 24 h retention for scheduled posts; deletion endpoint.

## 12. Build order

See `IMPLEMENTATION_PLAN_4.md`:

```
A0 core/scaffold
  ├─ A1 store ─ A2 watcher ─ A3 hooks (Claude/Cursor first)
  │                         └─ A4 MCP ─ A5 CLI/render
  ├─ A6 extension bridge (after A1/A2)
  └─ A7 cloud sync (after A1; parallel with A4/A5)
A8 auto-post (after A4/A5; cloud after A7)
A9 packaging/plugins (after A3/A4)
```

First usable milestone: **A0–A5 + Claude Code + Cursor + MCP + preview** — the agent version of
the extension without cloud.

## 13. Open decisions

1. Prompt capture default on/off (recommend on, redacted, local-only).
2. Hook installer auto-start `shiplogue watch` vs opt-in.
3. Agent package/bin name (`@phenzic/shiplogue-agent`, `shiplogue`).
4. Cloud draft sync default on/off (recommend off until account).
5. Local preview port/UI.
6. Teams target single vs multi.
7. Repo split trigger.
8. Optional extension bridge for the 4B engine.

## 14. References

- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Cursor hooks: https://cursor.com/docs/agent/hooks
- VS Code Copilot agent plugins/hooks:
  https://code.visualstudio.com/docs/copilot/customization/agent-plugins
- Gemini CLI hooks (v0.26+): https://developers.googleblog.com
- Codex CLI hooks/notify reference:
  https://github.com/codealive-ai/ai-driven-development/blob/main/skills/hooks-management/references/codex-hooks.md
- MCP elicitation (2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
