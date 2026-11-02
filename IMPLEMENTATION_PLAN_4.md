# Shiplogue Agent — Implementation Plan 4

> Status: proposed 2026-11-01. This is the build plan for **Shiplogue Agent**, the
> agent-native product described in `ARCHITECTURE.md`. It supersedes the MCP-only Track M in
> `IMPLEMENTATION_PLAN_3.md`; the cloud/web/API work in that plan still stands.

## 0. Scope and principles

**Goal:** a developer working in Claude Code, Cursor, VS Code Copilot, Codex CLI or Gemini CLI
can capture their agent work, generate a reviewed stand-up, render it for copy/edit, sync it
with the IDE extension and cloud, and post it on request or on a schedule.

Principles:

- **Capture is passive and local-first.** No account, no telemetry, no cloud by default.
- **The agent hub is the product; MCP is one interface.** CLI, hooks and local files matter as
  much as MCP.
- **Never block the agent.** Hooks are short-lived, fail-open, ≤ 10 s.
- **No full file contents, no secrets.** Paths, diff stats, capped snippets; redact; opt out.
- **Never post on generation.** Posting is explicit and confirmed; scheduling is separate.
- **One shared brain.** Extension, agent and future API use `extension/src/core` for prompt,
  grounding, budget and providers.
- **Do not add `node-llama-cpp` to the agent in v1.** Use BYOK/Ollama; the 4B engine stays in
  the extension (optional bridge later).

**Current baseline:** extension `0.1.3`; `npm test` **184 pass / 0 fail / 10 skipped**;
`tsc` clean; BYOK done; no `agent/`.

### 0.1 Confirmed decisions (2026-11-01)

- **Prompt capture:** on by default, redacted, local-only. Never synced as raw events.
- **Watch daemon:** `hooks install` starts `shiplogue watch` silently — no stdout, no
  notifications, log file only; single instance; `shiplogue status` shows it.
- **Cloud draft sync:** off by default. No network until the user signs in and opts in.
- **Posting targets:** multi-target **Slack + Discord + Teams**. Replace the single
  `webhook.type` with `shiplogue.posting.targets[]` (legacy settings migrate), post to all
  enabled targets, report per-target failures, dedupe per target for auto-post.

### 0.2 Pickup order while the Marketplace/CI blocker is open

| # | Task | Track | Est. | Depends |
|---|---|---|---|---|
| 1 | **T1** multi-target posting (Slack/Discord/Teams) + legacy migration | extension | 2 d | — |
| 2 | **Q2** feedback loop (thumbs, one-time prompt, commands) | extension | 1.5 d | form URL |
| 3 | **A0** core extraction + `agent/` scaffold | agent | 1.5 d | — |
| 4 | **A1** event schema/store/redaction/dedupe | agent | 2 d | A0 |
| 5 | **A2** watcher daemon (fs/git/transcripts) | agent | 2 d | A1 |
| 6 | **A3** hook adapters + silent installer (Claude Code, Cursor first) | agent | 3–4 d | A1/A2 |
| 7 | **A4** MCP server + tools/resources/prompts | agent | 2 d | A1/A3 |
| 8 | **A5** CLI + render + local preview | agent | 2 d | A4 |
| 9 | **A6** extension bridge (agent events in panel/draft) | extension+agent | 2 d | A1/A2 |
| 10 | **C0** cloud repo scaffold + contracts | cloud | 1 d | — (parallel with A0–A5) |
| 11 | **C1** API skeleton + auth (formerly A0 cloud) | cloud | 2–3 d | C0 |
| 12 | **A7** cloud draft sync (drafts only, revisions, 409) | agent+cloud | 3 d | C1/A1 |
| 13 | **A8** auto-post (confirmation + local scheduler + cloud cron) | agent+cloud | 3 d | A4/A5/A7 |
| 14 | **A9** agent packaging/plugins/release | agent | 2 d | A3/A4 |
| 15 | **W0/D1** web/docs (design-gated) | cloud | 4–6 d | design |
| 16 | **R1.5** local 4B engine spike (optional, heavy) | extension | 1 d + | — |

**Parallel lanes:** (1→2) extension UX; (3→4→5→6→7→8) agent MVP; (10→11) cloud foundation;
(9) extension bridge after 4/5; (12→13) sync/auto-post; (14) packaging; (15) docs when design
lands.

