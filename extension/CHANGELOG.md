# Changelog

All notable changes to this project will be documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1] — 2026-10-28

Beta packaging pass. No behaviour changes.

### Changed

- Publisher id is `phenzic`; repository, bugs and homepage now point at
  `Phenzic/standup` instead of placeholder URLs.
- Declared `extensionKind: workspace` and capabilities for untrusted and virtual
  workspaces, so the extension is disabled rather than half-working in Restricted
  Mode or on virtual filesystems.
- Activity storage path follows the publisher id: `globalStorage/phenzic.standup/`.
  Logs from `standup-dev` dev builds are not migrated (0.1.0 was never public).
- `npm test` now discovers suites recursively under `test/`, so future
  `test/model` and `test/core` suites cannot be silently skipped.
- Added a pinned `npm run package` script (`@vscode/vsce` 4.1.0).

## [0.1.0] — 2026-10-25

### Added

- Reasoning-model (gpt-oss, deepseek-r1, …) support: empty/truncated responses retry once with a raised budget and thinking disabled; new settings `standup.ollama.numPredict`, `standup.ollama.numCtx`, `standup.ollama.think`.
- First-run Ollama health check: warns when Ollama is unreachable (with an install link) or the configured model isn't pulled (Pull now / pick another installed model).
- Deterministic grounding pass: file paths and `#numbers` the model invented are stripped from the draft, with a non-modal "⚠ Removed N unverifiable mention(s)" note in the panel.
- Prompt-injection hygiene: untrusted activity is delimited and sanitized (`[filtered]` markers), with a prompt rule telling the model to treat activity as data.
- Input caps for busy days (25 commits / 20 AI prompts / 30 GitHub items, newest first, commits deduped by hash) with "showing N of M" indicators in the prompt and panel.
- Cancellable generation: Cancel button, busy state that disables Regenerate/Detail/Tone, per-phase progress with elapsed seconds, and `standup.generate.timeoutSeconds` (default 180).
- Tone setting (`standup.tone`: neutral/junior/mid/senior) with a panel selector, persisted like Detail.
- Activity retention: `standup.store.retentionDays` (default 14; 0 keeps forever), pruned on startup.
- Path-keyed activity scoping (`projectPath`) so same-named folders in different windows no longer leak into each other; legacy name-based fallback for old log entries.
- `CHANGELOG.md`, `PRIVACY.md`, CI workflow (Ubuntu/macOS/Windows × Node 20), extension icon and Marketplace metadata.

### Fixed

- Empty-response error from thinking models that exhausted their output budget on reasoning (was a launch blocker: e2e suite went from 1/5 to 5/5 against gpt-oss:20b).
- Length-truncated model responses (cut off mid-sentence) now retry once with a raised budget instead of shipping half a stand-up.
- Cursor workspace scoping filtered after a global `LIMIT 200`, silently dropping a quiet workspace's prompts on busy days — filtering now happens inside SQL.
- Windows path handling: backslash activity paths normalized at record time, `file:///C:/…` workspace URIs match correctly.
- Discord posts were silently truncated at 1990 chars — now split into up to 3 ordered messages, with the full text copied to the clipboard beyond that.
- Slack posts now convert Markdown to mrkdwn (`**bold**` → `*bold*`, links → `<url|text>`).
- A failed activity-log write no longer loses buffered events; writes are temp-file + rename so a crash can't tear a day file.
- A window with no folder open and `scope: "workspace"` now gathers the whole day (with a panel note) instead of nothing.

## [0.0.8] — 2026-07-13

Baseline: local-first stand-up generation from git commits, tracked file
touches, GitHub issues/PRs and Cursor AI prompts; fixed Done/Next/Blockers
template with three detail levels; deterministic sub-list formatting and
references block; Discord/Slack webhook posting; daily reminder; full unit +
integration + gated real-model test suites.
