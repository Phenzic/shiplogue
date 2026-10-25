# Privacy

Standup is **local-first**. Here is exactly what happens to your data.

## What is stored, and where

- **IDE activity** (which files you edit/save, with timestamps) is stored only
  on your machine, as one JSON file per day in the editor's global storage
  directory for this extension. Files older than `standup.store.retentionDays`
  (default 14) are deleted on startup.
- **Settings and panel preferences** (detail level, tone, reminder time) live in
  the editor's own settings/global state.

## What is read

- `git log` for your workspace repos (your own commits only).
- The GitHub search API (merged PRs you authored, closed issues assigned to
  you), authenticated with the editor's built-in GitHub sign-in or an optional
  PAT you provide.
- Cursor's chat database (`state.vscdb`), **read-only** (`sqlite3 -readonly`,
  immutable mode), to include the AI prompts you gave your assistant. Nothing
  is written back to it. This feature is Cursor-only and can be turned off with
  `standup.cursor.enabled`.

## What leaves your machine

- Your gathered activity (commits, file names, GitHub items, AI prompts) is sent
  **only to your local Ollama server** (`standup.ollama.url`, default
  `http://localhost:11434`) to draft the stand-up.
- The **final draft** leaves your machine only when you press **Send**, and only
  to the webhook URL you configured (`standup.webhook.url`) — Discord or Slack.
- GitHub API calls go only to `api.github.com`, only when GitHub collection is
  possible (token present).

## Telemetry

None. No analytics, no crash reporting, no third-party calls beyond the above.
