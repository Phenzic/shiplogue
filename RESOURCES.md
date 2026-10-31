# Resources

Reference links and findings for building Standup — especially the
Cursor / IDE prompt-history feature.

## Cursor local chat storage — VERIFIED findings (this machine, macOS)

- **DB path:** `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (SQLite, ~1.9 GB here). Also 35 per-workspace DBs under `.../workspaceStorage/<hash>/state.vscdb`.
- **Tables:** `ItemTable`, `composerHeaders`, `cursorDiskKV`.
- **`cursorDiskKV` keys:** `bubbleId:*` (individual messages — 89k here), `composerData:<id>` (conversations — 227), `agentKv:*`, `checkpointId:*`, `composer.content.<hash>`.
- **A "bubble" (message)** has: `type` (1 = user prompt, 2 = AI reply), `text`, `createdAt` (ISO string, filterable by day), plus `commits`, `pullRequests`, `todos`, `workspaceUris`, `attachedCodeChunks`, `toolResults`.
- **A `composerData`** has: `composerId`, `name`, `createdAt`, `lastUpdatedAt` (epoch ms), `fullConversationHeadersOnly` (ordered bubble refs), `conversationMap`.
- **Read safely:** open **read-only + immutable** (`file:...?mode=ro&immutable=1`) so a running Cursor is unaffected and locks are avoided.
- **Perf:** `json_extract` scan of all 89k bubbles ≈ 4.8s. Fine for once-a-day; prefilter by date to speed up.
- **Size gotcha:** the DB is ~2 GB → **`sql.js` (wasm, loads whole file into memory) is NOT viable.** Use `better-sqlite3` (native, streams from disk) or shell out to the system `sqlite3` CLI.

## Cursor storage layout / schema references

- cursor-chat-browser (storage layout, `state.vscdb`, `ItemTable`/`cursorDiskKV`) — https://github.com/thomas-pedersen/cursor-chat-browser
- cursor-chat-export (Python; dumps chats from SQLite to Markdown; schema keys) — https://github.com/somogyijanos/cursor-chat-export
- VSCode `state.vscdb` background (Cursor is a fork) — https://code.visualstudio.com/api/advanced-topics/remote-extensions

## Existing extraction tools / repos

- cursor-chat-browser — https://github.com/thomas-pedersen/cursor-chat-browser
- cursor-chat-export — https://github.com/somogyijanos/cursor-chat-export
- cursor-chat-history-mcp (MCP server over Cursor history) — https://lobehub.com/mcp/vltansky-cursor-chat-history-mcp
- SpecStory (auto-saves Cursor chats as Markdown in-repo) — https://specstory.com , https://github.com/specstoryai
- GitHub topic hubs (find latest maintained forks) — https://github.com/topics/cursor-chat , https://github.com/topics/cursor-ai

## VS Code / Cursor extension API

- Extension API overview — https://code.visualstudio.com/api
- vscode API reference — https://code.visualstudio.com/api/references/vscode-api
- FileSystemWatcher (watch the DB for changes) — https://code.visualstudio.com/api/references/vscode-api#FileSystemWatcher
- Built-in GitHub auth (`vscode.authentication.getSession`) — used for PAT-free GitHub access

## Background scheduling (macOS) — for a future always-on/bot mode

- Apple — Creating Launch Daemons and Agents — https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html
- launchd.plist man page — https://developer.apple.com/library/archive/documentation/Darwin/Reference/ManPages/man5/launchd.plist.5.html
- launchd.info (StartInterval / StartCalendarInterval guide) — https://www.launchd.info

## macOS permissions (TCC / Full Disk Access)

- Apple — controlling app access to files — https://support.apple.com/guide/security/controlling-app-access-to-files-secc1a5c7c92/web
- Apple Developer — accessing files from the macOS app sandbox — https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox

## Cloud LLM providers (BYOK now; hosted tier planned)

- Anthropic Messages API — https://docs.claude.com/en/api/messages
- OpenAI Chat Completions — https://platform.openai.com/docs/api-reference/chat
- Google Gemini API — https://ai.google.dev/gemini-api/docs
- DeepSeek API (thinking mode is on by default; disable with
  `thinking: {"type": "disabled"}` or `reasoning_effort: "none"`) —
  https://api-docs.deepseek.com/
- OpenRouter (one key for many OpenAI-compatible models) — https://openrouter.ai/docs
- Prompt engineering / structured output — https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/overview

## Publishing (both are free)

- VS Code Marketplace publishing — https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- Open VSX (Cursor/VSCodium registry) — https://open-vsx.org
