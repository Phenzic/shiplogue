# Shiplogue

**Your daily stand-up, drafted from the work you actually did.**

[![Marketplace](https://img.shields.io/badge/Marketplace-Shiplogue-1e3a5f.svg)](https://marketplace.visualstudio.com/items?itemName=phenzic.shiplogue)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-Shiplogue-6b4fbb.svg)](https://open-vsx.org/extension/phenzic/shiplogue)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Phenzic/shiplogue/blob/main/LICENSE)
[![Website](https://img.shields.io/badge/website-shiplogue.dev-1e3a5f.svg)](https://shiplogue.dev)

Shiplogue turns your real work — commits, changed files, GitHub PRs and issues,
and your AI chat context — into a review-ready stand-up. It runs with a local
Ollama model or your own API key, and never sends your activity anywhere unless
you choose a cloud model.

## What it does

- **Writes the first draft for you.** Yesterday / Today / Next / Blockers, in
  plain English, grouped from the work you actually did.
- **Uses your evidence.** Git commits and changed files, saved files, merged PRs,
  closed issues, and AI prompts from Cursor, Copilot or Antigravity where available.
- **Keeps you in control.** Review, edit and copy the draft. Nothing is posted.
- **Keeps your data local by default.** Ollama runs on your machine; API keys live
  in the OS keychain; private and `.gitignore`d paths are never recorded.

## Features

| Feature | What you get |
| --- | --- |
| **Real activity** | Commits, file saves, PRs/issues and AI prompts, scoped to the open workspace. |
| **Useful format** | Fixed Yesterday / Today / Next / Blockers; 3+ files become sub-bullets. Paid workspaces can relabel/reorder the sections. |
| **Three detail levels** | Concise (3–4 points), Standard (5–7), Elaborate (6–9). |
| **Four tones** | Neutral, Junior, Mid, Senior. |
| **Two model options** | Local Ollama, or BYOK for Anthropic, OpenAI, Google or any OpenAI-compatible endpoint. |
| **Review panel** | Rendered preview (or raw Markdown / Plain text), a verification strip (claims checked, removed, inferred, needs-review highlights), one-click Copy, Regenerate, Cancel, and inline Detail/Tone. |
| **Draft history** | A searchable History tab in the panel: every draft with its model, detail/tone, verification state and send status; preview, copy or restore any of them. |
| **Local history** | Every draft is kept on-device for 7 days; **Shiplogue: Open Stand-up History** shows the last week, and yesterday's reviewed copy feeds the next Yesterday section. |
| **Daily reminder** | A local-time nudge, with Generate now / Snooze 1h. |
| **Shortcut** | `Cmd+Shift+'` (macOS) / `Ctrl+Shift+'` (Windows/Linux). Rebind from the Command Palette. |
| **Cloud sync (optional)** | Connect a connector key to sync generated stand-ups to your private Shiplogue dashboard; copying a reviewed draft upserts the final text. |
| **Send via Shiplogue Cloud (Pro)** | From the panel or history, ask Shiplogue Cloud to post your stand-up to the targets you configured in the dashboard (Slack/Discord/Teams). Scheduled auto-posting also runs cloud-side. The extension never talks to a webhook directly. |
| **Feedback & rating** | One question per version after a few drafts, a 👍-triggered GitHub star nudge, and Share Feedback / Star / Rate commands. |

The built-in format is fixed. Custom section labels/order are a paid-plan option delivered from the cloud; free plans always get Yesterday / Today / Next / Blockers.

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
- **From source:** see [Development](#development).

## Quick start

1. Pick a model:
   - **Ollama** — install [Ollama](https://ollama.com), then `ollama pull llama3.2`.
   - **Your own key** — run **Shiplogue: Set API Key**, pick a provider and model.
2. Open a project with today's work.
3. Press `Cmd+Shift+'` / `Ctrl+Shift+'` or run **Shiplogue: Generate Today's Update**.
4. Review and edit, then **Copy**.

## Cloud sync (optional)

Shiplogue can sync a generated stand-up to your private Shiplogue workspace so it
appears on the dashboard and counts toward your team's history. It is **off until
you connect a key**; local generation, Ollama, BYOK and local activity storage keep
working without an account.

1. Sign in at [shiplogue.dev](https://shiplogue.dev), create a connector key, and
   copy it (it is shown once).
2. In VS Code, run **Shiplogue: Connect Cloud** and paste the key.
3. Generate a stand-up as usual. The draft is synced with the current date.

Each open project is a separate local workspace. Generation scopes to the active
project, and synced drafts keep the project name plus their IDE/agent source tags
so the dashboard can group and label them. Every Friday evening (18:00 local by
default) Shiplogue compiles the stored daily drafts into a weekly recap, adds it
to draft history, and prompts you to view it. Change the day/time with
`shiplogue.weeklyRecap.day` and `shiplogue.weeklyRecap.time`; run
**Shiplogue: Generate Weekly Recap Now** to do it immediately.

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
- No telemetry by default. Anonymous product metadata is opt-in, requires a connector key, and never includes stand-up text, prompts, paths, repositories, or errors. Cloud sync is optional and inactive until you connect a key; local generation works without an account. This build stores a draft, but does not post it anywhere.

Full details: [PRIVACY.md](https://github.com/Phenzic/shiplogue/blob/main/extension/PRIVACY.md).

## Common settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `shiplogue.lookbackHours` | `24` | How far back to gather activity |
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
- **No activity** — commit or save work, or raise `shiplogue.lookbackHours`.

## Updates

Marketplace and Open VSX installs update with the editor's normal auto-update.
Manual VSIX installs have no update channel, so Shiplogue checks both listings at
startup and shows a notice once per version with **Update now**, **Open listing**
and **Enable auto-update**. Run **Shiplogue: Check for Update** any time.

## Development

```bash
cd extension
npm install
npm run compile      # or: npm run watch
npm test             # compile + tests
npm run test:e2e     # gated real-Ollama tests
```

Press **F5** in VS Code/Cursor/Antigravity to launch the Extension Development
Host. See [CONTRIBUTING.md](https://github.com/Phenzic/shiplogue/blob/main/CONTRIBUTING.md).

## Links

- **Website:** [shiplogue.dev](https://shiplogue.dev)
- **Docs:** [docs.shiplogue.dev](https://docs.shiplogue.dev)
- **Marketplace:** [phenzic.shiplogue](https://marketplace.visualstudio.com/items?itemName=phenzic.shiplogue)
- **Open VSX:** [phenzic/shiplogue](https://open-vsx.org/extension/phenzic/shiplogue)
- **Changelog:** [CHANGELOG.md](https://github.com/Phenzic/shiplogue/blob/main/extension/CHANGELOG.md)
- **Issues:** [github.com/Phenzic/shiplogue/issues](https://github.com/Phenzic/shiplogue/issues)

## License

MIT — see [LICENSE](https://github.com/Phenzic/shiplogue/blob/main/LICENSE).
