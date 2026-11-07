# Shiplogue Agent ↔ Cloud contract (v0 draft)

> For the Shiplogue Cloud team. Status: proposed 2026-11-07, matching agent
> `0.3.0-dev.0` / extension `0.1.12`.
>
> **Default mode is A:** the AI agent's own model writes the stand-up. Cloud does
> **not** generate the default draft. Cloud is the master system for project
> association, storage, history, organization/precision, and delivery.
>
> **Mode B (later, opt-in):** Cloud AI may rewrite/organize a submitted draft.
> It is not the default and must never require the user to supply a model key.

## 1. Activation and identity

- Local-first: capture and drafting work with **no** Shiplogue credential.
- Cloud sync/posting requires a **Shiplogue project key/id** (not a model key).
- Project key resolution:
  - `SHIPLOGUE_PROJECT_KEY` env (agent/CLI), or
  - the project key stored by the extension's cloud connect flow, or
  - `shiplogue login` (future) writing to the OS keychain.
- Never store the project key in event files, draft metadata, logs, or MCP
  tool output.
- Every request carries:
  - `Authorization: Bearer <project key>`
  - `X-Shiplogue-Agent-Version: <agent semver>`
  - `X-Shiplogue-Schema-Version: 1`
  - `Idempotency-Key: <sha256(projectId + date + revision + content hash)>`

## 2. Endpoints needed

```
POST   /v1/agent/reports                 create/upsert a report for a date
PUT    /v1/agent/reports/:date           full draft write (revision/If-Match)
PATCH  /v1/agent/reports/:date           section/bullet operations + baseRevision
GET    /v1/agent/reports/:date           read the canonical cloud draft
POST   /v1/agent/reports/:date/compile   Mode B: cloud AI organizes/rewrites
POST   /v1/agent/reports/:date/post      deliver to Slack/Discord/Teams
GET    /v1/agent/status                  project, plan, last report, targets
```

`POST /v1/agent/reports` may upsert by `(projectId, date)`; return `201` on
create and `200` on update. `PUT`/`PATCH` use `baseRevision`/`If-Match`; on
conflict return `409` with the server draft so the agent can merge.

## 3. Draft payload (Mode A)

```json
{
  "projectId": "proj_...",
  "date": "2026-11-07",
  "timezone": "Africa/Lagos",
  "revision": 3,
  "source": "claude-code",
  "model": "claude-sonnet-4-...",
  "agentVersion": "0.3.0",
  "schemaVersion": 1,
  "markdown": "**Yesterday**\n...\n**Today**\n### ... [feature]\n...",
  "plainText": "...",
  "stats": {
    "events": 42,
    "sessions": 3,
    "prompts": 18,
    "responses": 16,
    "toolCalls": 31,
    "shells": 7,
    "fileEdits": 12,
    "fileReads": 9,
    "filesTouched": 14,
    "commits": 6,
    "commitFiles": 19,
    "uncommittedFiles": 4,
    "diff": { "additions": 320, "deletions": 88 },
    "github": { "prs": 2, "issues": 1 },
    "tokens": {
      "input": 12000,
      "output": 3400,
      "cacheRead": 800,
      "cacheWrite": 0,
      "total": 15400,
      "costUsd": 0.42
    },
    "bySource": { "claude-code": 30, "cursor": 8, "git": 4 }
  },
  "sources": ["claude-code", "cursor", "git"],
  "quality": { "score": 94, "issues": [] },
  "warnings": []
}
```

All stats are optional but strongly preferred. Token/usage values are
best-effort: capture them when the host exposes them, never guess them.

### What cloud should do with stats

- Attach them to the project/date report; aggregate for history, weekly recap,
  and dashboard coverage.
- Deduplicate by `(projectId, date, report revision)` and by event/session ids
  when event summaries are sent.
- Do **not** require raw prompts/tool output; v1 sends aggregate stats and the
  final draft only. Raw event sync is a later opt-in, encrypted track.
- Preserve `bySource` so the UI can show Claude Code / Cursor / Codex / git
  contribution.

## 4. Mode B (Cloud AI organize/rewrite)

`POST /v1/agent/reports/:date/compile` accepts:

```json
{
  "baseRevision": 3,
  "mode": "organize" | "rewrite",
  "instructions": "optional user intent"
}
```

Returns a **new revision** plus `{ markdown, model, usage }`. Rules:

- Never silently replace a user/agent draft; return a new revision and diff.
- The agent/extension shows the cloud version for review before posting.
- Require the project key; no model key from the user.
- If the project has no hosted-model entitlement, return `402` with an upgrade
  path; the local/agent-authored draft remains usable.

## 5. Posting and scheduling

- `POST /v1/agent/reports/:date/post` accepts `{ targets?: ["slack","discord","teams"], confirm: true }`.
- No post without explicit confirmation. Cloud owns target credentials and
  per-target status.
- Return `202` + delivery id for queued delivery, or `200` with per-target
  results. Support idempotency to prevent double posts.
- Scheduled/auto-post is cloud cron on the final draft; dedupe per day/target.

## 6. Extension interop

- The extension and agent should converge on the **same cloud report** for a
  project/date.
- Extension sets project id via its cloud connect flow; agent uses
  `SHIPLOGUE_PROJECT_KEY` or the same stored credential.
- Cloud returns `source` tags and coverage so the extension can render the
  Claude Code / Cursor / Codex badges.
- Draft history should show revisions from both producers; cloud is the source
  of truth for synced reports, local files remain offline copies.

## 7. Security and privacy checklist for cloud

- [ ] Project-key auth scoped to one project; revocable; no model keys.
- [ ] TLS only; no project key in query strings or logs.
- [ ] Store final drafts + aggregate stats; raw events only on explicit opt-in.
- [ ] Retention/deletion endpoint for agent reports.
- [ ] Rate limits and idempotency for hook-heavy days.
- [ ] 409 conflict response includes the server draft + revision.
- [ ] `402` for Mode B without hosted-model entitlement.
- [ ] Audit trail for posts and scheduled deliveries.
- [ ] No telemetry from the agent by default.

## 8. Distribution: does MCP need hosting?

**No.** `shiplogue mcp` is a local **stdio** MCP server:

- It runs on the user's machine, launched by Claude Code / Cursor / Codex.
- It reads the local event/draft store and calls local git; no inbound server.
- Distribution is the npm package `@phenzic/shiplogue-agent` with bin
  `shiplogue`, plus the Claude plugin and host installers.
- A hosted HTTP MCP server is only needed later for browser/cloud-only hosts;
  it is not required for this MVP.

## 9. Open items for cloud

1. Confirm final endpoint names (`/v1/agent/reports` vs `/v1/agent/drafts`).
2. Confirm project-key issuance UX and whether device auth/PAT replaces raw keys.
3. Confirm Mode B entitlement and model routing.
4. Confirm stats schema fields and retention.
5. Confirm whether extension + agent share one report id or separate producer
   revisions merged by section.
