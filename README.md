# Standup

**Your daily stand-up, drafted from the work you actually did.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Standup is a local-first extension for VS Code-compatible editors. It watches the
commits, saved files, GitHub activity and (in Cursor) AI prompts that make up your
day, then asks a model to write the first draft of your stand-up. You review and
edit it, copy it, or send it to Slack/Discord.

It runs on-device by default. Today that means bring-your-own
[Ollama](https://ollama.com); the next build adds a small bundled quantized model
so you won't need to set one up. An optional higher-capacity hosted model is
planned for users who want it. Local use needs no Standup account and no telemetry.

<!-- Replace this block with docs/screenshot.png or a short GIF once captured. -->
> **Screenshot/GIF placeholder** — open the Stand-up panel, generate a draft, and
> replace this block with the capture.

> **Current build vs planned.** This README describes the current development
> tree. Today: local Ollama, manual review and manual posting. Planned for the
> next build: bundled local model (no Ollama setup), optional hosted model, paid
> plans and automatic posting. Pricing and plans below are proposals — no paid
> tier or hosted service exists yet.

## Why

Stand-up tools still ask you to type the update yourself. But the evidence of
your day already exists: commits, saved files, merged PRs, closed issues and the
prompts you gave your AI assistant. Standup reads that evidence, groups it into
themes, and writes a draft — so you start from something real instead of a blank
box.

It is local-first by design, not by accident: raw activity stays on your machine
and the default model runs there. A hosted model is an opt-in upgrade for people
who want a stronger summary, not a requirement.

## Who it's for

- Developers, docs engineers and indie hackers who write a daily update.
- VS Code, Cursor, Antigravity or another VS Code-compatible editor user who
  wants the draft to reflect real IDE activity.
- Privacy-conscious individuals and teams who want local inference by default.
- Teams that already use a Slack/Discord webhook but don't want another bot with
  repository access.
- People who want to review before posting — and, on planned paid plans, people
  who want an optional scheduled post.

**Not yet for:** JetBrains, Zed, Neovim or Sublime users (separate adapters would
be needed); teams that want a hosted multi-person dashboard; anyone who wants
fully automatic posting today (it is planned for paid plans).

## Model options

| Backend | Status | Setup | Where activity goes |
| --- | --- | --- | --- |
| **Ollama** (bring your own) | Available now | Install Ollama and pull a model | Your local Ollama server |
| **Bundled quantized model** | Planned, free tier | None — ships/downloads with the extension | On-device |
| **Hosted higher-capacity model** | Planned, paid tier | Opt-in account | Hosted API; raw diffs are not retained |

The current build supports **Ollama only**. The bundled and hosted backends are
planned; this README marks them clearly so nobody is surprised at install time.
The goal is that a user with no model setup can still get a useful local draft.

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

- Runs against **Ollama today** (default `llama3.2`); backend selection arrives
  with the planned bundled and hosted backends.
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
- **Reasoning-model support** — models such as `gpt-oss` or `deepseek-r1` get an
  automatic retry with a larger output budget if they spend everything on
  reasoning. `numPredict`, `numCtx` and `think` are configurable.
- **Startup health check** — warns if Ollama is unreachable or the configured
  model isn't pulled, with actions to install, pull it, or pick another model.
- **Prompt-injection hygiene** — activity is delimited as untrusted data and
  instruction-like lines are neutralised before they reach the model.

### Review and send

- A panel with **Markdown** and **Plain text** tabs; both are editable, and the
  plain-text view follows the Markdown until you edit it yourself.
- **Copy**, **Regenerate**, **Cancel**, and **Detail/Tone** controls. Generation
  shows live phase and elapsed time, has a configurable timeout (180s default),
  and a new run cancels the previous one.
- **Manual posting** to one configured Discord or Slack webhook. Discord posts
  are split into up to three messages; Slack receives converted mrkdwn. If a
  Discord draft needs more than three messages, the full text is copied to the
  clipboard. Automatic posting is planned for paid plans.
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
                                                          panel: edit/copy/send ◀──┘

Model backend today: Ollama. Planned: bundled on-device model, optional hosted API.
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
5. **Review** — you edit, copy or send. Nothing is posted automatically today.

## Plans and pricing (planned — not live)

The intended model is freemium: free local summaries, paid hosted quality and
automation, and an enterprise/on-prem option. **No billing exists yet; all
current features are free and MIT-licensed.**

| Tier | Planned features | Planned price |
| --- | --- | --- |
| **Free** | Bundled local model (or your own Ollama), review/copy, manual webhook, custom prompt templates | $0 |
| **Pro** | Hosted higher-capacity model, scheduled automatic posting, advanced analytics, API access | $5–$10/month (indicative) |
| **Enterprise** | Unlimited users, dedicated instance, SLA, on-prem/Docker option | Custom quote |

- Prices and packaging are **proposals** and may change before launch.
- Automatic posting is a paid-plan feature in this plan; manual posting stays
  available on the free tier.
- Any Pro analytics will be opt-in, aggregate and free of repository contents or
  PII; the local build has no analytics.
- The extension is open source; the hosted service is a separate product. A
  hosted plan is not required to use the local model.
- Marketplace installs cannot process payment; entitlements will be enforced by
  the hosted service, not by client-side checks.

## Quick start

Requirements for the **current build**:

- VS Code **1.85+**, Cursor, Antigravity or another VS Code-compatible editor.
- [Ollama](https://ollama.com) running locally with a model pulled:
  `ollama pull llama3.2`.
- Node/npm for the development install.
- Optional: `sqlite3` on `PATH` for Cursor prompt context.
- Optional: GitHub sign-in or a personal access token for PR/issue context.

Standup is not published on a marketplace yet. Run it from source:

```bash
git clone https://github.com/Phenzic/standup.git
cd standup/extension
npm install
npm run compile
```

Open the `extension/` folder in VS Code or Cursor and press **F5** to launch the
Extension Development Host. In that window, run **Standup: Generate Today's
Update** from the Command Palette.

Full settings, troubleshooting and development notes live in
[`extension/README.md`](extension/README.md). For project layout and contribution
guidance, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Key settings

| Setting | Default | What it does |
| --- | --- | --- |
| `standup.lookbackHours` | `24` | How far back to gather activity |
| `standup.ollama.model` | `llama3.2` | Local model used to summarise (current backend) |
| `standup.detail` | `concise` | `concise` / `standard` / `elaborate` |
| `standup.tone` | `neutral` | `neutral` / `junior` / `mid` / `senior` |
| `standup.scope` | `workspace` | Current window's folders, or all projects that day |
| `standup.format` | `done-next-blockers` | Or `yesterday-today-blockers` |
| `standup.webhook.type` / `standup.webhook.url` | `none` / `""` | Discord or Slack incoming webhook |
| `standup.reminder.time` | `16:00` | Local daily reminder time |
| `standup.store.retentionDays` | `14` | Local activity retention; `0` = forever |

## Privacy

Today:

- Raw activity is written only to the extension's local global storage.
- Cursor's chat database is opened read-only and never modified.
- With Ollama on `localhost`, activity text never leaves the machine for
  summarisation. Pointing `standup.ollama.url` at a remote server sends it there
  — that is your choice.
- GitHub API calls happen only when GitHub context is enabled and credentials
  exist. They include the repo names and your token, like any GitHub client.
- No telemetry, analytics or Standup account for the local build.
- Only the draft you explicitly copy or send is posted to your webhook.

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
the current development tree. The package version is `0.1.0`; there is no
Marketplace/Open VSX listing yet, and the manual launch QA/publishing step is
still outstanding. See [`extension/CHANGELOG.md`](extension/CHANGELOG.md) for
what changed in 0.1.0 and [`extension/PRIVACY.md`](extension/PRIVACY.md) for the
current local-data policy.

- **The current build requires Ollama.** The bundled local model, hosted model,
  paid plans and automatic posting are planned, not available.
- **VS Code-compatible editors only.** Built for VS Code, Cursor, Antigravity,
  VSCodium, Windsurf and similar forks. JetBrains, Zed, Neovim and Sublime need
  separate adapters.
- **AI prompt capture is Cursor-only.** VS Code/Copilot chat history is not read.
  Everything else works without it.
- **Posting is manual today.** Optional scheduled auto-posting is planned for paid
  plans. The current build supports one webhook target (Discord or Slack).
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

**0.1.0 — current development build**

- CI, Marketplace metadata, changelog, privacy statement, icon and version bump
  are in place.
- Remaining: manual QA on macOS (and Windows where available) across the real
  extension host, real GitHub sign-in and real webhooks, then publish.

**Next build — hardening and productization (working title 0.2.0)**

- **Hard grounding:** every specific claim must be backed by activity; no silent
  fixes. This is a release gate.
- **Context preflight:** estimate the prompt budget, trim by priority and show
  exactly what was omitted before calling the model.
- **Bundled quantized local model:** no Ollama setup for a useful free draft.
- **Optional hosted model and plans:** Free local; Pro hosted/automation; Enterprise
  on-prem/SLA.
- **Automatic posting:** optional scheduled Discord/Slack posts on paid plans.
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