**First demoable milestone:** 1–8 + Claude Code/Cursor hooks + MCP + preview. That is the agent
version of the extension, with no cloud and no Marketplace dependency.

**Blocked on external accounts:** Marketplace/Open VSX listing, CI workflows (billing lock),
real payments/Teams/Slack/Discord credentials, Cloudflare/domain/Resend, design handoff.

---

## 1. Product model

```
Capture (hooks/watcher) → local event store → normalized context → shared core
  → MCP / CLI / skills → draft file + preview → post/sync
```

The extension is one producer (IDE activity); the agent hub is another (agent activity). Both
write/read the same local store, so the user gets one stand-up regardless of where they worked.

### 1.1 Non-goals for A0–A5

- Cloud sync, accounts, billing, hosted model.
- Local 4B engine inside the agent package.
- Auto-post scheduler (A8).
- A GUI; the agent renders Markdown, writes a draft file and serves a local preview.

---

## 2. Repo/package decision

- Keep `agent/` in `Phenzic/shiplogue` for v1.
- Publish npm **`@phenzic/shiplogue-agent`**, bin **`shiplogue`** (verify name/scope at publish).
- Claude/Copilot plugin in the same repo: `plugins/shiplogue/`, `.claude-plugin/marketplace.json`.
- Shared core stays `extension/src/core`; `agent/tsconfig.json` includes it. No runtime core
  package yet.
- Split later only if the agent needs its own maintainer/release cadence; then publish
  `@phenzic/shiplogue-core` and move `agent/` + `plugins/`.

Why: shared core and capture semantics are the hard coupling; separate repos would force a
published core and version coordination before the product is proven.

---

## 3. Build chunks

### A0 — Core extraction + agent scaffold (1.5 days)

**Goal:** a runnable `agent/` package and a pure shared core.

**Read first:** `extension/src/summarize.ts`, `gather.ts`, `format.ts`, `src/core/providers/*`,
`tsconfig.json`, `package.json` scripts.

**Files:**
- `extension/src/core/{types,prompt,grounding,format,budget}.ts`
- `extension/src/core/gather/{git,github,cursor,activity}.ts`
- `agent/package.json`, `agent/tsconfig.json`, `agent/src/index.ts`, `agent/src/cli.ts`
- update extension imports and tests.

**Steps:**
1. Move pure logic out of `vscode`-coupled files:
   - prompt builder takes `{ detail, tone, format }`;
   - grounding/format/budget are data-in/data-out;
   - git takes a folder list;
   - GitHub takes token + repos;
   - Cursor takes DB path + allowed folders.
2. Extension adapters supply workspace folders, SecretStorage token and tracker store. Behavior
   must be byte-identical; no prompt text changes.
3. `agent/tsconfig.json` includes `../extension/src/core/**/*.ts`; agent builds ESM/CJS as
   appropriate; bin `shiplogue`.
4. `shiplogue status` prints agent version, paths, workspace, source count.
5. No new runtime dependencies in the extension.

**Tests:** extension suite unchanged; core tests with a temp git repo and mock provider;
`shiplogue status --json`.

**Acceptance:** no `vscode` import under `src/core`; extension tests unchanged; `shiplogue`
runs from source.

---

### A1 — Event model, store, redaction (2 days)

**Goal:** a durable, private, deduped local event log.

**Files:** `agent/src/events/{schema,store,redact,dedupe}.ts`,
`agent/src/config.ts`, `agent/test/events*.test.ts`.

**Steps:**
1. Implement the `AgentEvent` schema from `ARCHITECTURE.md` §4.1 with `schemaVersion: 1`.
2. JSONL store: `~/.shiplogue/agent/events/YYYY-MM-DD.jsonl`; atomic append; day rollover;
   retention 14 days; corrupt line skipped and logged (no prompt text).
3. `workspaceId = sha256(realpath)`; workspace-relative file paths, `/` normalized.
4. Dedupe by `(source, sessionId, sourceEventId)` or hash of `kind+file+text+minute`.
5. Redaction: token/key regex, `.env*`, key/cert/binary paths, noise dirs; caps:
   prompt/response 2 KB, tool output 1 KB, diff 4 KB; strip control chars.
6. `capturePrompts` config (default true), `captureFileReads` (default false?).
7. `state.json`: `schemaVersion`, `agentVersion`, `deviceId`, cursors, last sync.

**Tests:** append/read/order; dedupe; corrupt line; retention; redaction fixtures (sk-,
ghp_, Bearer, api_key, .env); caps; workspaceId stable.

