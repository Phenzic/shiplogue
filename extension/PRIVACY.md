# Privacy

Standup Draft is **local-first**. Here is exactly what happens to your data.

## What is stored, and where

- **IDE activity** (which files you edit/save, with timestamps) is stored only
  on your machine, as one JSON file per day in the editor's global storage
  directory for this extension. Files older than `standupDraft.store.retentionDays`
  (default 14) are deleted on startup.
- **Settings and panel preferences** (detail level, tone, reminder time) live in
  the editor's own settings/global state.
- **Provider API keys** (if you use bring-your-own-key) are stored with VS Code
  SecretStorage, backed by your operating system's keychain. They never appear in
  `settings.json`, activity logs, output channels, or error messages. Use
  **Standup Draft: Clear API Key** to delete one; uninstalling the extension may leave
  the keychain entry behind.

## What is read

- `git log` for your workspace repos (your own commits only).
- The GitHub search API (merged PRs you authored, closed issues assigned to
  you), authenticated with the editor's built-in GitHub sign-in or an optional
  PAT you provide.
- This Marketplace build does **not** read Cursor's chat database or any other
  editor's prompt history. (The full build offers that as an opt-in feature.)

## What leaves your machine

- Your gathered activity (commits, file names, GitHub items, AI prompts) is sent
  to the backend that writes your stand-up:
  - **Ollama** (default `http://localhost:11434`) — stays on your machine unless
    you point `standupDraft.ollama.url` at a remote host.
  - **A provider you configured** — with BYOK, the prompt containing that same
    activity is sent to Anthropic, OpenAI, Google, or your OpenAI-compatible
    endpoint. Their retention and training terms apply; Standup Draft does not control
    them. Choose Ollama if that is not acceptable.
- Model listing and **Standup Draft: Test Provider** also contact the configured
  provider; they send no activity, only the request needed to list models or ask
  for a one-word reply.
- The **final draft** leaves your machine only when you press **Send**, and only
  to the webhook URLs you configured (`standupDraft.posting.targets`, or the legacy
  `standupDraft.webhook.type` / `.url`) — Slack, Discord or Teams.
- GitHub API calls go only to `api.github.com`, only when GitHub collection is
  possible (token present).

## Feedback

Thumbs and feedback prompts are local counters only. Nothing is sent anywhere
until you choose to open the feedback form or the star/rate pages, and those
URLs carry only your extension version, OS and model backend — never your draft
or activity. Disable the occasional prompt with `standupDraft.feedback.enabled`.

## Telemetry

None. No analytics, no crash reporting, no third-party calls beyond the above.
