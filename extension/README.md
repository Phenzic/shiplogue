# Standup Draft — VS Code-compatible extension

**Local-first daily stand-ups, drafted from your actual IDE activity.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Phenzic/standup-draft/blob/main/LICENSE)

Standup Draft watches the work you already did — git commits, saved files and
GitHub PRs/issues — then asks a model to write your stand-up. You review and
edit the draft, then copy it.

It is local-first by default: a local Ollama server, or a bundled quantized model
in a later build. Bring-your-own-key providers (Anthropic, OpenAI, Google, or an
OpenAI-compatible endpoint) are available now if you would rather not run a local
model. A higher-capacity hosted model is planned as an opt-in paid option.

> **Status:** **0.2.0** beta. Marketplace submission is pending review — install
> the VSIX from GitHub Releases (or run from source). This build uses Ollama or
> your own API key.
>
> **Current vs planned:** today: Ollama, bring-your-own-key providers (Anthropic /
> OpenAI / Google / OpenAI-compatible), manual review. Later:
> bundled local model, hosted model, paid plans. Nothing paid
> or hosted by us exists yet.

## Data & privacy

No account, no telemetry. Local activity is read only to draft a stand-up, and
text leaves your machine only through the backend you configure.

| Source | Default | What happens |
| --- | --- | --- |
| Git commits and changed files (current workspace) | On | Becomes prompt text for your model backend |
| Saved/edited files (local activity log) | On | Becomes prompt text for your model backend |
| GitHub PRs and issues | Only if you connect GitHub | Fetched from `api.github.com`; included in the prompt when drafting |
| The draft | — | Sent to the model backend when you generate |

- **This Marketplace build does not read Cursor's chat database.** It uses git,
  saved files and GitHub only; no prompt history is opened or uploaded.
- **Ollama on localhost stays local.** A BYOK provider or a remote
  `standupDraft.ollama.url` receives the prompt (activity included).
- Turn tracking off entirely with `standupDraft.track.enabled: false`; disconnect
  GitHub to stop those calls. This build never posts anywhere; you copy drafts
  yourself.

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
    OpenAI-compatible endpoint. Run **Standup Draft: Set API Key** and pick a model.
    The key is stored in the OS keychain, not in settings.
  A bundled quantized model (no Ollama, no key) is planned, not available yet.
- **Node/npm** for the development install.
- Optional: **GitHub** sign-in or a personal access token for merged-PR and
  closed-issue context.

## Model backends

| Backend | Status | Setup | Where activity goes |
| --- | --- | --- | --- |
| Ollama | **Available now** | Install Ollama, pull a model | Your local Ollama server |
| Your own API key (BYOK) | **Available now** | `Standup Draft: Set API Key` | The provider you choose (Anthropic, OpenAI, Google, or your compatible endpoint) |
| Bundled quantized model | Planned (free) | None | On-device |
| Hosted higher-capacity model | Planned (paid) | Opt-in account | Hosted API; raw diffs not retained |

`standupDraft.model.backend` controls selection:

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

1. Run **Standup Draft: Set API Key** from the Command Palette.
2. Pick a provider.
3. Paste the key (stored with VS Code SecretStorage → OS keychain).
4. Pick a model from the provider's list, or type an id if listing fails.

For `openai-compatible`, enter the base URL too, e.g.
`http://localhost:1234/v1` (LM Studio) or `https://openrouter.ai/api/v1`.

Other commands:

- **Standup Draft: Test Provider** — a short request with a realistic output budget
  (thinking-by-default endpoints would otherwise fail spuriously), to prove key,
  endpoint and model.
- **Standup Draft: Clear API Key** — deletes the stored key for a provider.

