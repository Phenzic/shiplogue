# Shiplogue Agent 0.3.2

**Shared prompt fixes, safer drafts, and Antigravity support.**

## Fixed

- `## Yesterday` / `## Today` / `## Next` / `## Blockers` headings are now
  recognized and normalized to the canonical `**bold**` format.
- `save_standup` keeps Yesterday intact and no longer treats the whole draft as
  a headline when the model uses Markdown headings.
- `revise_standup` accepts both heading styles and no longer drops sections.
- The skill now says: call `save_standup` exactly once. If it returns quality
  suggestions, show them to the user; do not rewrite and save again
  automatically.

## Added

- Shared prompt generation: the Claude Code and Antigravity skills are generated
  from `extension/src/core/prompt.ts`, so extension and agent rules stay in sync.
- Antigravity plugin packaging: MCP config, `shiplogue-daily` skill, and
  always-on rules.

## Install

```bash
npm install -g @phenzic/shiplogue-agent@0.3.2
```

Claude Code and Antigravity use `npx` in the plugin config and do not require a
global install. Cursor/Codex hooks require the CLI on `PATH`.

## Notes

- No model key is required for agent-authored drafts.
- Cloud sync/posting remains optional and uses a Shiplogue project key.
- MCP is local stdio; no server hosting is required.