**Acceptance:** 10k events read <100 ms; no secret in any stored fixture; unknown newer schema
refused with an actionable error.

---

### A2 — Capture daemon (2 days)

**Goal:** capture agent-agnostic activity even when hooks are thin.

**Files:** `agent/src/watch/{fs,git,transcripts}.ts`, `agent/src/daemon.ts`,
`agent/test/watch*.test.ts`.

**Steps:**
1. FS watcher: debounce 300 ms, ignore noise, record `file_edit` with add/remove counts
   (read file diff stats; no content).
2. Git watcher: watch `.git/HEAD`, `refs`, `index`; compute new commits via `git log` cursor;
   record `commit`/`branch`; include subject/body caps.
3. Transcript tailer registry: per-agent adapters for known transcript paths; parse new lines;
   cursor per file; no re-read.
4. Single-instance lock (`state.json` pid + heartbeat); `shiplogue watch` starts/stops.
5. Dedupe against hook events (same file/minute).

**Tests:** temp repo edit/commit; two watchers don't duplicate; transcript fixture; lock;
graceful shutdown.

**Acceptance:** edit + commit produces one event each; idle CPU <2%; no duplicate with hooks.

---

### A3 — Hook adapters + installer (3–4 days)

**Goal:** rich capture from every supported agent.

**Files:** `agent/src/hooks/{claude,cursor,copilot,codex,gemini}.ts`,
`agent/src/hooks/install.ts`, `agent/src/hooks/command.ts`, fixtures under
`agent/test/hooks/fixtures/`.

**Steps:**
1. `shiplogue hook <agent>` reads hook JSON on stdin, normalizes to `AgentEvent`, appends, exits
   0. Malformed input → log + exit 0 (fail-open). Timeout guard.
2. Adapters:
   - **Claude Code:** `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`,
     `PostToolUse`, `PostToolBatch`, `Stop`, `StopFailure`. Map tool name/input/output;
     `file_edit` for Edit/Write/NotebookEdit; `shell` for Bash.
   - **Cursor:** `sessionStart/End`, `beforeSubmitPrompt`, `postToolUse`, `afterFileEdit`,
     `afterAgentResponse`, `stop`, `subagentStop`, `afterShellExecution`; input has
     `conversation_id`, `generation_id`, `workspace_roots`, `transcript_path`, `cwd`.
   - **Copilot:** Claude-format hooks (`hooks/hooks.json`) in an agent plugin; map lifecycle/tool
     payloads; keep a raw passthrough for unknown fields.
   - **Codex:** `[hooks]`/`notify` payloads; map session/tool events.
   - **Gemini:** hooks (v0.26+) payloads; map lifecycle/tool events.
3. Installer: `shiplogue hooks install --agent <id>` writes/merges config with backup,
   idempotent, `--dry-run`, `uninstall`; uses installed CLI path (fallback `npx`); simulates one
   event and prints the store path.
4. Never block: hook command returns quickly; no network/model.

**Tests:** golden payload per agent (prompt, file edit, shell, stop, session); unknown event
ignored; malformed JSON fail-open; installer backup/idempotency/rollback; env path placeholders.

**Acceptance:** real Claude Code + Cursor sessions produce events in the store; hooks never block;
uninstall restores config; no secrets stored.

---

### A4 — MCP server (2 days)

**Goal:** any MCP host can use the captured context and draft.

**Files:** `agent/src/mcp/{server,tools,resources,prompts}.ts`, `agent/test/mcp*.test.ts`.

**Steps:**
1. `serveStdio` with `@modelcontextprotocol/server` v2, Zod v4, Node ≥20, ESM.
2. Tools:
   - `get_activity` (read-only): lookback 1–168, repoPath, includeGitHub, includeCursor.
   - `generate_standup`: detail/tone/format/lookback; BYOK/Ollama; clear no-provider error.
   - `render_standup`: writes draft + metadata, returns markdown/plain/paths/preview.
   - `revise_standup`: full replacement or section/bullet append; revision.
   - `post_standup`: destructive annotation, `confirm: true`, preview first;
     elicitation when the host supports it.
   - `sync_standup`: stub in A4 (returns `not_signed_in`), implemented in A7.
   - `get_agent_status`: sources, last event, versions, sync.
3. Resources `shiplogue://activity/today`, `shiplogue://draft/latest`,
   `shiplogue://status`; prompt `shiplogue-daily`.
