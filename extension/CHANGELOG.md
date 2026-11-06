# Changelog

All notable changes to this project will be documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.10] — 2026-11-05

### Added

- **Queued cloud delivery:** Send now handles the cloud's `202` response, polls
  `/api/v1/deliveries/:id`, and marks a draft Sent only after a target succeeds.
  Server-side `402` responses map to the Pro upgrade path. Sends use a stable
  content/day idempotency key so double-clicks do not post twice.
- **Cloud history paging:** Pro history loads from `/api/v1/standups` with cursor
  paging and shows cloud-side sent/scheduled metadata, source tags, and project
  names. Free users keep the local history window.
- **Automatic weekly recap:** every Friday at 18:00 local by default, Shiplogue
  compiles the stored daily drafts into one weekly recap, adds it to draft
  history, and shows a "weekly recap is ready" prompt. The day and time are
  configurable with `shiplogue.weeklyRecap.*`. It does not scan commits, files,
  prompts, or the network; stored daily drafts are the source of truth.
- **Source tags on summaries:** each synced stand-up records the IDE or agent
  that produced it, and multi-source summaries keep every tag. The dashboard
  renders the matching VS Code / Cursor / Claude Code / other badges.
- **Send via Shiplogue Cloud (Pro):** the panel and history now post a stand-up by
  asking Shiplogue Cloud to deliver it to the workspace's Slack/Discord/Teams
  targets — the extension never calls webhooks directly. Scheduled posting is
  configured in the dashboard and also runs cloud-side. Free workspaces see an
  upgrade prompt instead.
- **Feedback & rating prompts:** a one-time-per-version question after a few
  successful drafts (Share feedback / Star on GitHub / Not now / Don't ask
  again), a 👍-triggered star nudge, and new commands **Shiplogue: Share
  Feedback**, **Star on GitHub**, **Rate on the Marketplace**. Settings:
  `shiplogue.feedback.enabled`, `shiplogue.feedback.promptAfter`.

### Changed

- Daily generation now uses the local calendar day (00:00 → now), not a rolling
  24-hour window. The saved previous-day draft fills the Yesterday section; an
  empty Today/Next/Blockers stays honest instead of inventing activity.
- The panel shows structured coverage metadata: commits, commit files, IDE
  files, GitHub items, agent sessions, and uncommitted files.
- Agent session metadata is summarized locally from captured prompts; no
  terminal output is captured.
- The install card opens the selected IDE through its protocol and offers a
  download fallback instead of linking to the marketplace.

### Fixed

- Draft-mode switching now toggles the actual pane state, so Markdown and Plain
  no longer open a blank pane after the preview.
- The panel's file count now includes distinct files from commits as well as IDE
  save/edit activity, and the meta line shows the collection window (`last Nh`).

### Changed

