# Shiplogue plugin

Write today's stand-up from your local Claude Code, Cursor Agent, or Codex
activity. The stand-up is written by the **agent's own model**; no model API key,
BYOK key, or local model is required. A Shiplogue Cloud project key is only
needed for cloud sync/posting.

## Installation

**Claude Code and Antigravity** use `npx` and need **no global install** and no
manual build. The plugin config runs
`npx -y @phenzic/shiplogue-agent@0.3.2 mcp`, so the agent is fetched on first use.

**Cursor/Codex hooks** need the CLI on `PATH`:

```bash
npm install -g @phenzic/shiplogue-agent@0.3.2
shiplogue status
```

The MCP server is local stdio. **No server hosting is required.**

## Claude Code

```bash
claude plugin marketplace add Phenzic/shiplogue
claude plugin install shiplogue@shiplogue
```

Then in Claude Code:

```
/shiplogue:daily
```

The plugin ships:

- MCP tools `get_activity`, `save_standup`, `render_standup`,
  `revise_standup`, `get_agent_status`
- the `shiplogue-daily` prompt
- the `daily` skill and `/shiplogue:daily` command
- Claude Code hooks in `hooks/hooks.json` (run through `npx`)

If a hook command fails, it exits 0 and logs under
`~/.shiplogue/agent/logs/agent.log`; it never blocks Claude.

## Cursor Agent

```bash
shiplogue hooks install --agent cursor
```

This writes `~/.cursor/hooks.json` (backup kept). Add the MCP server to Cursor's
MCP config:

```json
{
  "mcpServers": {
    "shiplogue": { "command": "shiplogue", "args": ["mcp"] }
  }
}
```

Then ask Cursor's agent to run the Shiplogue daily flow. Cursor hooks capture
session starts/ends, prompts, tools, file edits, shell commands, and responses.

## Codex CLI

```bash
shiplogue hooks install --agent codex
```

Or use Codex's notify hook:

```toml
# ~/.codex/config.toml
notify = ["shiplogue", "hook", "codex", "--notify"]
```

Add the MCP server:

```toml
[mcp_servers.shiplogue]
command = "shiplogue"
args = ["mcp"]
```

Codex hooks may require review in `/hooks`; project-level hooks must be trusted.

## Antigravity

The Antigravity plugin lives in [`../shiplogue-antigravity`](../shiplogue-antigravity).

```bash
agy plugin validate ./plugins/shiplogue-antigravity
agy plugin install ./plugins/shiplogue-antigravity
agy plugin list
```

Then in Antigravity:

```text
/shiplogue-daily
```

The Antigravity plugin ships the same MCP server, skill instructions, and rules.
It currently relies on the extension/IDE prompt capture plus git for activity;
native Antigravity lifecycle hooks are not installed yet.

## What gets stored

```
~/.shiplogue/agent/
  events/YYYY-MM-DD.jsonl
  drafts/YYYY-MM-DD.md
  drafts/YYYY-MM-DD.json
  state.json
  logs/agent.log
```

Events are redacted and capped at write time; sensitive paths (`.env*`, keys,
certs, binaries, `node_modules`, `.git`, build output) are skipped. Raw events
never sync to Shiplogue Cloud. Drafts do, when a project key is configured.

## Privacy

- Local-first; no network for capture or agent-authored drafts.
- GitHub activity is read only when `GITHUB_TOKEN` is set.
- Cloud sync/posting requires an explicit Shiplogue project key and opt-in.
