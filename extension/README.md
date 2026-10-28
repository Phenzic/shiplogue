# Standup — VS Code-compatible extension

**Local-first daily stand-ups, drafted from your actual IDE activity.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)

Standup watches the work you already did — git commits, saved files, GitHub PRs
and issues, and (in Cursor) the prompts you gave your AI assistant — then asks a
model to write your stand-up. You review and edit the draft, then copy it or send
it to Slack/Discord.

It is local-first by default. Today that means a local Ollama server; the next
build adds a small bundled quantized model so Ollama is optional. A higher-capacity
hosted model is planned as an opt-in paid option.

> **Status:** **0.1.1** beta. No Marketplace/Open VSX listing yet — install from the
> release VSIX (or run from source). This build still needs Ollama.
>
> **Current vs planned:** today: Ollama, manual review, manual posting. Next: bring
> your own API key (Anthropic / OpenAI / Google / OpenAI-compatible) so testers can
> skip the Ollama install. Later: bundled local model, hosted model, paid plans,
> automatic posting. Nothing paid or hosted exists yet.
>
> **Screenshot/GIF placeholder** — capture the Stand-up panel with a generated
> draft and replace this block before publishing.

## Requirements

- **A VS Code-compatible editor:** VS Code 1.85+, Cursor, Antigravity, VSCodium,
  Windsurf or a similar fork. VS Code, Cursor and Antigravity are the supported
  targets; runtime QA on some forks is still pending.
- **A model backend.** The current build uses **Ollama**:
  ```bash
  ollama pull llama3.2
  ```
  A bundled quantized model (no Ollama) and an optional hosted model are planned,
  not available yet.
- **Node/npm** for the development install.
- Optional: **GitHub** sign-in or a personal access token for merged-PR and
  closed-issue context.
- Optional: **`sqlite3`** on `PATH` for Cursor prompt context.

## Model backends

| Backend | Status | Setup | Where activity goes |
| --- | --- | --- | --- |
| Ollama | **Available now** | Install Ollama, pull a model | Your local Ollama server |
| Bundled quantized model | Planned (free) | None | On-device |
| Hosted higher-capacity model | Planned (paid) | Opt-in account | Hosted API; raw diffs not retained |

Today only the Ollama backend exists. The rest of this README describes current
behaviour and marks planned features explicitly.

## Install and run (development)

Standup is not published to a marketplace yet.

```bash
cd extension
npm install
npm run compile      # or: npm run watch
```

Open the `extension/` folder in VS Code, Cursor or Antigravity and press **F5** to
launch the Extension Development Host. In that window:

- **Standup: Generate Today's Update** — gather activity, generate a draft, open
  the review panel.
- **Standup: Show Tracked Activity (debug)** — dump the raw gathered context so
  you can see exactly what the model sees.
- **Standup: Set Reminder Time** — choose the local time for the daily nudge.
- **Standup: Connect GitHub** — start the editor's GitHub sign-in for PR/issue
  context.

If you prefer a VSIX, package one locally with `npx @vscode/vsce package` and
install it with `code --install-extension <file>.vsix` (or the Cursor CLI).

## Features

### Activity capture

- Records every **file save** and at most one **edit heartbeat per file every two
  minutes**, in a per-day JSON log inside the editor's global storage.
- Skips untitled/virtual documents and `node_modules`, `.git`, `dist`, `out`,
  `build`, `.next` and `coverage`.
- Collects **commits authored by you** in open workspace folders for the lookback
  window, including commit body and changed files.
- Collects **merged PRs you authored** and **closed issues assigned to you** via
  the GitHub search API, using the editor's GitHub session or a PAT.
- In **Cursor only**, reads the prompts you typed into Cursor's AI assistant from
  its local `state.vscdb`, read-only, scoped to open workspaces.
- With no folder open, falls back to all projects and says so in the panel.

### Drafting

- **Ollama today** (default `llama3.2` at `http://localhost:11434`); backend
  selection arrives with the planned bundled and hosted backends.
- **Three detail levels:** concise (3–4 points), standard (5–7), elaborate (6–9,
  files enumerated).
- **Four tones:** neutral, junior, mid, senior.
- **Two formats:** Done / Next / Blockers (default) or Yesterday / Today /
  Blockers.
- **Reasoning-model support:** if a model spends its output budget on
  `thinking` and returns nothing, Standup retries once with a larger budget and
  thinking disabled (configurable via `numPredict`, `numCtx`, `think`).
- **Automatic repair pass** if the model under-splits and the activity supports
  the requested minimum. It splits real work; it does not pad with invented
  items.
