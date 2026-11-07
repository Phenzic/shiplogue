---
name: daily
description: Write the user's daily Shiplogue stand-up from local Claude Code/Cursor/Codex activity, using this model. No model API key is required.
---

# Daily Shiplogue stand-up

Use the Shiplogue MCP tools to write today's stand-up **yourself**, with the
model and subscription already running this session. Do not ask for a BYOK key,
Ollama, or a hosted model.

## Flow

1. Call `get_activity` with the lookback (default 24h) and the relevant
   `repoPath`. It returns local agent sessions, prompts, tool calls, file edits,
   commits, uncommitted files, and stats.
2. Write the stand-up using **only** that activity.
3. Call `save_standup` with the finished Markdown. This validates, grounds,
   formats, and saves the draft. The user should not have to save separately.
4. Show the user the saved Markdown and the draft path. If they want changes,
   call `revise_standup` (section replace/append) or `save_standup` again.

## Format

Use the fixed sections: **Yesterday**, **Today**, **Next**, **Blockers**.

- Start with a 1-2 sentence headline.
- Today is a list of workstreams:

  ```
  ### <title> [feature]
  <one outcome sentence>
    - <optional detail or file>
  ```

- Allowed tags: feature, fix, debug, security, docs, refactor, test,
  performance, chore.
- Put file paths only in indented detail. Max 3 files per workstream, 8 total.
- Never claim a deployment, merge, or completion the activity does not prove.
- If Next has no evidence, write `- None`. If there are no blockers, write
  `- None`.
- Start inferred Next bullets with `(inferred)`.
- Do not add a References section yourself; `save_standup` appends real links.

## Guardrails

- Never invent work, filenames, PR/issue numbers, or dates.
- Activity comes from the local store; do not read or print secrets.
- Cloud sync/posting requires a Shiplogue project key. If it is not configured,
  keep the draft local and say so. Do not ask for a model key.