- **Redesigned panel**: rendered Markdown preview by default (with raw Markdown
  and Plain-text modes), a verification strip ("N claims verified · M removed ·
  K inferred") with a details list, unverified claims highlighted inline in
  needs-review drafts, a model/backend chip, generation stats in the status bar,
  and inline Detail/Tone controls.
- **Draft history tab**: searchable, day-grouped list of every draft with its
  model, detail/tone and send status; preview, copy or restore a draft. Stored
  locally under `shiplogue.history.retentionDays` (7 by default) and
  `shiplogue.history.maxEntries`; the cloud remains the long-term store for Pro.
- The panel UI now lives in `media/` (HTML/CSS/JS) with a strict CSP and
  `asWebviewUri` assets instead of a TypeScript template string.

## [0.1.9] — 2026-11-05

Local project workspaces, weekly recaps, and safer cloud grouping.

### Added

- Local project workspaces: generation now follows the active project folder, and
  synced stand-ups carry a stable local workspace ID and project name, so two
  projects no longer merge into one daily summary.
- **Shiplogue: Generate Weekly Recap**: a local, copyable seven-day recap built
  from stored daily drafts. (0.1.10 makes this automatic and configurable.)
- Local stand-up history: generated drafts are saved atomically per local day and
  kept for 7 days; copied/reviewed drafts replace the generated text. **Shiplogue:
  Open Stand-up History** opens the last week, and yesterday's saved stand-up is
  fed to the model for the Yesterday section instead of being re-inferred.
- Reviewed copies are upserted to the cloud for the same workspace/date, so the
  dashboard keeps the final text rather than only the first generated draft.
- Property allowlisting for telemetry events; unknown metadata is rejected by
  the cloud endpoint.

### Changed

- One built-in stand-up format: **Yesterday / Today / Next / Blockers** (`Done`
  becomes `Today`), fixed and not user-configurable. Template markers are
  stripped, referenced files are rendered as indented sub-bullets instead of
  sibling bullets, and plain text keeps the sub-bullet indentation.
- Paid workspaces can relabel/reorder those four sections from a cloud profile;
  free plans always fall back to the built-in labels/order. There is no local
  custom-format setting.
- Cloud sync titles include the local project name.
- Sending the same day's stand-up for two different local projects is supported.

## [0.1.8] — 2026-11-05

Optional cloud sync, reliable update notices, stronger grounding, and a context
preflight.

### Added

- Opt-in, cloud-only product telemetry for the Shiplogue admin dashboard:
  installation ID, extension/editor/provider metadata, generated/copied/
  regenerated events, generation failures, connector lifecycle, and sync
  success/failure. Telemetry is off by default and never includes stand-up text,
  prompts, paths, repository names, or error messages. Setting:
  `shiplogue.telemetry.enabled`.
- Optional cloud connector: **Shiplogue: Connect Cloud** validates a connector key
  against the Shiplogue API and stores it in SecretStorage. Generated stand-ups
  sync to the private dashboard after generation, with a configurable estimated
  time saved. **Cloud Status** and **Disconnect Cloud** are included. Local
  generation still works with no account, and raw activity is not uploaded.
- Extension-side update check: on activation the extension compares the running
  version against the latest **Marketplace and Open VSX** listing (the source of
  truth for installs) and notifies once per version when a newer build exists.
  The notice offers **Update now**, **Open listing** and **Enable auto-update**;
  **Shiplogue: Check for Update** runs the check on demand. Network or parse
  failures are swallowed so the check never breaks activation.
- New setting `shiplogue.update.enabled` (boolean, default `true`) to opt out of
  update notifications.
- Grounding v2: structured claim checks for paths, numbers, URLs, completion,
  people and dates. Unsupported claims trigger one repair call, then set
  `needsReview` with a panel warning; invented URLs are removed deterministically.
- Context preflight: set `shiplogue.model.contextTokens` to guarantee no
  over-budget prompt is sent; activity is trimmed by priority and the draft
  reports what was dropped. `0` disables preflight.
- AI prompt capture now covers **Cursor, VS Code Copilot and Antigravity** chat
  stores (read-only), with a background watcher for continuous capture.
- A small provenance note under **Copy** shows the model used, e.g.
  "done with OpenAI BYOK" or "done with Ollama".

### Changed

- Trimmed the README to what a user needs: what it does, features, compatibility,
  install, quick start, model/privacy choices, common settings and troubleshooting.
- Added `shiplogue.dev`, Marketplace and Open VSX links; shortened the package
  description and pointed `homepage` at the domain. The docs site lives in the
  cloud repo (Fumadocs) and will be served at `docs.shiplogue.dev`.

### Notes

- Marketplace/Open VSX installs keep the editor's built-in auto-update; the
  extension cannot force the editor-wide setting, so the notice links to it.
  The notice is what covers manual VSIX installs, which have no update channel.
- No posting in this build; drafts are copied, not sent.
- No model is bundled. Use Ollama or your own API key.

## [0.1.7] — 2026-11-03

Bundled-model cleanup. No functional change.

### Changed

- Removed the cancelled bundled local-model plan from the README and roadmap.
- Removed the reserved `local` value from `shiplogue.model.backend`. Backends are
  `auto`, `provider` and `ollama`; there is no bundled model.
- Model options are Ollama, BYOK, or the hosted Shiplogue provider (planned, paid).

### Documentation

- Rewrote the Marketplace details: features at a glance, install paths for VS Code /
  Cursor / Antigravity, a first-run quick start, and the Marketplace-vs-source
  version split.
- Added the Marketplace badge and removed the visible screenshot placeholder until
  a real capture is available.
- Corrected the backend list and the shortcut documentation (`Cmd+Shift+'` /
  `Ctrl+Shift+'`).

## [0.1.6] — 2026-11-03

Keyboard shortcut release.

### Added

- `Cmd+Shift+'` (macOS) / `Ctrl+Shift+'` (Windows/Linux) fires
  **Shiplogue: Generate Today's Update** in VS Code, Cursor, Antigravity and other
  VS Code-compatible hosts. **Shiplogue: Configure Keyboard Shortcut** opens the
  editor's keybindings UI filtered to the command.
- Hard privacy filter: private paths are never tracked. `.env`, keys/credential
  stores and `.ssh`/`.aws`-style directories are always excluded; any path matched
  by `.gitignore` or another `.*ignore` file is excluded too. Enforced in the
  tracker, the git collector and the activity store.

## [0.1.5] — 2026-11-02

Workflow-validation release. No functional changes; the extension is identical to
0.1.4. This release verifies GitHub Actions Trusted Publishing (`vsce publish
--oidc`) end to end.

## [0.1.4] — 2026-11-02

Marketplace-safe build: copy-only, with Cursor capture.

### Changed

- Removed Discord/Slack webhook posting: the `shiplogue.webhook.type/url` settings,
  the panel Send button and `post.ts` are gone. Drafts are copied, not sent.
- Cursor chat-DB capture remains enabled by default; turning it off still works via
  `shiplogue.cursor.enabled`.
- Everything from 0.1.3.

## [0.1.3] — 2026-11-01

Packaging cleanup for the first Marketplace publish, plus a Windows path-scoping
fix.

### Fixed

- Workspace scope now normalizes an event's stored `projectPath` before matching,
  so activity logs written with Windows backslashes still belong to the open
  folder.
- Removed a stray runtime dependency (`package`) from the manifest.
- Trimmed `keywords` to the documented 10-tag limit.
- Stopped shipping the internal `MANUAL_QA.md` in the VSIX.
- Pointed the extension README's license, privacy, contributing and project links
  at absolute GitHub URLs, so the Marketplace listing no longer renders broken
  redirect/404 links.
- The publish workflow uses Node 22, which `vsce` 4.x requires.
- CI: the Windows runner installs `sqlite3` (the Cursor tests build synthetic
  databases), and the Cursor tests set `USERPROFILE` as well as `HOME`.

## [0.1.2] — 2026-10-31

Rename to Shiplogue. No change to how drafts are produced.

### Changed

- **The extension is now Shiplogue.** Extension id `phenzic.shiplogue`, commands
  and settings under `shiplogue.*`, configuration title `Shiplogue`.
- Local activity moved to `globalStorage/phenzic.shiplogue/`.
- Provider keys are stored under the `shiplogue.provider.*` secret names. Keys
  saved by a 0.1.1 install are not readable by the renamed extension, so
  **run `Shiplogue: Set API Key` again** after upgrading.
- Repository links point at `Phenzic/shiplogue`.

### Notes

- 0.1.2 is a new extension id, not an update of 0.1.1. Uninstall the old build
  first, or keep both while you compare — they use separate settings, secrets
  and storage.
- Nothing was published to the Marketplace under the old id, so no listing was
  renamed.

## [0.1.1] — 2026-10-29

Beta packaging and BYOK.

### Added

- **Bring your own API key.** Anthropic, OpenAI, Google Gemini and any
  OpenAI-compatible endpoint can now write stand-ups, so Ollama is no longer
  required. Keys are stored with VS Code SecretStorage (OS keychain) and never
  written to settings or logs.
- Commands **Standup: Set API Key**, **Standup: Clear API Key** and
  **Standup: Test Provider**. Setup lists the provider's models and can fall back
  to a manually typed model id.
- Settings `standup.model.backend`, `standup.provider.type`,
  `standup.provider.model`, `standup.provider.baseUrl`,
  `standup.provider.maxOutputTokens`.
- The review panel shows which engine wrote the draft (`via Ollama · llama3.2`,
  `via OpenAI · gpt-4o-mini`, …).
- Provider errors are actionable and key-free (auth, quota, rate limit, context
  length, unavailable). There is no silent fallback from a provider to Ollama.

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
- The startup Ollama health check only runs when Ollama is the backend that would
  actually be used.

### Fixed

- BYOK generation on thinking-by-default endpoints (DeepSeek, reasoning models served through
  OpenRouter/vLLM/llama.cpp): a reasoning-only response now retries once with a raised budget
  (4× the detail budget, at least 4096 tokens) and `reasoning_effort: "none"`, falling back to
  the bigger budget alone when the endpoint rejects that parameter.
- **Standup: Test Provider** probes with a realistic budget (at least 512 tokens) instead of 16,
  which could never complete a thinking pass and always reported a false failure.
- Empty-response errors now include `finish_reason` and the reasoning-token count, so truncation
  is distinguishable from a genuinely empty answer.

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
