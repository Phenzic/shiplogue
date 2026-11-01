# Shiplogue — VS Code-compatible extension

**Local-first daily stand-ups, drafted from your actual IDE activity.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Phenzic/shiplogue/blob/main/LICENSE)

Shiplogue watches the work you already did — git commits, saved files, GitHub PRs
and issues, and (in Cursor) the prompts you gave your AI assistant — then asks a
model to write your stand-up. You review and edit the draft, then copy it or send
it to Slack/Discord.

It is local-first by default: a local Ollama server, or a bundled quantized model
in a later build. Bring-your-own-key providers (Anthropic, OpenAI, Google, or an
OpenAI-compatible endpoint) are available now if you would rather not run a local
model. A higher-capacity hosted model is planned as an opt-in paid option.

> **Status:** **0.1.3** beta. No Marketplace/Open VSX listing yet — install from the
> release VSIX (or run from source). This build uses Ollama or your own API key.
>
> **Current vs planned:** today: Ollama, bring-your-own-key providers (Anthropic /
> OpenAI / Google / OpenAI-compatible), manual review, manual posting. Later:
> bundled local model, hosted model, paid plans, automatic posting. Nothing paid
> or hosted by us exists yet.
>
> **Screenshot/GIF placeholder** — capture the Stand-up panel with a generated
> draft and replace this block before publishing.

## Requirements

- **A VS Code-compatible editor:** VS Code 1.85+, Cursor, Antigravity, VSCodium,
  Windsurf or a similar fork. VS Code, Cursor and Antigravity are the supported
  targets; runtime QA on some forks is still pending.
- **A model backend** — either:
  - **Ollama** (local, free):
    ```bash
    ollama pull llama3.2
    ```
  - or **your own API key** for Anthropic, OpenAI, Google Gemini, or any
    OpenAI-compatible endpoint. Run **Shiplogue: Set API Key** and pick a model.
    The key is stored in the OS keychain, not in settings.
  A bundled quantized model (no Ollama, no key) is planned, not available yet.
- **Node/npm** for the development install.
- Optional: **GitHub** sign-in or a personal access token for merged-PR and
  closed-issue context.
- Optional: **`sqlite3`** on `PATH` for Cursor prompt context.

## Model backends

| Backend | Status | Setup | Where activity goes |
| --- | --- | --- | --- |
| Ollama | **Available now** | Install Ollama, pull a model | Your local Ollama server |
| Your own API key (BYOK) | **Available now** | `Shiplogue: Set API Key` | The provider you choose (Anthropic, OpenAI, Google, or your compatible endpoint) |
| Bundled quantized model | Planned (free) | None | On-device |
| Hosted higher-capacity model | Planned (paid) | Opt-in account | Hosted API; raw diffs not retained |

`shiplogue.model.backend` controls selection:

- `auto` (default) — a fully configured provider wins; otherwise Ollama.
- `provider` — only the configured provider; fails loudly if it isn't set up.
- `ollama` — only Ollama.
- `local` — reserved for the bundled model; in 0.1.x it explains that the model
  isn't included.

There is **no silent fallback** between a cloud provider and Ollama: if you chose
a provider, a failure is reported instead of sending your activity somewhere else.
The panel shows which engine wrote each draft (`via Ollama · llama3.2`,
`via OpenAI · gpt-4o-mini`, …).

### Bring your own API key

1. Run **Shiplogue: Set API Key** from the Command Palette.
2. Pick a provider.
3. Paste the key (stored with VS Code SecretStorage → OS keychain).
4. Pick a model from the provider's list, or type an id if listing fails.

For `openai-compatible`, enter the base URL too, e.g.
`http://localhost:1234/v1` (LM Studio) or `https://openrouter.ai/api/v1`.

Other commands:

- **Shiplogue: Test Provider** — a short request with a realistic output budget
  (thinking-by-default endpoints would otherwise fail spuriously), to prove key,
  endpoint and model.
- **Shiplogue: Clear API Key** — deletes the stored key for a provider.