- **Grounding check:** file paths and `#issue`/`#PR` numbers that do not appear
  in the activity are removed, and the panel reports what was removed. The next
  build makes every specific claim a hard, verifiable rule.
- **Deterministic formatting:** 3+ files become indented sub-bullets; references
  are built from fetched GitHub data, so links cannot be hallucinated.
- **Prompt-injection hygiene:** activity is wrapped as untrusted data, and
  instruction-looking lines are neutralised before reaching the model.
- **Startup health check:** warns if Ollama is unreachable or the configured
  model is not pulled, with actions to install, pull it, or pick another model.
- **Input caps:** 25 commits, 20 Cursor prompts and 30 GitHub items, with
  “showing N of M” notes so omitted activity stays visible. A preflight
  token-budget check and priority trimming are planned.

### Review and posting

- Markdown and Plain text tabs; both editable and independently copyable.
- **Copy**, **Regenerate**, **Cancel**, and Detail/Tone controls.
- Live progress with phase and elapsed seconds; a new run supersedes and cancels
  the previous one; a configurable timeout prevents a stuck request.
- **Manual posting** to one Discord or Slack incoming webhook. Discord drafts are
  split into up to three messages; Slack gets Markdown converted to mrkdwn.
  Beyond three Discord messages, the full text is copied to the clipboard.
  Optional scheduled auto-posting is planned for paid plans.
- **Daily reminder** at your local time, with *Generate now* and *Snooze 1h*.
- **Local retention:** activity logs older than 14 days are pruned on startup
  (configurable; `0` keeps them forever).

## Settings

All settings are current; future model-backend options will be added when those
backends ship.

| Setting | Default | What it does |
| --- | --- | --- |
| `standup.lookbackHours` | `24` | How far back to gather activity |
| `standup.ollama.url` | `http://localhost:11434` | Ollama base URL |
| `standup.ollama.model` | `llama3.2` | Model used to summarize |
| `standup.ollama.numPredict` | `0` | Output token budget; `0` uses the per-detail default (400/900/1600) |
| `standup.ollama.numCtx` | `8192` | Context window passed to Ollama; raise for very busy days |
| `standup.ollama.think` | `auto` | Reasoning control: `auto` (retry with thinking off if empty), `on`, `off` |
| `standup.github.useBuiltInAuth` | `true` | Use the editor's GitHub sign-in instead of a PAT |
| `standup.github.token` | `""` | Optional PAT; overrides built-in auth |
| `standup.github.repos` | `[]` | `owner/name` list; auto-detected from git `origin` when empty |
| `standup.format` | `done-next-blockers` | Or `yesterday-today-blockers` |
| `standup.scope` | `workspace` | `workspace` = folders open in this window; `all` = every project that day |
| `standup.detail` | `concise` | `concise` / `standard` / `elaborate` |
| `standup.tone` | `neutral` | `neutral` / `junior` / `mid` / `senior` |
| `standup.webhook.type` | `none` | `discord` / `slack` / `none` |
| `standup.webhook.url` | `""` | Incoming webhook URL (no bot/OAuth needed) |
| `standup.track.enabled` | `true` | Track file saves/edits locally |
| `standup.generate.timeoutSeconds` | `180` | Abort generation after N seconds; `0` disables |
| `standup.store.retentionDays` | `14` | Delete activity logs older than N days; `0` = keep forever |
| `standup.reminder.enabled` | `true` | Daily local-time nudge |
| `standup.reminder.time` | `16:00` | Reminder time in 24h `HH:MM`, local time |
| `standup.cursor.enabled` | `true` | Include Cursor AI prompts as context (Cursor only) |

Settings can be changed in the editor UI or `settings.json`. Detail and tone are
also switchable from the panel; the panel's last choice is stored globally.

## Output format

The format is fixed and opinionated, like an editor's base prompt:

```markdown
Hey team, here's what I worked on today:

**Done**
- One accomplishment per bullet: what changed and why, in plain English.

**Next**
- What's next; inferred items are marked (inferred).

**Blockers**
- Blockers, or exactly: None
```

- Conventional-commit prefixes (`feat:`, `fix:`) are rewritten into normal
  sentences.
- When a point covers 3+ files, the files become indented sub-bullets, enforced
  in code.
- GitHub PRs/issues are appended as a **References** block with real links.
- Elaborate mode enumerates files and commit-body specifics; concise stays
  outcome-only.
- If the model under-splits and there is enough distinct activity, one repair
  pass asks it to split real themes rather than pad.

The three detail levels map roughly to **simple / standard / complex** in the
original pitch.

## Review panel

