# Privacy

Standup is **local-first**. Here is exactly what happens to your data.

## What is stored, and where

- **IDE activity** (which files you edit/save, with timestamps) is stored only
  on your machine, as one JSON file per day in the editor's global storage
  directory for this extension. Files older than `standup.store.retentionDays`
  (default 14) are deleted on startup.
- **Settings and panel preferences** (detail level, tone, reminder time) live in
  the editor's own settings/global state.
- **Provider API keys** (if you use bring-your-own-key) are stored with VS Code
  SecretStorage, backed by your operating system's keychain. They never appear in
  `settings.json`, activity logs, output channels, or error messages. Use
  **Standup: Clear API Key** to delete one; uninstalling the extension may leave
  the keychain entry behind.

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
  to the backend that writes your stand-up:
  - **Ollama** (default `http://localhost:11434`) — stays on your machine unless
    you point `standup.ollama.url` at a remote host.
  - **A provider you configured** — with BYOK, the prompt containing that same
    activity is sent to Anthropic, OpenAI, Google, or your OpenAI-compatible
    endpoint. Their retention and training terms apply; Standup does not control
    them. Choose Ollama if that is not acceptable.
- Model listing and **Standup: Test Provider** also contact the configured
  provider; they send no activity, only the request needed to list models or ask
  for a one-word reply.
- The **final draft** leaves your machine only when you press **Send**, and only
  to the webhook URL you configured (`standup.webhook.url`) — Discord or Slack.
- GitHub API calls go only to `api.github.com`, only when GitHub collection is
  possible (token present).

## Telemetry

None. No analytics, no crash reporting, no third-party calls beyond the above.
