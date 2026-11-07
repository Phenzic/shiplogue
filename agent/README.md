# @phenzic/shiplogue-agent

Local, agent-native stand-up worker for AI coding agents.

This package is the **agent** side of Shiplogue. The VS Code/Cursor extension lives
in `../extension`; the shared plan is in `../IMPLEMENTATION_PLAN_5.md` and
`../ARCHITECTURE.md`.

## Current state

- Local config, state, redacted/deduped JSONL event store, and `shiplogue status`.
- Hook capture for Claude Code, Cursor Agent, and Codex (`shiplogue hook`).
- MCP stdio server (`shiplogue mcp`) with `get_activity`, `save_standup`,
  `render_standup`, `revise_standup`, `get_agent_status`, resources, and the
  `shiplogue-daily` prompt.
- Local draft store under `~/.shiplogue/agent/drafts/`.
- Claude Code plugin/skill, Cursor/Codex installer docs in `../plugins/shiplogue`.
- No cloud calls and no bundled model. Agent-authored drafts use the host model.

## Commands

```bash
npm run build
npm test
node dist/agent/src/cli.js status
node dist/agent/src/cli.js status --json
node dist/agent/src/cli.js mcp
```

Use `SHIPLOGUE_HOME` to point the agent at an isolated state directory (tests and
portable installs). The default is `~/.shiplogue`.

## Store layout

```
~/.shiplogue/agent/
  events/YYYY-MM-DD.jsonl   # append-only, redacted, deduped
  drafts/YYYY-MM-DD.md      # agent-authored draft
  drafts/YYYY-MM-DD.json    # revision, quality, warnings
  state.json                # schema/agent version, device id, cursors
  logs/agent.log            # hook failures only; no prompt text
```

Events never contain full file contents. Sensitive paths (`.env*`, keys, certs,
binaries, `node_modules`, `.git`, build output) are skipped at write time.