4. No provider configured → `get_activity` still works; `generate_standup` explains the no-key
   path.

**Tests:** MCP client lists/calls tools; read-only annotations; confirmation required; preview;
redaction; no-provider error; resource/prompt shape.

**Acceptance:** `shiplogue mcp` works with Claude Code/Cursor; no-key path produces a draft;
posting never happens without confirm.

---

### A5 — CLI, render, preview (2 days)

**Goal:** a complete local workflow without any agent integration.

**Files:** `agent/src/cli/*`, `agent/src/render/*`, `agent/src/preview/server.ts`,
`agent/test/cli*.test.ts`.

**Steps:**
1. Commands from `ARCHITECTURE.md` §7.2: init, status, watch, hook, hooks, mcp, standup, render,
   preview, post, sync, config.
2. Draft files + metadata revisions; `--json` for automation.
3. Local preview: `127.0.0.1` only, random port, read-only, Copy/Markdown/Plain-text, no telemetry;
   auto-shutdown after idle.
4. Clipboard via `pbcopy`/`clip`/`xclip`; fallback prints.
5. `post --confirm` uses the same webhook adapter as the extension; dry-run by default.

**Tests:** CLI snapshots; draft revision; preview binds loopback; post dry-run; config precedence.

**Acceptance:** `shiplogue standup` prints a draft; `render --open` writes and opens preview;
no network except provider/post.

---

### A6 — Extension bridge (2 days)

**Goal:** the IDE extension includes agent activity and opens agent drafts.

**Files:** `extension/src/agentBridge.ts`, `gather.ts`, `extension.ts`,
`shiploguePanel.ts`, `package.json` settings, tests.

**Steps:**
1. Settings: `shiplogue.agent.enabled` (true), `shiplogue.agent.eventsDir` (default).
2. Read JSONL events for the lookback/workspace; filter `workspaceId`; normalize into the
   existing `gatherContext` sources.
3. Merge/dedupe with tracker: same file/minute → one touch, count sources; prompts/commands
   become context lines with caps.
4. Commands: `Shiplogue: Show Agent Activity`, `Shiplogue: Open Latest Agent Draft`.
5. Panel summary: "N agent events · M IDE saves"; status note if schema/version mismatch.
6. Version check against `state.json`; warn but keep working.

**Tests:** merge fixtures; dedupe; incompatible schema; agent disabled; no double count;
command registration.

**Acceptance:** a Claude Code session's edits/commits appear in the extension's activity and
draft without appearing twice.

---

### A7 — Cloud draft sync (3 days)

**Goal:** drafts follow the user across agent/extension/cloud.

**Files:** cloud `apps/api/src/agent/*`, migrations; `agent/src/sync/*`,
`agent/test/sync*.test.ts`.

**Steps:**
1. DB: `agent_drafts(id,user_id,date,markdown,revision,source,updated_at,deleted_at)`,
   `agent_revisions(id,draft_id,revision,markdown,created_at,source)`.
2. Routes:
   - `GET /v1/agent/drafts/:date`
   - `PUT /v1/agent/drafts/:date` (baseRevision optional)
   - `PATCH /v1/agent/drafts/:date` (operations + baseRevision) → 409 on conflict
   - `POST /v1/agent/drafts/:date/compile` (hosted model, returns new revision)
   - `POST /v1/agent/posts` (schedule; A8)
3. Auth: device/PAT token from keychain; `X-Shiplogue-Agent-Version`.
4. Agent sync client: push/pull/status; conflict UI is text (server draft + local draft paths);
   merge sections/bullets; never auto-overwrite.
5. **Drafts only** — no raw events in v1.

**Tests:** revision conflict 409; merge; auth; compile; no event upload; extension pulls same
draft.

**Acceptance:** agent pushes, cloud stores, extension reads; conflict is visible and
deterministic; no event content leaves the machine.

---

### A8 — Auto-post (3 days)

**Goal:** post the stand-up when asked or on a schedule.

**Files:** `agent/src/post/{webhook,teams}.ts`, `agent/src/schedule.ts`, cloud cron,
tests.

**Steps:**
1. `post_standup` requires `confirm: true`; returns preview; host elicitation when available;
   destructive annotation.
2. Local scheduler in `watch`: `autoPost.enabled/time/days/mode`; review notification or auto
   post with 60 s undo; dedupe per day/target; retry 3× backoff.