Keys are never written to `settings.json`, logs, or error messages. See
[`PRIVACY.md`](https://github.com/Phenzic/standup-draft/blob/main/extension/PRIVACY.md) for what a cloud provider receives.

## Install and run (development)

Standup Draft is not published to a marketplace yet.

```bash
cd extension
npm install
npm run compile      # or: npm run watch
```

Open the `extension/` folder in VS Code, Cursor or Antigravity and press **F5** to
launch the Extension Development Host. In that window:

- **Standup Draft: Generate Today's Update** — gather activity, generate a draft, open
  the review panel.
- **Standup Draft: Show Tracked Activity (debug)** — dump the raw gathered context so
  you can see exactly what the model sees.
- **Standup Draft: Set Reminder Time** — choose the local time for the daily nudge.
- **Standup Draft: Connect GitHub** — start the editor's GitHub sign-in for PR/issue
  context.
- **Standup Draft: Set API Key** / **Clear API Key** / **Test Provider** — configure,
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
  `thinking` and returns nothing, Standup Draft retries once with a larger budget and
  thinking disabled. Ollama uses `numPredict` / `numCtx` / `think`; a BYOK
  endpoint gets a retry at ≥4096 tokens with `reasoning_effort: "none"`, falling
  back to the budget alone if the endpoint rejects that parameter.
- **Automatic repair pass** if the model under-splits and the activity supports
  the requested minimum. It splits real work; it does not pad with invented
  items.
- **Grounding v2 (hard gate):** every specific claim in the draft — file paths,
  `#issue`/`#PR` numbers, URLs, dates, versions, people and completion claims
  ("shipped/merged/deployed…") — must be backed by the gathered activity.
  Unsupported mentions are stripped; if a repair pass still leaves unverifiable
  claims, the panel flags the draft as **Needs review** instead of presenting it
  as clean. The status line reports "Verified N claims · M removed · K inferred".
- **Deterministic formatting:** 3+ files become indented sub-bullets; references
  are built from fetched GitHub data, so links cannot be hallucinated.
- **Prompt-injection hygiene:** activity is wrapped as untrusted data, and
  instruction-looking lines are neutralised before reaching the model.
- **Startup health check:** when Ollama is the actual backend, warns if it is
  unreachable or the configured model is not pulled, with actions to install,
  pull it, or pick another model. A configured provider skips this check.
- **Input caps:** 25 commits and 30 GitHub items, with
  “showing N of M” notes so omitted activity stays visible. A preflight
  token-budget check and priority trimming are planned.

### Review

- Markdown and Plain text tabs; both editable and independently copyable.
- **Copy**, **Regenerate**, **Cancel**, and Detail/Tone controls.
- Live progress with phase and elapsed seconds; a new run supersedes and cancels
  the previous one; a configurable timeout prevents a stuck request.
- **Daily reminder** at your local time, with *Generate now* and *Snooze 1h*.
- **Local retention:** activity logs older than 14 days are pruned on startup
  (configurable; `0` keeps them forever).

### Keyboard shortcut

- **`Cmd+Shift+J`** on macOS, **`Ctrl+Shift+J`** on Windows/Linux:
  generate today's update without opening the command palette.
- The binding is inactive while the terminal has focus, so it doesn't steal
  terminal shortcuts.
- Run **Standup Draft: Configure Keyboard Shortcut** to open the Keyboard Shortcuts
  editor filtered to the command if another extension or a keymap already uses
  the chord.

## Settings

All settings are current; future model-backend options will be added when those
backends ship.

| Setting | Default | What it does |
| --- | --- | --- |
| `standupDraft.lookbackHours` | `24` | How far back to gather activity |
| `standupDraft.ollama.url` | `http://localhost:11434` | Ollama base URL |
| `standupDraft.ollama.model` | `llama3.2` | Model used to summarize |
| `standupDraft.ollama.numPredict` | `0` | Output token budget; `0` uses the per-detail default (400/900/1600) |
| `standupDraft.ollama.numCtx` | `8192` | Context window passed to Ollama; raise for very busy days |
| `standupDraft.model.contextTokens` | `16384` | Context budget for the local model / BYOK estimate; Ollama uses `standupDraft.ollama.numCtx` |
| `standupDraft.ollama.think` | `auto` | Reasoning control: `auto` (retry with thinking off if empty), `on`, `off` |
| `standupDraft.model.backend` | `auto` | `auto` / `local` / `provider` / `ollama` |
| `standupDraft.provider.type` | `none` | `anthropic` / `openai` / `google` / `openai-compatible` |
| `standupDraft.provider.model` | `""` | Model id, normally set by **Standup Draft: Set API Key** |
| `standupDraft.provider.baseUrl` | `""` | Endpoint override, mainly for `openai-compatible` |
| `standupDraft.provider.maxOutputTokens` | `1200` | Hard cap on provider output; `0` uses the detail budget. A reasoning-only reply may trigger one recovery request above this cap |
| `standupDraft.github.useBuiltInAuth` | `true` | Use the editor's GitHub sign-in instead of a PAT |
| `standupDraft.github.token` | `""` | Optional PAT; overrides built-in auth |
| `standupDraft.github.repos` | `[]` | `owner/name` list; auto-detected from git `origin` when empty |
| `standupDraft.format` | `done-next-blockers` | Or `yesterday-today-blockers` |
| `standupDraft.scope` | `workspace` | `workspace` = folders open in this window; `all` = every project that day |
| `standupDraft.detail` | `concise` | `concise` / `standard` / `elaborate` |
| `standupDraft.tone` | `neutral` | `neutral` / `junior` / `mid` / `senior` |
| `standupDraft.track.enabled` | `true` | Track file saves/edits locally |
| `standupDraft.generate.timeoutSeconds` | `180` | Abort generation after N seconds; `0` disables |
| `standupDraft.store.retentionDays` | `14` | Delete activity logs older than N days; `0` = keep forever |
| `standupDraft.reminder.enabled` | `true` | Daily local-time nudge |
| `standupDraft.reminder.time` | `16:00` | Reminder time in 24h `HH:MM`, local time |

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

The status line shows progress, cancellation, timeout, grounding removals and
input-cap notes.

## Feedback & rating

Standup Draft is built in the open and feedback shapes it. Ways to reach us:

- **In the panel:** after a draft, click 👍 or 👎 (next to Copy). 👎 opens a
  short feedback form; the link carries only your extension version, OS and
  model backend — never your draft or activity.
- **Command palette:** **Standup Draft: Share Feedback** opens the same form any time.
- **Like it?** Run **Standup Draft: Star on GitHub** or **Standup Draft: Rate on the
  Marketplace** — ratings are how others find the extension.
- After a few successful drafts you'll get one polite prompt per version asking
  how it's going; "Not now" snoozes it for 30 days, "Don't ask again" opts out
  forever (`standupDraft.feedback.enabled` turns the prompt off entirely).

## Privacy details

The full current policy is in [`PRIVACY.md`](https://github.com/Phenzic/standup-draft/blob/main/extension/PRIVACY.md).

Today:

- Activity logs live under the editor's global storage:
  `.../User/globalStorage/phenzic.standup-draft/activity/` (one JSON file per local
  day). If you installed an earlier `standup-dev` dev build, its logs live under
  `standup-dev.standup/` and are not migrated automatically.
- With Ollama on `localhost`, no activity text leaves the machine for
  summarisation. A remote `standupDraft.ollama.url` sends it there by your choice.
- **With a BYOK provider, the assembled activity context and prompt are sent to
  that provider** (Anthropic, OpenAI, Google, or the OpenAI-compatible endpoint
  you configured) so it can write the draft. That is inherent to using a cloud
  model; pick Ollama if activity must stay on-device. Standup Draft adds no other
  network calls for drafting.
- Provider API keys are stored with VS Code SecretStorage (OS keychain) and are
  never written to `settings.json`, logs, or error messages. Uninstalling the
  extension does not necessarily remove them — use **Standup Draft: Clear API Key** or
  your OS keychain.
- GitHub API calls happen only when GitHub context is enabled and credentials
  exist.
- This build never posts anywhere. There is no telemetry and no Standup Draft
  account.

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
check `standupDraft.ollama.url`. The warning offers an install link; it never blocks
activation. It only appears when Ollama is the backend that would be used — a
configured provider skips it.

**“Anthropic rejected the API key” / “OpenAI is rate limiting this key”**
Run **Standup Draft: Test Provider** to isolate key, endpoint and model in one request.
Replace the key with **Standup Draft: Set API Key**; rate limits and quota are enforced
by the provider, not Standup Draft. Error text never includes the key.

**“could not find that model”**
The model id is not available to that key (or was retired). Run **Standup Draft: Set API
Key** again and pick from the list, or update `standupDraft.provider.model`.

**A provider is configured but Standup Draft still talks to Ollama**
Check `standupDraft.model.backend`. `provider` never falls back; `auto` uses the
provider only when type, model and key (if required) are all present. A local
OpenAI-compatible endpoint also needs `standupDraft.provider.baseUrl`.

**“Model 'X' isn't pulled” warning**
Use **Pull now** to run `ollama pull X`, or **Pick another model** to choose an
installed one. The check matches `model` with or without `:latest`.

**I don't want to install Ollama**
You currently need a model backend. The planned free build will include a small
quantized local model; the planned paid build adds an optional hosted model. Until
then, Ollama is the supported backend.

**The draft is empty or cut off (Ollama)**
Raise `standupDraft.ollama.numPredict` (e.g. 4096–8192), raise
`standupDraft.ollama.numCtx`, or use a non-reasoning model such as `llama3.2`.
Ollama already retries once with a larger budget and thinking disabled.

**“The endpoint spent its whole output budget on reasoning…” (BYOK)**
Thinking is on by default on some endpoints (DeepSeek, reasoning models served
through OpenRouter/vLLM/llama.cpp). Standup Draft already retried once with a larger
budget and thinking off. If it still happens, raise
`standupDraft.provider.maxOutputTokens` (e.g. 4096–8192) or use a model without
thinking mode. The error reports `finish_reason` and the reasoning-token count so
you can tell truncation from an empty answer.

**GitHub items are missing**
Run **Standup Draft: Connect GitHub**, or set a PAT in `standupDraft.github.token`. Only
merged PRs you authored and closed issues assigned to you are included. If
`standupDraft.github.repos` is empty, the repo is read from the git `origin` remote.

**Generation timed out**
Increase `standupDraft.generate.timeoutSeconds`, reduce `standupDraft.lookbackHours`, use a
smaller model. The Cancel button aborts
immediately.

**“Removed N unverifiable mention(s)” / “Needs review”**
The grounding check removed claims (file paths, `#numbers`, URLs, dates, people,
completions) that were not in the activity. “Needs review” means a repair pass
still left unverified claims — read the draft carefully before using it.

**No activity found**
Commit or save some work, or increase `standupDraft.lookbackHours`. In a window with
no folder open, Standup Draft falls back to all projects.

**Context or token limits**
The current build caps input at 25 commits and 30 GitHub
items and shows “showing N of M”. If your model still reports a context problem,
raise `standupDraft.ollama.numCtx` (Ollama) or reduce `standupDraft.lookbackHours` / lower
`standupDraft.detail` (providers). A preflight budget check with a clear warning is
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
- **AI prompt capture is not included in this build.** Git, saved files and GitHub are the only activity sources.
- **Grounding is deterministic, not perfect.** It verifies specific claims
  against the gathered activity; it cannot judge whether a true claim matters.
- **Reminder timing requires the editor to be open.** There is no OS scheduler.
- **Real-host QA is pending.** Automated tests cover the core; a manual F5 pass
  on macOS (and Windows where available) is still part of the launch checklist.
  Antigravity installs the VSIX; runtime QA there is pending. Windows paths are
  unit-tested, not verified on a real Windows machine.
- **Built-in GitHub auth depends on the host.** A PAT always works.
- **Marketplace submission pending.** No Marketplace listing yet; the beta ships
  as a GitHub prerelease with a VSIX.
- **Paid plans and the hosted service are proposals.** No billing exists yet;
  prices are indicative.

## Roadmap

**0.2.0 — beta (current)**

- Renamed from Shiplogue to **Standup Draft**: extension id
  `phenzic.standup-draft`, commands and settings under `standupDraft.*`, new
  storage and secret names. Uninstall 0.1.x and re-enter your provider key.
- This Marketplace build excludes Cursor chat-DB capture; the full build offers it
  as opt-in, off by default.
- Marketplace listing cleanup (no placeholder screenshot, no proposed pricing
  table, less third-party branding in the description).
- Everything from 0.1.3 and the feature work in this release: feedback loop,
  shared pure core, grounding v2, context preflight and the generate shortcut.

**0.1.3 — beta (2026-11-01)**

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
  GitHub sign-in, multi-root and no-folder windows,
  cancel and soak tests), then a GitHub Release VSIX.

**Next build — hardening and productization (working title 0.3.0)**

- **Hard grounding:** every specific claim must be backed by activity; no silent
  fixes; release gate.
- **Context preflight:** estimate the prompt budget, trim by priority and show
  what was omitted before calling the model.
- **Bundled quantized local model:** no Ollama setup for a useful free draft.
- **Optional hosted model and plans:** Free local; Pro hosted/automation;
  Enterprise on-prem/SLA.
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
```

The test suite uses Node's built-in runner (no extra dependencies). It stubs the
`vscode` API, starts local mock Ollama servers, creates temporary git
repos and synthetic SQLite databases. Real-model tests skip
without their environment variables.

For repository layout, coding conventions and the pull-request checklist, see
[`CONTRIBUTING.md`](https://github.com/Phenzic/standup-draft/blob/main/CONTRIBUTING.md).

## License

MIT — see [LICENSE](https://github.com/Phenzic/standup-draft/blob/main/LICENSE). The extension is free and open source; planned
paid plans cover hosted inference, scheduled automation and enterprise
deployment, not the local core.

The project overview is in [`README.md`](https://github.com/Phenzic/standup-draft/blob/main/README.md); the repository is
[Phenzic/standup-draft](https://github.com/Phenzic/standup-draft).
