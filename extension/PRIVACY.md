# Privacy

Shiplogue is **local-first**. Here is exactly what happens to your data.

## What is stored, and where

- **IDE activity** (which files you edit/save, with timestamps) is stored only
  on your machine, as one JSON file per day in the editor's global storage
  directory for this extension. Files older than `shiplogue.store.retentionDays`
  (default 14) are deleted on startup.
- **Settings and panel preferences** (detail level, tone, reminder time) live in
  the editor's own settings/global state.
- **Provider API keys** (if you use bring-your-own-key) are stored with VS Code
  SecretStorage, backed by your operating system's keychain. They never appear in
  `settings.json`, activity logs, output channels, or error messages. Use
  **Shiplogue: Clear API Key** to delete one; uninstalling the extension may leave
  the keychain entry behind.
- **The optional Shiplogue connector key** is stored with VS Code SecretStorage,
  never in `settings.json` or logs. **Shiplogue: Disconnect Cloud** deletes it.
  The key is only sent to the cloud origin configured in `shiplogue.cloud.url`
  (default `https://shiplogue.dev`) as an `Authorization` header.

## What is never read

- **Project file contents.** Shiplogue records file paths and timestamps only.
- **Private paths.** `.env` (and `.env.*`), private keys/certificates, credential
  stores, `.ssh`/`.aws`/`.gnupg`/`.kube`/`.docker` directories, and any path
  matched by `.gitignore` or another `.*ignore` file in the workspace are filtered
  out before an event is stored. This is enforced in the tracker, the git
  collector and the activity store.

## What is read

- `git log` for your workspace repos (your own commits only).
- The GitHub search API (merged PRs you authored, closed issues assigned to
  you), authenticated with the editor's built-in GitHub sign-in or an optional
  PAT you provide.
- Local chat stores for **Cursor, VS Code Copilot and Antigravity**, **read-only**,
  to include the AI prompts you gave your assistant. Cursor uses `state.vscdb`
  (`sqlite3 -readonly`, immutable); VS Code-family hosts use their local
  `chatSessions` JSON/JSONL files. Nothing is written back. Disable with
  `shiplogue.cursor.enabled`.

## What leaves your machine

- Your gathered activity (commits, file names, GitHub items, AI prompts) is sent
  to the backend that writes your stand-up:
  - **Ollama** (default `http://localhost:11434`) — stays on your machine unless
    you point `shiplogue.ollama.url` at a remote host.
  - **A provider you configured** — with BYOK, the prompt containing that same
    activity is sent to Anthropic, OpenAI, Google, or your OpenAI-compatible
    endpoint. Their retention and training terms apply; Shiplogue does not control
    them. Choose Ollama if that is not acceptable.
- Model listing and **Shiplogue: Test Provider** also contact the configured
  provider; they send no activity, only the request needed to list models or ask
  for a one-word reply.
- **Optional cloud sync.** If you connect a connector key and leave
  `shiplogue.cloud.enabled` on, the finished stand-up draft (Markdown), its date,
  title, the model label, and the configured time-saved estimate are sent to the
  Shiplogue API at `shiplogue.cloud.url` (default `https://shiplogue.dev`) so it
  can appear on your private dashboard. Raw activity, prompts, file contents, and
  activity events are **not** uploaded by this build. Disconnect the connector or
  turn off `shiplogue.cloud.enabled` to keep drafts entirely local.
- This build does **not** post anywhere. The final draft leaves your machine only
  when you copy it yourself, or when optional cloud sync stores it as a draft on
  your dashboard.
- GitHub API calls go only to `api.github.com`, only when GitHub collection is
  possible (token present).

## Telemetry

None. No analytics, no crash reporting, no third-party calls beyond the above.
