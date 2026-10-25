# Standup — VS Code / Cursor extension

**Local-first daily stand-ups, drafted from your actual IDE activity.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)

Standup watches the work you already did — git commits, saved files, GitHub PRs
and issues, and (in Cursor) the prompts you gave your AI assistant — then asks a
local [Ollama](https://ollama.com) model to write your stand-up. You review and
edit the draft, then copy it or send it to Slack/Discord.

No Standup account, no cloud model, no telemetry. Activity stays on your machine.

> **Status:** development tree for **0.1.0** (package version is still `0.0.8`).
> There is no Marketplace/Open VSX listing yet — run from source.
>
> **Screenshot/GIF placeholder** — capture the Stand-up panel with a generated
> draft and replace this block before publishing.

## Requirements

- **VS Code 1.85+** or **Cursor**. Other VS Code-compatible forks should work,
  but VS Code and Cursor are the supported targets; only Cursor has been
  exercised in a real host so far.
- **[Ollama](https://ollama.com)** running locally with a model pulled:
  ```bash
  ollama pull llama3.2
  ```
- **Node/npm** for the development install.
- Optional: **GitHub** sign-in or a personal access token for merged-PR and
  closed-issue context.
- Optional: **`sqlite3`** on `PATH` for Cursor prompt context.

## Install and run (development)

Standup is not published to a marketplace yet.

```bash
cd extension
npm install
npm run compile      # or: npm run watch
```

Open the `extension/` folder in VS Code or Cursor and press **F5** to launch the
Extension Development Host. In that window:

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

- **Local Ollama** by default (`llama3.2` at `http://localhost:11434`).
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
  in the activity are removed, and the panel reports what was removed.
- **Deterministic formatting:** 3+ files become indented sub-bullets; references
  are built from fetched GitHub data, so links cannot be hallucinated.
- **Prompt-injection hygiene:** activity is wrapped as untrusted data, and
  instruction-looking lines are neutralised before reaching the model.
- **Startup health check:** warns if Ollama is unreachable or the configured
  model is not pulled, with actions to install, pull it, or pick another model.
- **Input caps:** 25 commits, 20 Cursor prompts and 30 GitHub items, with
  “showing N of M” notes so a busy day is never silently truncated.

### Review and posting

- Markdown and Plain text tabs; both editable and independently copyable.
- **Copy**, **Regenerate**, **Cancel**, and Detail/Tone controls.
- Live progress with phase and elapsed seconds; a new run supersedes and cancels
  the previous one; a configurable timeout prevents a stuck request.
- **Manual posting** to one Discord or Slack incoming webhook. Discord drafts are
  split into up to three messages; Slack gets Markdown converted to mrkdwn.
  Beyond three Discord messages, the full text is copied to the clipboard.
- **Daily reminder** at your local time, with *Generate now* and *Snooze 1h*.
- **Local retention:** activity logs older than 14 days are pruned on startup
  (configurable; `0` keeps them forever).

## Settings

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

## Posting

Posting is **manual**: review the draft, then press **Send**. Set
`standup.webhook.type` to `discord` or `slack` and paste an incoming webhook URL
into `standup.webhook.url`. No bot or OAuth app is required.

- **Discord:** content is split at line/word boundaries into up to three messages
  of ≤1,990 characters. If more would be needed, the first three are posted, the
  remainder is skipped, and the full text is copied to the clipboard.
- **Slack:** the Markdown draft is converted to Slack mrkdwn (`**bold**` →
  `*bold*`, links → `<url|text>`), regardless of which tab is active. Because
  Slack needs Markdown, edits made only in the Plain text tab are not sent to
  Slack.
- Only one webhook target is configured at a time.

**Automatic daily posting is planned, not implemented.** It is not available in
this build; today every post is a reviewed manual action. When it lands, it will
be an optional scheduled post to the configured Discord or Slack webhook.

## Privacy and local data

- Activity logs live under the editor's global storage:
  `.../User/globalStorage/standup-dev.standup/activity/` (one JSON file per local
  day).
- Cursor's chat database is opened read-only with `immutable=1`; it is never
  modified.
- With Ollama on `localhost`, no activity text leaves the machine for
  summarisation. A remote `standup.ollama.url` sends it there by your choice.
- GitHub API calls happen only when GitHub context is enabled and credentials
  exist.
- Only the draft you explicitly post is sent to your webhook. There is no
  telemetry and no account.

## Troubleshooting

**“Ollama isn't running” warning at startup**
Start Ollama (`ollama serve`, or `brew services start ollama` on macOS), then
check `standup.ollama.url`. The warning offers an install link; it never blocks
activation.

**“Model 'X' isn't pulled” warning**
Use **Pull now** to run `ollama pull X`, or **Pick another model** to choose an
installed one. The check matches `model` with or without `:latest`.

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
This is intentional; review the draft. It is a heuristic, not a proof.

**Posting failed**
Check `standup.webhook.type`/`url` and that the webhook still exists. Webhooks
must return 2xx.

**No activity found**
Commit or save some work, or increase `standup.lookbackHours`. In a window with
no folder open, Standup falls back to all projects.

## Known limitations

- **VS Code-family only.** No JetBrains, Zed, Neovim or Sublime plugin.
- **AI prompt capture is Cursor-only.** VS Code/Copilot chat history is not read.
- **Manual posting only.** Automatic daily posting is planned.
- **One webhook target.** Discord or Slack, not both simultaneously.
- **Grounding is heuristic.** It removes what it cannot verify, but it cannot
  prove prose claims; review elaborate drafts.
- **Reminder timing requires the editor to be open.** There is no OS scheduler.
- **Real-host QA is pending.** Automated tests cover the core; a manual F5 pass
  on macOS (and Windows where available) is still part of the launch checklist.
  Windows paths are unit-tested, not verified on a real Windows machine.
- **Cursor reads can be slow on very large databases.** This is why generation is
  cancellable and has a timeout.
- **`sqlite3` is required for Cursor prompts.** Without it, that source returns
  nothing.
- **Built-in GitHub auth depends on the host.** A PAT always works.
- **Not published.** No Marketplace/Open VSX listing or packaged release yet.

## Roadmap

**0.1.0 — launch readiness (in progress)**

- CI across operating systems, Marketplace metadata, changelog, privacy
  statement, version bump.
- Manual QA in a real extension host: health check, real GitHub sign-in, real
  Discord/Slack webhooks, multi-root and no-folder windows, cancel and soak
  tests.

**Planned, not scheduled**

- Optional automatic daily posting to the configured Discord or Slack webhook.
- More editor adapters and browser activity.
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

Project shape:

```text
src/
  config.ts        typed settings reader
  tracker.ts       save/edit events
  store.ts         per-day activity log (atomic writes, retention)
  gather.ts        collection, caps, context rendering
  paths.ts         cross-platform path normalization
  git.ts           commit collection
  github.ts        PR/issue collection
  cursor.ts        Cursor chat DB reader + workspace scoping
  summarize.ts     prompts, Ollama call, retry/repair/grounding
  format.ts        sublists, references, grounding, Slack mrkdwn, plain text
  standupPanel.ts  webview panel and message handling
  post.ts          Discord/Slack webhooks
  reminder.ts      daily reminder
  state.ts         global state (detail/tone/reminder markers)
  types.ts         shared data shapes
  extension.ts     activation, commands, generation orchestration
test/              Node test suite (stubbed vscode, mock servers, temp repos)
```

Contributions are welcome. Keep runtime dependencies at zero, run `npm test`, and
if you add a setting update `src/config.ts`, `package.json` and this README
together.

## License

MIT — see [LICENSE](../LICENSE). The project overview is in
[`../README.md`](../README.md); the repository is
[Phenzic/standup_bot](https://github.com/Phenzic/standup_bot).