3. Cloud cron: uses uploaded draft; one post/day/target; idempotency key; 24 h retention.
4. Targets: **Slack + Discord + Teams (all enabled targets)**; Teams uses a Workflows Adaptive
   Card; per-target status and failure isolation; auto-post dedupes per target.

**Tests:** fake timers/DST; duplicate prevention; Teams payload; failure notification; no post
without confirm.

**Acceptance:** manual post requires confirmation; scheduled post fires once; failure leaves a
recoverable draft; no duplicate on retry.

---

### A9 — Packaging, plugins, release (2 days)

**Goal:** installable by a fresh user.

**Files:** `agent/package.json`, `plugins/shiplogue/*`, `.claude-plugin/marketplace.json`,
README/docs, CI.

**Steps:**
1. npm `@phenzic/shiplogue-agent` (public, MIT, provenance); bin `shiplogue`; Node ≥20.
2. Claude Code plugin: hooks + MCP + `skills/daily/SKILL.md`; `/shiplogue:daily`; no-key path.
3. Cursor installer/docs; Copilot agent plugin; Codex/Gemini config snippets.
4. Security review: hook fail-open, redaction, path restrictions, post confirmation, no
   telemetry, secrets.
5. Docs: install, capture matrix, privacy, troubleshooting, no-key vs BYOK, render/post.
6. CI: agent tests, hook fixtures, MCP smoke, plugin validation, package install.

**Acceptance:** fresh machine installs, captures a Claude Code/Cursor session, generates,
renders, posts with confirmation; no secret leaks; docs verified.

---

## 4. Sequencing

```
A0
 ├─ A1 ─ A2 ─ A3 (Claude/Cursor first) ─ A4 ─ A5
 ├─ A6 (after A1/A2)
 └─ A7 (after A1; parallel with A4/A5)
A8 (after A4/A5; cloud after A7)
A9 (after A3/A4)
```

**First usable milestone:** A0–A5 + Claude Code + Cursor + MCP + preview — the agent version of
the extension without cloud.

**Second:** A6 + A7 (extension/cloud sync).

**Third:** A8/A9 (auto-post/plugins).

## 5. Test strategy

- Unit: event schema/store/redaction; hook fixtures per agent; watcher temp repos; CLI.
- Integration: a fake MCP client; a temp git repo; mock provider; hook command via stdin.
- Gated real-host tests (manual): Claude Code, Cursor, Copilot, Codex, Gemini.
- No network in unit tests; no secrets in fixtures; no multi-GB downloads.
- Extension suite must remain green (184/194) after A0/A6.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Hook schemas differ/change | versioned adapters, golden fixtures, fail-open, watcher fallback |
| Capture too noisy/private | redaction, caps, skip paths, prompt toggle, local-only |
| Hook latency blocks agent | append-only, ≤10 s timeout, installed binary not npx per event |
| Duplicate activity | dedupe by event id + file/minute; source counts |
| Cloud conflict | revisions, 409, section/bullet merge, no auto-overwrite |
| Wrong post | preview + confirm + destructive annotation; no auto on generate |
| Local model absent | BYOK/Ollama; optional extension bridge later |
| Repo/package coupling | keep agent in main repo v1; split with core package later |

## 7. Open decisions

1. ~~Prompt capture default~~ — **decided: on, redacted, local-only**.
2. ~~Hook installer auto-start watch~~ — **decided: start silently, log file only**.
3. Agent package/bin name (`@phenzic/shiplogue-agent`, `shiplogue`).
4. ~~Cloud draft sync default~~ — **decided: off until account/opt-in**.
5. Local preview port/UI.
6. ~~Teams single vs multi target~~ — **decided: Slack + Discord + Teams multi-target**.
7. Repo split trigger.
8. Optional 4B bridge from extension.

## 8. Acceptance checklist

- [ ] A0: shared core pure; extension tests unchanged.
- [ ] A1: event store dedupes/redacts; no secrets.
- [ ] A2: watcher captures edits/commits once.
- [ ] A3: Claude + Cursor hooks produce events; fail-open.
- [ ] A4: MCP no-key path; post requires confirm.
- [ ] A5: CLI standup/render/preview/post dry-run.
- [ ] A6: extension merges agent events with no double count.
- [ ] A7: cloud draft sync with 409/merge.
- [ ] A8: scheduled post once/day/target; Teams.
- [ ] A9: fresh install + docs + security review.
