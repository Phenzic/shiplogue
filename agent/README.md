# @phenzic/shiplogue-agent

Local, agent-native stand-up worker for AI coding agents.

This package is the **agent** side of Shiplogue. The VS Code/Cursor extension lives
in `../extension`; the shared plan is in `../IMPLEMENTATION_PLAN_5.md` and
`../ARCHITECTURE.md`.

## Current state

- A1 foundation: local config, state, redacted/deduped JSONL event store, and
  `shiplogue status`.
- Capture hooks, watcher, MCP server, CLI rendering, and plugins are next (A2–A9).
- No cloud calls and no bundled model in this package.

## Commands

```bash
npm run build
npm test
node dist/cli.js status
node dist/cli.js status --json
```

Use `SHIPLOGUE_HOME` to point the agent at an isolated state directory (tests and
portable installs). The default is `~/.shiplogue`.

## Store layout

```
~/.shiplogue/agent/
  events/YYYY-MM-DD.jsonl   # append-only, redacted, deduped
  state.json                # schema/agent version, device id, cursors
  logs/                     # later
```

Events never contain full file contents. Sensitive paths (`.env*`, keys, certs,
binaries, `node_modules`, `.git`, build output) are skipped at write time.
