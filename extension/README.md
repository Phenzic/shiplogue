# Shiplogue

**Your daily stand-up, drafted from the work you've already done.**

[![Marketplace](https://img.shields.io/badge/Marketplace-Shiplogue-1e3a5f.svg)](https://marketplace.visualstudio.com/items?itemName=phenzic.shiplogue)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-Shiplogue-6b4fbb.svg)](https://open-vsx.org/extension/phenzic/shiplogue)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Phenzic/shiplogue/blob/main/LICENSE)
[![Website](https://img.shields.io/badge/website-shiplogue.dev-1e3a5f.svg)](https://shiplogue.dev)

Shiplogue turns your real work — commits, changed files, GitHub PRs and issues,
and your AI chat context — into a review-ready stand-up. It runs locally with
Ollama or your own API key. Cloud sync is optional: share the reviewed draft, or
send it to Slack, Discord or Teams on a schedule.

## Commands

Open the Command Palette first:

- **macOS:** `Cmd + Shift + P`
- **Windows / Linux:** `Ctrl + Shift + P`

Then type `Shiplogue:` to see every command.

## What it does

- **Writes the first draft for you.** Yesterday / Today / Next / Blockers, in
  plain English, grouped from the work you actually did.
- **Uses your evidence.** Git commits and changed files, saved files, merged PRs,
  closed issues, and AI prompts from Cursor, Copilot or Antigravity where available.
- **Keeps you in control.** Review, edit and copy the draft. Nothing posts unless you choose **Send via Shiplogue Cloud** or enable scheduled posting.
- **Keeps your data local by default.** Ollama runs on your machine; API keys live
  in the OS keychain; private and `.gitignore`d paths are never recorded.

## Features

| Feature | What you get |
| --- | --- |
| **Real activity** | Commits, file saves, PRs/issues and AI prompts, scoped to the open workspace. |
| **Useful format** | Fixed Yesterday / Today / Next / Blockers, with a 1-2 sentence headline and Today grouped into ranked, tagged workstreams. |
| **Three detail levels** | Concise (3–4 points), Standard (5–7), Elaborate (6–9). |
| **Four tones** | Neutral, Junior, Mid, Senior. |
| **Two model options** | Local Ollama, or BYOK for Anthropic, OpenAI, Google or any OpenAI-compatible endpoint. |
| **Review panel** | Rendered preview (or raw Markdown / Plain text), a verification strip (claims checked, removed, inferred, needs-review highlights), one-click Copy, Regenerate, Cancel, and inline Detail/Tone. |
| **Draft history** | A searchable History tab in the panel: every draft with its model, detail/tone, verification state and send status; preview, copy or restore any of them. |
| **Local history** | Every draft is kept on-device for 7 days; **Shiplogue: Open Stand-up History** shows the last week, and yesterday's reviewed copy feeds the next Yesterday section. |
| **Weekly recap (Pro)** | Compiles the week’s Today sections, details, coverage counts and open threads. Requires a Pro plan. |
| **Daily reminder** | A local-time nudge, with Generate now / Snooze 1h. |
| **Shortcut** | `Cmd+Shift+'` (macOS) / `Ctrl+Shift+'` (Windows/Linux). Rebind from the Command Palette. |
| **Cloud sync (optional)** | Connect a connector key to sync generated stand-ups to your private Shiplogue dashboard; copying a reviewed draft upserts the final text. |
| **Send via Shiplogue Cloud (Pro)** | From the panel or history, ask Shiplogue Cloud to post your stand-up to the targets you configured in the dashboard (Slack/Discord/Teams). Scheduled auto-posting also runs cloud-side. The extension never talks to a webhook directly. |
| **Feedback & rating** | One question per version after a few drafts, a 👍-triggered GitHub star nudge, and Share Feedback / Star / Rate commands. |

The local core is open source under MIT. The built-in format is fixed; optional cloud delivery, history and weekly recap are Pro features.

## Compatibility

| Editor | Status |
| --- | --- |
| **VS Code** 1.85+ | Supported |
| **Cursor** | Supported |
| **Antigravity** | Supported |
| **VSCodium / Windsurf** | VS Code-compatible; install the VSIX |

AI chat context is read only from Cursor, Copilot and Antigravity stores. Other
editors use git, file and GitHub activity.

## Install

- **VS Code:** search for **Shiplogue** in Extensions, or run
  `code --install-extension phenzic.shiplogue`.
- **Open VSX:** [open-vsx.org/extension/phenzic/shiplogue](https://open-vsx.org/extension/phenzic/shiplogue).
- **Cursor / Antigravity:** search for **Shiplogue**; if it is not in the gallery,
  download the VSIX from either listing and use **Install from VSIX**.

## Quick start

1. Install Shiplogue from your editor's Extensions view.
2. Open a project with today's work.
3. Open the Command Palette with `Cmd + Shift + P` (macOS) or `Ctrl + Shift + P`
   (Windows / Linux), then choose a model:
   - **Ollama** — install [Ollama](https://ollama.com), run `ollama pull llama3.2`,
     then select `Shiplogue: Set API Key` and choose Ollama.
   - **Your own key** — run `Shiplogue: Set API Key`, pick a provider and model.
4. Run `Shiplogue: Generate Today's Update`, or press `Cmd+Shift+'` / `Ctrl+Shift+'`.
5. Review and edit the draft, then **Copy**.

## Cloud sync (optional)

Shiplogue can sync a generated stand-up to your private Shiplogue workspace so it
appears on the dashboard and counts toward your team's history. It is **off until
you connect a key**; local generation, Ollama, BYOK and local activity storage keep
working without an account.

1. Sign in at [shiplogue.dev](https://shiplogue.dev), create a connector key, and
   copy it (it is shown once).
2. Open the Command Palette, run `Shiplogue: Connect Cloud`, and paste the key.
3. Generate a stand-up as usual. The draft is synced with the current date.

Each open project is a separate local workspace. Generation scopes to the active
project, and synced drafts keep the project name plus their IDE/agent source tags
so the dashboard can group and label them. Every Friday evening (18:00 local by
default) Shiplogue compiles the stored daily drafts into a weekly recap, adds it
to draft history, and prompts you to view it. Change the day/time with
`shiplogue.weeklyRecap.day` and `shiplogue.weeklyRecap.time`; run
**Shiplogue: Generate Weekly Recap Now** to do it immediately.

**Weekly recap is a Pro feature.** Local drafts and the basic extension remain
free, but the weekly recap requires a Pro plan.

The key lives in the OS keychain (VS Code SecretStorage), never in settings. Raw
activity and prompts are not uploaded; the extension sends the finished draft and
an estimated time saved. Use **Shiplogue: Cloud Status** to verify the workspace
and scopes, or **Shiplogue: Disconnect Cloud** to remove the key.

When connecting, Shiplogue asks whether to share anonymous product metadata
(events such as generated, copied, and sync success/failure, plus counts and
durations). Choose **Enable anonymous usage**, or enable
`shiplogue.telemetry.enabled` later. It sends only while a connector key exists
and never includes stand-up content. Settings:

| Setting | Default | Purpose |
| --- | --- | --- |
| `shiplogue.cloud.url` | `https://shiplogue.dev` | Cloud origin, or `http://localhost:3000` for local development. |
| `shiplogue.cloud.enabled` | `true` | Set to `false` to keep drafts local even with a key connected. |
| `shiplogue.cloud.estimatedMinutesSaved` | `10` | Estimate recorded with each synced draft; set `0` to report none. |
| `shiplogue.telemetry.enabled` | `false` | Opt in to anonymous usage metadata for the admin dashboard. Never includes stand-up text, prompts, paths, repositories, or error messages. |

## Models and privacy

| Backend | Setup | Where activity goes |
| --- | --- | --- |
| Ollama | Install Ollama and pull a model | Your local Ollama server |
| BYOK | **Shiplogue: Set API Key** | The provider you choose |
| Shiplogue hosted (planned) | Opt-in account | Hosted Shiplogue API |

- API keys are stored with VS Code SecretStorage (OS keychain), never in settings
  or logs.
- `shiplogue.model.backend` is `auto`, `provider` or `ollama`. A configured
  provider wins under `auto`; there is no silent fallback.
- With BYOK, the assembled activity context is sent to that provider. Use Ollama
  if activity must stay on-device.
- One anonymous install presence ping is sent per version by default: a random install ID, version, and platform. It contains no IP address, account, workspace, prompts, paths, or activity, respects the editor telemetry setting, and can be disabled with `shiplogue.installTelemetry.enabled`. Product-usage telemetry remains opt-in and requires a connector key. Cloud sync is optional; local generation works without an account.

Full details: [PRIVACY.md](https://github.com/Phenzic/shiplogue/blob/main/extension/PRIVACY.md).

## Common settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `shiplogue.lookbackHours` | `24` | Legacy debug window; daily generation now uses the local calendar day. |
| `shiplogue.activitySync.enabled` | `true` | Metadata-only activity sync (paths, commits, sessions, tokens). No file contents or prompt text. |
| `shiplogue.installTelemetry.enabled` | `true` | One anonymous install ID + version per version; no IP/account/activity. Respects editor telemetry. |
| `shiplogue.detail` | `concise` | `concise` / `standard` / `elaborate` |
| `shiplogue.tone` | `neutral` | `neutral` / `junior` / `mid` / `senior` |
| `shiplogue.model.backend` | `auto` | `auto` / `provider` / `ollama` |
| `shiplogue.ollama.model` | `llama3.2` | Local model name |
| `shiplogue.reminder.time` | `16:00` | Daily reminder, local `HH:MM` |
| `shiplogue.history.retentionDays` | `7` | Days of draft history kept locally (`0` = forever); Pro cloud sync keeps all drafts |
| `shiplogue.history.maxEntries` | `50` | Max drafts in the local history log |
| `shiplogue.feedback.enabled` | `true` | Allow the once-per-version feedback/star prompt |
| `shiplogue.feedback.promptAfter` | `3` | Successful drafts before the feedback prompt |

All settings are in the editor's Settings UI under **Shiplogue**.

## Troubleshooting

- **Ollama isn't running** — start it (`ollama serve` or `brew services start
  ollama`) and check `shiplogue.ollama.url`.
- **Provider key fails** — run **Shiplogue: Test Provider**; then replace the key
  with **Shiplogue: Set API Key**.
- **Draft empty or cut off** — raise `shiplogue.ollama.numPredict` (e.g. 4096) or
  use a non-reasoning model such as `llama3.2`.
- **No activity** — commit or save work; the daily window starts at local midnight.

## Updates

Marketplace and Open VSX installs update with the editor's normal auto-update.
Manual VSIX installs have no update channel, so Shiplogue checks both listings at
startup and shows a notice once per version with **Update now**, **Open listing**
and **Enable auto-update**. Run **Shiplogue: Check for Update** any time.

## Links

- **Website:** [shiplogue.dev](https://shiplogue.dev)
- **Docs:** [docs.shiplogue.dev](https://docs.shiplogue.dev)
- **Marketplace:** [phenzic.shiplogue](https://marketplace.visualstudio.com/items?itemName=phenzic.shiplogue)
- **Open VSX:** [phenzic/shiplogue](https://open-vsx.org/extension/phenzic/shiplogue)
- **Changelog:** [CHANGELOG.md](https://github.com/Phenzic/shiplogue/blob/main/extension/CHANGELOG.md)
- **Issues:** [github.com/Phenzic/shiplogue/issues](https://github.com/Phenzic/shiplogue/issues)

## License

MIT — see [LICENSE](https://github.com/Phenzic/shiplogue/blob/main/LICENSE).