| Control | What it does |
| --- | --- |
| Markdown / Plain text tabs | Edit and copy either version; plain text follows Markdown until edited |
| Copy | Copies the active tab |
| Regenerate | Starts a fresh generation; any in-flight run is cancelled |
| Cancel | Aborts the current generation (child processes and fetch included) |
| Detail | Concise / Standard / Elaborate; changing it regenerates |
| Tone | Neutral / Junior / Mid / Senior; changing it regenerates |
| Send | Posts to the configured Discord/Slack webhook (hidden when none) |

The status line shows progress, cancellation, timeout, grounding removals and
input-cap notes.

## Plans (planned — not live)

The intended model is freemium: **Free** local summaries (bundled model or your
own Ollama), **Pro** with a hosted model and scheduled auto-posting, and
**Enterprise** with on-prem/dedicated deployment. Prices are indicative and no
billing exists yet. See the [project README](../README.md#plans-and-pricing-planned--not-live)
for the proposed tiers.

## Posting

Posting is **manual** in the current build: review the draft, then press **Send**.
Set `standup.webhook.type` to `discord` or `slack` and paste an incoming webhook
URL into `standup.webhook.url`. No bot or OAuth app is required.

- **Discord:** content is split at line/word boundaries into up to three messages
  of ≤1,990 characters. If more would be needed, the first three are posted, the
  remainder is skipped, and the full text is copied to the clipboard.
- **Slack:** the Markdown draft is converted to Slack mrkdwn (`**bold**` →
  `*bold*`, links → `<url|text>`), regardless of which tab is active. Because
  Slack needs Markdown, edits made only in the Plain text tab are not sent to
  Slack.
- Only one webhook target is configured at a time.

**Automatic daily posting is planned for paid plans, not implemented.** It is not
available in this build; today every post is a reviewed manual action. When it
lands, it will be an optional scheduled post to the configured Discord and/or
Slack webhook, with an option to review before posting.

## Privacy and local data

The full current policy is in [`PRIVACY.md`](PRIVACY.md).

Today:

- Activity logs live under the editor's global storage:
  `.../User/globalStorage/phenzic.standup/activity/` (one JSON file per local
  day). If you installed an earlier `standup-dev` dev build, its logs live under
  `standup-dev.standup/` and are not migrated automatically.
- Cursor's chat database is opened read-only with `immutable=1`; it is never
  modified.
- With Ollama on `localhost`, no activity text leaves the machine for
  summarisation. A remote `standup.ollama.url` sends it there by your choice.
- GitHub API calls happen only when GitHub context is enabled and credentials
  exist.
- Only the draft you explicitly post is sent to your webhook. There is no
  telemetry and no Standup account.

Planned hosted model (opt-in, paid):

- Only the assembled activity context for the summary is sent — not raw
  repository contents or full diffs.
- Planned design: no raw-diff storage; a short request/response pair with an
  opaque `request_id` is retained for a documented period.
- A privacy mode will disable cloud usage entirely; local/Ollama remain available.
- No training on your code or activity without explicit consent.
- A privacy policy and terms will be published before the hosted service opens;
  enterprise/on-prem deployment is planned for teams that cannot use a hosted API.

## Troubleshooting

**“Ollama isn't running” warning at startup**
Start Ollama (`ollama serve`, or `brew services start ollama` on macOS), then
check `standup.ollama.url`. The warning offers an install link; it never blocks
activation. The current build needs Ollama; the bundled model is planned.

**“Model 'X' isn't pulled” warning**
Use **Pull now** to run `ollama pull X`, or **Pick another model** to choose an
installed one. The check matches `model` with or without `:latest`.

**I don't want to install Ollama**
You currently need a model backend. The planned free build will include a small
quantized local model; the planned paid build adds an optional hosted model. Until
then, Ollama is the supported backend.

**The draft is empty or cut off**
Reasoning models can spend the whole output budget on `thinking`. Standup
retries once with a larger budget and thinking disabled. If it still happens,
raise `standup.ollama.numPredict` (e.g. 4096–8192), raise
`standup.ollama.numCtx`, or use a non-reasoning model such as `llama3.2`.

**Cursor prompts never appear**
Confirm you are running Cursor (not VS Code), `sqlite3` is on `PATH`, and
`standup.cursor.enabled` is true. With `standup.scope: workspace`, prompts are
scoped to the open workspace's chats.

**GitHub items are missing**
Run **Standup: Connect GitHub**, or set a PAT in `standup.github.token`. Only
merged PRs you authored and closed issues assigned to you are included. If
`standup.github.repos` is empty, the repo is read from the git `origin` remote.

**Generation timed out**
Increase `standup.generate.timeoutSeconds`, reduce `standup.lookbackHours`, use a
smaller model, or check the Cursor database size. The Cancel button aborts
immediately.

**“Removed N unverifiable mention(s)”**
The grounding check removed a file path or `#number` that was not in the activity.
This is intentional; review the draft. The next build extends grounding to every
specific claim and makes it a release gate.

**Posting failed**
Check `standup.webhook.type`/`url` and that the webhook still exists. Webhooks
must return 2xx.

**No activity found**
Commit or save some work, or increase `standup.lookbackHours`. In a window with
no folder open, Standup falls back to all projects.

**Context or token limits**
The current build caps input at 25 commits, 20 Cursor prompts and 30 GitHub
items and shows “showing N of M”. If your model still reports a context problem,
raise `standup.ollama.numCtx` or reduce `standup.lookbackHours`. A preflight
budget check with a clear warning is planned.

## Known limitations

- **Current build needs Ollama.** Bundled local and hosted models are planned, not
  available.
- **VS Code-compatible editors only.** Supported targets include VS Code, Cursor,
  Antigravity, VSCodium and Windsurf; JetBrains, Zed, Neovim and Sublime need
  separate adapters.
- **AI prompt capture is Cursor-only.** VS Code/Copilot chat history is not read.
- **Manual posting only.** Automatic daily posting is planned for paid plans.
- **One webhook target.** Discord or Slack, not both simultaneously.
- **Grounding covers file/#number references today.** The next build makes every
  specific claim a hard, verifiable rule and warns rather than silently accepting
  an unverified detail.
- **Context caps are in place, but the preflight budget check is planned.** The
  panel reports “showing N of M”, and `numCtx` is configurable.
- **Reminder timing requires the editor to be open.** There is no OS scheduler.
- **Real-host QA is pending.** Automated tests cover the core; a manual F5 pass
  on macOS (and Windows where available) is still part of the launch checklist.
  Antigravity installs the VSIX; runtime QA there is pending. Windows paths are
  unit-tested, not verified on a real Windows machine.
- **Cursor reads can be slow on very large databases.** This is why generation is
  cancellable and has a timeout.
- **`sqlite3` is required for Cursor prompts.** Without it, that source returns
  nothing.
- **Built-in GitHub auth depends on the host.** A PAT always works.
- **Not published.** No Marketplace/Open VSX listing or public release yet.
- **Paid plans and the hosted service are proposals.** No billing exists yet;
  prices are indicative.

## Roadmap

**0.1.0 — current development build**

- CI across operating systems, Marketplace metadata, changelog, privacy
  statement, icon and version bump are in place.
- Remaining: manual QA in a real extension host (health check, real GitHub
  sign-in, real Discord/Slack webhooks, multi-root and no-folder windows, cancel
  and soak tests), then publish.

**Next build — hardening and productization (working title 0.2.0)**

- **Hard grounding:** every specific claim must be backed by activity; no silent
  fixes; release gate.
- **Context preflight:** estimate the prompt budget, trim by priority and show
  what was omitted before calling the model.
- **Bundled quantized local model:** no Ollama setup for a useful free draft.
- **Optional hosted model and plans:** Free local; Pro hosted/automation;
  Enterprise on-prem/SLA.
- **Automatic posting:** optional scheduled Discord/Slack posts on paid plans.
- **Editor support:** Antigravity and other VS Code-compatible forks in the test
  matrix.
- **Self-hosted backend (Docker) evaluation** for Enterprise/on-prem — the
  extension still runs inside the editor.

**Later**

- More editor adapters (JetBrains/Zed/Neovim) and browser activity.
- Team/hosted features.

## Development

```bash
npm install
npm run compile      # tsc -p ./
npm run watch        # incremental compile
npm test             # compile + default test suite
npm run test:e2e     # gated real-Ollama suite (sequential; STANDUP_OLLAMA_MODEL=...)
npm run test:cursor  # gated read-only Cursor DB suite
```

The test suite uses Node's built-in runner (no extra dependencies). It stubs the
`vscode` API, starts local mock Ollama/webhook servers, creates temporary git
repos and synthetic SQLite databases. Real-model and real-Cursor-DB tests skip
without their environment variables.

For repository layout, coding conventions and the pull-request checklist, see
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

## License

MIT — see [LICENSE](../LICENSE). The extension is free and open source; planned
paid plans cover hosted inference, scheduled automation and enterprise
deployment, not the local core.

The project overview is in [`../README.md`](../README.md); the repository is
[Phenzic/standup](https://github.com/Phenzic/standup).
