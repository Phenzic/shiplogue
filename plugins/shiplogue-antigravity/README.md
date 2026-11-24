# Shiplogue for Antigravity

Write today's stand-up from local Antigravity, Claude Code, Cursor, and Codex
activity using the agent's own model.

## Install

```bash
agy plugin install shiplogue
# or, before Marketplace listing:
agy plugin install ./plugins/shiplogue-antigravity
```

Then use `/shiplogue-daily` in an Antigravity conversation.

## What it includes

- MCP server with `get_activity`, `save_standup`, `render_standup`,
  `revise_standup`, and `get_agent_status`
- `shiplogue-daily` skill
- Always-on rules for the daily flow

Cloud sync/posting is optional and requires a Shiplogue project key.
