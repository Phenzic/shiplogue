# Shiplogue

**Your daily stand-up, drafted from the work you've already done.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Shiplogue is a local-first extension for VS Code-compatible editors. It watches the
commits, saved files, GitHub activity and (in Cursor) AI prompts that make up your
day, then asks a model to write the first draft of your stand-up. You review and
edit it and copy it.

It runs with your own [Ollama](https://ollama.com), your own API key for
Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible endpoint (DeepSeek,
Kimi, OpenRouter, Groq, LM Studio…), or — planned for the paid plan — the hosted
Shiplogue provider. **No model is bundled with the extension.** Local use needs no
Shiplogue account and no telemetry.

<!-- Replace this block with docs/screenshot.png or a short GIF once captured. 
> **Screenshot/GIF placeholder** — open the Stand-up panel, generate a draft, and
> replace this block with the capture.
-->

> **Current build vs planned.** This README describes the current development
> tree. Today (0.1.7 beta): local Ollama or your own API key, manual review.
> Planned: the hosted Shiplogue provider and paid plans. Pricing below is a
> proposal — no paid tier or hosted service exists yet.

## Install and run

Install Shiplogue from your editor's Extensions view, or install the VSIX from
the latest release.

1. Open the Command Palette with `Cmd + Shift + P` (macOS) or `Ctrl + Shift + P`
   (Windows / Linux).
2. Pick a model:
   - **Ollama** — install [Ollama](https://ollama.com) and run `ollama pull llama3.2`.
   - **Your own key** — run `Shiplogue: Set API Key`.
3. Open a project with today's work.
4. Run `Shiplogue: Generate Today's Update`.
5. Review and copy the draft.

Every `Shiplogue:` command is available from the Command Palette.

## Why

Stand-up tools still ask you to type the update yourself. But the evidence of
your day already exists: commits, saved files, merged PRs, closed issues, and the
prompts you gave your AI assistant. Shiplogue reads that evidence, groups it into
themes, and writes a draft — so you start from something real instead of a blank
box.

It is local-first by design, not by accident: raw activity stays on your machine
and the default Ollama backend runs there. The hosted Shiplogue provider is an
opt-in upgrade for people who want a stronger summary, not a requirement.

## Who it's for

- Developers, docs engineers and indie hackers who write a daily update.
- VS Code, Cursor, Antigravity or another VS Code-compatible editor user who
  wants the draft to reflect real IDE activity.
- Privacy-conscious individuals and teams who want local inference by default.
- Teams that already post a stand-up and want the draft written for them.
- People who want to review and copy the draft themselves.

**Not yet for:** JetBrains, Zed, Neovim or Sublime users (separate adapters would
be needed); teams that want a hosted multi-person dashboard.

## Model options

| Backend | Status | Setup | Where activity goes |
| --- | --- | --- | --- |
| **Ollama** (bring your own) | Available now | Install Ollama and pull a model | Your local Ollama server |
| **Your own API key** (BYOK) | Available now | `Shiplogue: Set API Key` | The provider you choose (Anthropic, OpenAI, Google, or your compatible endpoint) |
| **Shiplogue hosted provider** | Planned, paid tier | Opt-in Shiplogue account | Hosted Shiplogue API; raw diffs are not retained |

The current build supports **Ollama or your own API key**. The hosted Shiplogue
provider is planned for the paid plan; this README marks it clearly so nobody is
surprised at install time. The goal is that a user with no model setup can still get a useful
local draft.

## What works today

### Activity it understands

- **IDE activity** — records every file save, plus at most one edit heartbeat per
  file every two minutes. Skips untitled/virtual documents and noise paths
  (`node_modules`, `.git`, `dist`, `out`, `build`, `.next`, `coverage`).
- **Git** — commits authored by you in the open workspace folders, including
  subject, body and changed files. Default lookback is 24 hours.
- **GitHub** — merged PRs you authored and closed issues assigned to you, via the
  editor's built-in GitHub sign-in or an optional personal access token. Repos
  are auto-detected from the git `origin` remote when none are configured.
- **Cursor prompts** — the prompts you typed into Cursor's AI assistant, read
  read-only from Cursor's local chat database and scoped to the open workspace
  (Cursor only; requires the `sqlite3` CLI).
- **Scope** — limit the draft to folders open in the current window, or combine
  every project you touched that day.

### How it writes the draft

- Runs against **Ollama (default `llama3.2`) or a bring-your-own-key provider**
  (Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible endpoint). Selection
  is explicit; `auto` prefers a configured provider and never falls back silently.
- Three **detail levels**: concise (3–4 points), standard (5–7) and elaborate
  (6–9, files enumerated). Roughly: simple, standard, complex.
- Four **tones**: neutral, junior, mid and senior.
- Fixed **Done / Next / Blockers** format, or **Yesterday / Today / Blockers** if
  you prefer.
- **Grounding** — file paths and `#issue`/`#PR` numbers that do not appear in the
  activity are removed, and the panel tells you what was removed. The next build
  extends this into a hard rule for every specific claim.
- **Deterministic formatting** — 3+ files become an indented sub-bullet list;
  GitHub links are appended from fetched data rather than generated by the model.
- **Reasoning-model support** — if a model spends its output budget on
  `thinking` and returns nothing, Shiplogue retries once with a larger budget and
  thinking disabled. This applies to Ollama (`numPredict`, `numCtx`, `think`) and
  to BYOK providers: a reasoning-only reply is retried at ≥4096 tokens with
  `reasoning_effort: "none"`, falling back to the budget alone if the endpoint
  rejects that parameter. **Shiplogue: Test Provider** uses a realistic budget so
  thinking-by-default endpoints don't report a false failure.
- **Startup health check** — when Ollama is the actual backend, warns if it is
  unreachable or the configured model isn't pulled, with actions to install, pull
  it, or pick another model. A configured provider skips this check.
- **Prompt-injection hygiene** — activity is delimited as untrusted data and
  instruction-like lines are neutralised before they reach the model.

### Review and copy

- A panel with **Markdown** and **Plain text** tabs; both are editable, and the
  plain-text view follows the Markdown until you edit it yourself.
- **Copy**, **Regenerate**, **Cancel**, and **Detail/Tone** controls. Generation
  shows live phase and elapsed time, has a configurable timeout (180s default),
  and a new run cancels the previous one.
- A **daily reminder** at your local time, with *Generate now* and *Snooze 1h*.
- **Local retention** — activity logs older than 14 days are pruned at startup
  (configurable, `0` keeps them forever). Writes use a temp file + rename so a
  crash cannot leave torn JSON.

## How it works

```text
IDE save/edit events ──▶ Tracker ──▶ local activity log (one JSON file/day)
                                            │
git log (your commits, window) ─────────────┤
GitHub search (merged PRs, closed issues) ──┼──▶ gatherContext ──▶ prompt ──▶ model backend ──▶ draft
Cursor chat DB (read-only, Cursor only) ────┘                                      │
                                                     grounding + formatting        │
                                                          panel: edit/copy ◀──┘

Model backend today: Ollama or your own API key. Planned: the hosted Shiplogue provider (paid).
```

1. **Track** — save/edit events are debounced and written to a local per-day log.
2. **Gather** — commits, GitHub items, tracked files and optional Cursor prompts
   are collected for the lookback window, capped and labelled if anything is
   omitted.
3. **Draft** — the activity is rendered as untrusted text and sent to the selected
   model backend with a fixed template, detail/tone rules and grounding
   requirements.
4. **Verify** — unverifiable file/issue mentions are removed, sub-bullets and
   references are formatted deterministically, and warnings are shown in the
   panel.
5. **Review** — you edit and copy. Nothing is posted anywhere.

## Plans

Free covers local drafting with Ollama or your own API key. Pro adds weekly
recap, cloud history, project destinations, and automatic posting.

| Tier | Features | Price |
| --- | --- | --- |
| **Free** | Local drafting, review/copy, one cloud project, local history | $0 |
| **Pro** | Unlimited projects, weekly recap, cloud history, sending, automatic posting | See [shiplogue.dev/pricing](https://shiplogue.dev/pricing) |

## Key settings

| Setting | Default | What it does |
| --- | --- | --- |
| `shiplogue.lookbackHours` | `24` | How far back to gather activity |
| `shiplogue.model.backend` | `auto` | `auto` / `provider` / `ollama` / `local` |
| `shiplogue.provider.type` | `none` | `anthropic` / `openai` / `google` / `openai-compatible` |
| `shiplogue.provider.model` | `""` | Model id, normally set by **Shiplogue: Set API Key** |
| `shiplogue.provider.baseUrl` | `""` | Endpoint URL, mainly for `openai-compatible` |
| `shiplogue.provider.maxOutputTokens` | `1200` | Provider output cap; `0` uses the detail budget |
| `shiplogue.ollama.model` | `llama3.2` | Local model used to summarise |
| `shiplogue.detail` | `concise` | `concise` / `standard` / `elaborate` |
| `shiplogue.tone` | `neutral` | `neutral` / `junior` / `mid` / `senior` |
| `shiplogue.scope` | `workspace` | Current window's folders, or all projects that day |
| `shiplogue.format` | `done-next-blockers` | Or `yesterday-today-blockers` |
| `shiplogue.reminder.time` | `16:00` | Local daily reminder time |
| `shiplogue.store.retentionDays` | `14` | Local activity retention; `0` = forever |

## Privacy

Today:

- Raw activity is written only to the extension's local global storage.
- Cursor's chat database is opened read-only and never modified.
- With Ollama on `localhost`, activity text never leaves the machine for
  summarisation. Pointing `shiplogue.ollama.url` at a remote server sends it there
  — that is your choice.
- **With a BYOK provider, the assembled activity context and prompt are sent to
  that provider** (Anthropic, OpenAI, Google, or the OpenAI-compatible endpoint
  you configured) so it can write the draft. That is inherent to using a cloud
  model; pick Ollama if activity must stay on-device.
- Provider API keys are stored with VS Code SecretStorage (OS keychain), never in
  `settings.json`, logs or error messages. Use **Shiplogue: Clear API Key** to
  remove one.
- GitHub API calls happen only when GitHub context is enabled and credentials
  exist. They include the repo names and your token, like any GitHub client.
- No telemetry, analytics or Shiplogue account for the local build.
- Only the draft you explicitly copy leaves the extension.

See [`extension/PRIVACY.md`](extension/PRIVACY.md) for the full current policy.

Planned hosted model (opt-in, paid):

- Only the assembled activity context needed for the summary is sent to the
  hosted API — not raw repository contents or full diffs.
- The planned design does not store raw diffs; it retains a short request/response
  pair with an opaque `request_id`, under a documented retention period.
- A privacy mode will disable cloud usage entirely; local and Ollama backends
  remain available.
- No training on your code or activity without explicit consent.
- The privacy policy and terms will be published before the hosted service opens;
  enterprise/on-prem options will be available for teams that cannot use a hosted
  API.

## Status and limitations

I believe an honest list matters more than a polished one. This README describes
the current development tree. The package version is `0.1.7`; there is no
Marketplace/Open VSX listing yet, and the manual launch QA/publishing step is
still outstanding. See [`extension/CHANGELOG.md`](extension/CHANGELOG.md) for
what changed in 0.1.7 and [`extension/PRIVACY.md`](extension/PRIVACY.md) for the
current local-data policy.

- **A model backend is required: Ollama, your own API key, or the planned hosted
  provider.** No model is bundled; the hosted plan is planned, not available.
- **VS Code-compatible editors only.** Built for VS Code, Cursor, Antigravity,
  VSCodium, Windsurf and similar forks. JetBrains, Zed, Neovim and Sublime need
  separate adapters.
- **AI prompt capture is Cursor-only.** VS Code/Copilot chat history is not read.
  Everything else works without it.
- **Grounding covers file and issue/PR references today.** The next build makes
  every specific claim a hard, verifiable rule and warns instead of silently
  accepting an unverified detail. Until then, the panel reports removed
  path/number mentions.
- **Context is capped and labelled.** The current build includes up to 25 commits,
  20 Cursor prompts and 30 GitHub items, and shows "showing N of M" notes. A
  preflight budget check that estimates tokens, trims by priority and warns before
  an over-budget call is the next build's P0.
- **The reminder only fires while the editor is open** (in-process timer), not
  from the OS scheduler.
- **Real-host UI verification is still pending.** The core is covered by
  automated tests; a manual F5 pass on macOS and Windows is part of the launch
  checklist. Antigravity accepts the VSIX; runtime QA there is pending. Windows
  paths are unit-tested, not yet verified on a real Windows machine.
- **Large Cursor databases can be slow to read.** Generation is cancellable and
  has a timeout, but the first gather may take seconds.
- **Cursor prompt capture requires `sqlite3`** on `PATH`; without it that source
  quietly returns nothing.
- **Built-in GitHub sign-in depends on the host** exposing a `github` auth
  provider. The personal-access-token path always works.

## Roadmap

**0.1.7 — beta (current)**

- Removed the cancelled bundled-model plan and the reserved `local` backend.

**0.1.6 — beta (2026-11-03)**

- `Cmd+Shift+'` / `Ctrl+Shift+'` keyboard shortcut for generation.

**0.1.5 — beta (2026-11-02)**

- Workflow-validation release (OIDC trusted publishing). No functional changes.

**0.1.4 — beta (2026-11-02)**

- Marketplace-safe build: copy-only, with Cursor capture.
- Everything from 0.1.3.

**0.1.3 — beta (2026-11-01)**

- Packaging cleanup for the first Marketplace publish: removed a stray runtime
  dependency, trimmed tags, stopped shipping internal QA notes, and fixed
  README links for the listing.

**0.1.2 — beta (2026-10-31)**

- Renamed from Standup to **Shiplogue**: extension id `phenzic.shiplogue`,
  commands and settings under `shiplogue.*`, and a new local storage path.
  Reinstall the VSIX and re-enter your provider key (the old id's secret is not
  readable by the renamed extension).
- Everything from 0.1.1: Ollama, plus bring-your-own-key Anthropic / OpenAI /
  Google / OpenAI-compatible providers with keys in the OS keychain.

**0.1.1 — beta (2026-10-29)**

- Ollama, plus bring-your-own-key Anthropic / OpenAI / Google /
  OpenAI-compatible providers with keys in the OS keychain.
- Reasoning-only replies from BYOK endpoints recover automatically (larger
  budget, thinking off); **Shiplogue: Test Provider** uses a realistic budget
  instead of a 16-token probe.
- CI, Marketplace metadata, changelog, privacy statement, icon and version bump
  are in place.
- Remaining: manual QA on macOS (and Windows where available) across the real
  extension host, real GitHub sign-in and a thinking-by-default
  provider, then publish.

**Next build — hardening and productization (working title 0.2.0)**

- **Hard grounding:** every specific claim must be backed by activity; no silent
  fixes. This is a release gate.
- **Context preflight:** estimate the prompt budget, trim by priority and show
  exactly what was omitted before calling the model.
- **Hosted Shiplogue provider:** a paid, opt-in backend with no local model setup.
- **Hosted provider and plans:** free Ollama/BYOK; Pro hosted/automation; Enterprise
  on-prem/SLA.
- **Editor support:** Antigravity and VS Code-compatible forks in the test matrix.
- **Self-hosted backend (Docker) evaluation** for Enterprise/on-prem — the
  extension still runs inside the editor; Docker is not a replacement UI.

**Later**

- JetBrains/Zed/Neovim adapters and browser activity.
- Team/hosted dashboard features.

These are directions, not commitments. Pricing and packaging remain proposals.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the repository layout, development
setup, test commands, coding conventions and pull-request checklist.

## License

MIT — see [LICENSE](LICENSE). The extension is free and open source; planned
paid plans cover hosted inference, scheduled automation and enterprise
deployment, not the local core.
