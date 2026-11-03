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
- This build does **not** post anywhere. The final draft leaves your machine only
  when you copy it yourself.
- GitHub API calls go only to `api.github.com`, only when GitHub collection is
  possible (token present).

## Telemetry

None. No analytics, no crash reporting, no third-party calls beyond the above.