Keys are never written to `settings.json`, logs, or error messages. See
[`PRIVACY.md`](https://github.com/Phenzic/shiplogue/blob/main/extension/PRIVACY.md) for what a cloud provider receives.

## Install and run (development)

Shiplogue is not published to a marketplace yet.

```bash
cd extension
npm install
npm run compile      # or: npm run watch
```

Open the `extension/` folder in VS Code, Cursor or Antigravity and press **F5** to
launch the Extension Development Host. In that window:

- **Shiplogue: Generate Today's Update** — gather activity, generate a draft, open
  the review panel.
- **Shiplogue: Show Tracked Activity (debug)** — dump the raw gathered context so
  you can see exactly what the model sees.
- **Shiplogue: Set Reminder Time** — choose the local time for the daily nudge.
- **Shiplogue: Connect GitHub** — start the editor's GitHub sign-in for PR/issue
  context.
- **Shiplogue: Set API Key** / **Clear API Key** / **Test Provider** — configure,
  remove or verify a BYOK provider.

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

- **Two backend families:** local Ollama, or a BYOK provider (Anthropic, OpenAI,
  Google Gemini, OpenAI-compatible). Selection is explicit; `auto` prefers a
  configured provider, then Ollama, and never falls back silently.
- **Three detail levels:** concise (3–4 points), standard (5–7), elaborate (6–9,
  files enumerated).
- **Four tones:** neutral, junior, mid, senior.
- **Two formats:** Done / Next / Blockers (default) or Yesterday / Today /
  Blockers.
- **Reasoning-model support:** if a model spends its output budget on
  `thinking` and returns nothing, Shiplogue retries once with a larger budget and
  thinking disabled. Ollama uses `numPredict` / `numCtx` / `think`; a BYOK
  endpoint gets a retry at ≥4096 tokens with `reasoning_effort: "none"`, falling
  back to the budget alone if the endpoint rejects that parameter.
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
- **Startup health check:** when Ollama is the actual backend, warns if it is
  unreachable or the configured model is not pulled, with actions to install,
  pull it, or pick another model. A configured provider skips this check.
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
| `shiplogue.lookbackHours` | `24` | How far back to gather activity |
| `shiplogue.ollama.url` | `http://localhost:11434` | Ollama base URL |
| `shiplogue.ollama.model` | `llama3.2` | Model used to summarize |
| `shiplogue.ollama.numPredict` | `0` | Output token budget; `0` uses the per-detail default (400/900/1600) |
| `shiplogue.ollama.numCtx` | `8192` | Context window passed to Ollama; raise for very busy days |
| `shiplogue.ollama.think` | `auto` | Reasoning control: `auto` (retry with thinking off if empty), `on`, `off` |
| `shiplogue.model.backend` | `auto` | `auto` / `local` / `provider` / `ollama` |
| `shiplogue.provider.type` | `none` | `anthropic` / `openai` / `google` / `openai-compatible` |
| `shiplogue.provider.model` | `""` | Model id, normally set by **Shiplogue: Set API Key** |
| `shiplogue.provider.baseUrl` | `""` | Endpoint override, mainly for `openai-compatible` |
| `shiplogue.provider.maxOutputTokens` | `1200` | Hard cap on provider output; `0` uses the detail budget. A reasoning-only reply may trigger one recovery request above this cap |
| `shiplogue.github.useBuiltInAuth` | `true` | Use the editor's GitHub sign-in instead of a PAT |
| `shiplogue.github.token` | `""` | Optional PAT; overrides built-in auth |
| `shiplogue.github.repos` | `[]` | `owner/name` list; auto-detected from git `origin` when empty |
| `shiplogue.format` | `done-next-blockers` | Or `yesterday-today-blockers` |
| `shiplogue.scope` | `workspace` | `workspace` = folders open in this window; `all` = every project that day |
| `shiplogue.detail` | `concise` | `concise` / `standard` / `elaborate` |
| `shiplogue.tone` | `neutral` | `neutral` / `junior` / `mid` / `senior` |
| `shiplogue.webhook.type` | `none` | `discord` / `slack` / `none` |
| `shiplogue.webhook.url` | `""` | Incoming webhook URL (no bot/OAuth needed) |
| `shiplogue.track.enabled` | `true` | Track file saves/edits locally |
| `shiplogue.generate.timeoutSeconds` | `180` | Abort generation after N seconds; `0` disables |
| `shiplogue.store.retentionDays` | `14` | Delete activity logs older than N days; `0` = keep forever |
| `shiplogue.reminder.enabled` | `true` | Daily local-time nudge |
| `shiplogue.reminder.time` | `16:00` | Reminder time in 24h `HH:MM`, local time |
| `shiplogue.cursor.enabled` | `true` | Include Cursor AI prompts as context (Cursor only) |

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
billing exists yet. See the [project README](https://github.com/Phenzic/shiplogue/blob/main/README.md#plans-and-pricing-planned--not-live)
for the proposed tiers.

## Posting

Posting is **manual** in the current build: review the draft, then press **Send**.
Set `shiplogue.webhook.type` to `discord` or `slack` and paste an incoming webhook
URL into `shiplogue.webhook.url`. No bot or OAuth app is required.

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

The full current policy is in [`PRIVACY.md`](https://github.com/Phenzic/shiplogue/blob/main/extension/PRIVACY.md).

Today:

- Activity logs live under the editor's global storage:
  `.../User/globalStorage/phenzic.shiplogue/activity/` (one JSON file per local
  day). If you installed an earlier `standup-dev` dev build, its logs live under
  `standup-dev.standup/` and are not migrated automatically.
- Cursor's chat database is opened read-only with `immutable=1`; it is never
  modified.
- With Ollama on `localhost`, no activity text leaves the machine for
  summarisation. A remote `shiplogue.ollama.url` sends it there by your choice.
- **With a BYOK provider, the assembled activity context and prompt are sent to
  that provider** (Anthropic, OpenAI, Google, or the OpenAI-compatible endpoint
  you configured) so it can write the draft. That is inherent to using a cloud
  model; pick Ollama if activity must stay on-device. Shiplogue adds no other
  network calls for drafting.
- Provider API keys are stored with VS Code SecretStorage (OS keychain) and are
  never written to `settings.json`, logs, or error messages. Uninstalling the
  extension does not necessarily remove them — use **Shiplogue: Clear API Key** or
  your OS keychain.
- GitHub API calls happen only when GitHub context is enabled and credentials
  exist.
- Only the draft you explicitly post is sent to your webhook. There is no
  telemetry and no Shiplogue account.

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
check `shiplogue.ollama.url`. The warning offers an install link; it never blocks
activation. It only appears when Ollama is the backend that would be used — a
configured provider skips it.

**“Anthropic rejected the API key” / “OpenAI is rate limiting this key”**
Run **Shiplogue: Test Provider** to isolate key, endpoint and model in one request.
Replace the key with **Shiplogue: Set API Key**; rate limits and quota are enforced
by the provider, not Shiplogue. Error text never includes the key.

**“could not find that model”**
The model id is not available to that key (or was retired). Run **Shiplogue: Set API
Key** again and pick from the list, or update `shiplogue.provider.model`.

**A provider is configured but Shiplogue still talks to Ollama**
Check `shiplogue.model.backend`. `provider` never falls back; `auto` uses the
provider only when type, model and key (if required) are all present. A local
OpenAI-compatible endpoint also needs `shiplogue.provider.baseUrl`.

**“Model 'X' isn't pulled” warning**
Use **Pull now** to run `ollama pull X`, or **Pick another model** to choose an
installed one. The check matches `model` with or without `:latest`.

**I don't want to install Ollama**
You currently need a model backend. The planned free build will include a small
quantized local model; the planned paid build adds an optional hosted model. Until
then, Ollama is the supported backend.

**The draft is empty or cut off (Ollama)**
Raise `shiplogue.ollama.numPredict` (e.g. 4096–8192), raise
`shiplogue.ollama.numCtx`, or use a non-reasoning model such as `llama3.2`.
Ollama already retries once with a larger budget and thinking disabled.

**“The endpoint spent its whole output budget on reasoning…” (BYOK)**
Thinking is on by default on some endpoints (DeepSeek, reasoning models served
through OpenRouter/vLLM/llama.cpp). Shiplogue already retried once with a larger
budget and thinking off. If it still happens, raise
`shiplogue.provider.maxOutputTokens` (e.g. 4096–8192) or use a model without
thinking mode. The error reports `finish_reason` and the reasoning-token count so
you can tell truncation from an empty answer.

**Cursor prompts never appear**
Confirm you are running Cursor (not VS Code), `sqlite3` is on `PATH`, and
`shiplogue.cursor.enabled` is true. With `shiplogue.scope: workspace`, prompts are
scoped to the open workspace's chats.

**GitHub items are missing**
Run **Shiplogue: Connect GitHub**, or set a PAT in `shiplogue.github.token`. Only
merged PRs you authored and closed issues assigned to you are included. If
`shiplogue.github.repos` is empty, the repo is read from the git `origin` remote.

**Generation timed out**
Increase `shiplogue.generate.timeoutSeconds`, reduce `shiplogue.lookbackHours`, use a
smaller model, or check the Cursor database size. The Cancel button aborts
immediately.

**“Removed N unverifiable mention(s)”**
The grounding check removed a file path or `#number` that was not in the activity.
This is intentional; review the draft. The next build extends grounding to every
specific claim and makes it a release gate.

**Posting failed**
Check `shiplogue.webhook.type`/`url` and that the webhook still exists. Webhooks
must return 2xx.

**No activity found**
Commit or save some work, or increase `shiplogue.lookbackHours`. In a window with
no folder open, Shiplogue falls back to all projects.

**Context or token limits**
The current build caps input at 25 commits, 20 Cursor prompts and 30 GitHub
items and shows “showing N of M”. If your model still reports a context problem,
raise `shiplogue.ollama.numCtx` (Ollama) or reduce `shiplogue.lookbackHours` / lower
`shiplogue.detail` (providers). A preflight budget check with a clear warning is
planned.

## Known limitations

- **Ollama or an API key is required.** There is no bundled model yet; hosted
  plans are planned, not available.
- **Reasoning-by-default providers can bill one extra call.** If the first reply
  is reasoning-only, the recovery request is a second paid call; it is skipped
  when the first reply already contains the answer.
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
- **Not on a marketplace yet.** No Marketplace/Open VSX listing; the beta ships as a
  GitHub prerelease with a VSIX.
- **Paid plans and the hosted service are proposals.** No billing exists yet;
  prices are indicative.

## Roadmap

**0.1.3 — beta (current)**

- Packaging cleanup for the Marketplace listing: removed a stray runtime
  dependency, trimmed tags to the documented limit, stopped shipping internal QA
  notes in the VSIX, and pointed README links at absolute GitHub URLs.

**0.1.2 — beta (2026-10-31)**

- Renamed from Standup to **Shiplogue**: extension id `phenzic.shiplogue`,
  commands and settings under `shiplogue.*`, and a new local storage path.
  Reinstall the VSIX and re-enter your provider key.
- Everything from 0.1.1: Ollama, plus bring-your-own-key Anthropic / OpenAI /
  Google / OpenAI-compatible providers with keys in the OS keychain.

**0.1.1 — beta (2026-10-29)**

- Ollama, plus bring-your-own-key Anthropic / OpenAI / Google / OpenAI-compatible
  providers with keys in the OS keychain.
- Reasoning-only replies from BYOK endpoints recover automatically (larger
  budget, thinking off), and **Shiplogue: Test Provider** probes with a realistic
  budget.
- Packaging, publisher and test-runner metadata are in place.
- Remaining: manual QA in a real extension host (BYOK setup, health check, real
  GitHub sign-in, real Discord/Slack webhooks, multi-root and no-folder windows,
  cancel and soak tests), then a GitHub Release VSIX.

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
[`CONTRIBUTING.md`](https://github.com/Phenzic/shiplogue/blob/main/CONTRIBUTING.md).

## License

MIT — see [LICENSE](https://github.com/Phenzic/shiplogue/blob/main/LICENSE). The extension is free and open source; planned
paid plans cover hosted inference, scheduled automation and enterprise
deployment, not the local core.

The project overview is in [`README.md`](https://github.com/Phenzic/shiplogue/blob/main/README.md); the repository is
[Phenzic/shiplogue](https://github.com/Phenzic/shiplogue).
