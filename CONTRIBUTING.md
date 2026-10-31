# Contributing to Standup

Thanks for taking a look. Standup is an early-stage, local-first VS Code-compatible
extension, and the most useful contributions right now are bug reports, model
quality feedback and editor compatibility reports.

## Ways to help

- **Report a bug** with your editor and version (VS Code, Cursor, Antigravity,
  VSCodium, Windsurf, …), OS, model backend, and the smallest steps to reproduce.
- **Report model quality** — especially invented specifics, missed commits, or
  drafts that needed heavy editing. Include the debug context from
  *Standup: Show Tracked Activity (debug)* with anything sensitive removed.
- **Test another editor** — VS Code-compatible forks are a target, but only some
  have been exercised in a real host.
- **Improve docs, tests or the extension** — see the checklist below.
- **Suggest a model** for the planned bundled quantized backend (size, license,
  quality on stand-up prompts).

## Before you start

- Read the [project README](README.md) and the
  [extension README](extension/README.md).
- For a large change, open an issue first so we can agree on scope.
- Please do not include tokens, private repository names, commit messages or
  activity logs from someone else in an issue or PR.

## Development setup

Requirements: Node 20+, npm, git. A VS Code-compatible editor for the F5 flow.
Ollama (or a provider API key) and `sqlite3` are only needed for the corresponding
features/tests.

```bash
git clone https://github.com/Phenzic/standup.git
cd standup/extension
npm install
npm run compile
npm test
```

Press **F5** in VS Code or Cursor to launch the Extension Development Host.
`npm run watch` recompiles on change.

## Repository layout

```text
README.md               project overview
CONTRIBUTING.md         this file
LICENSE                 MIT
extension/              the VS Code/Cursor extension
  package.json          manifest, commands, settings, scripts
  src/                  TypeScript source
    config.ts           typed settings reader
    tracker.ts          save/edit events
    store.ts            per-day activity log, retention
    gather.ts           collection, caps, context rendering
    paths.ts            cross-platform path normalization
    git.ts              commit collection
    github.ts           PR/issue collection
    cursor.ts           Cursor chat DB reader + workspace scoping
    summarize.ts        prompts, model call, retry/repair/grounding
    format.ts           sublists, references, grounding, Slack mrkdwn
    standupPanel.ts     webview panel and message handling
    post.ts             Discord/Slack webhooks
    reminder.ts         daily reminder
    state.ts            global state (detail/tone/reminder markers)
    types.ts            shared data shapes
    extension.ts        activation, commands, orchestration
    commands/           BYOK setup / clear / test commands
    core/providers/     pure provider adapters (no vscode imports)
    model/              backend selection (Ollama, provider, secrets)
  test/                 Node test suite (stubbed vscode, mock servers, temp repos)
  out/                  compiled output (generated, not committed)
```

## Tests

```bash
npm test             # compile + default suite (no model or network needed)
npm run test:e2e     # gated real-Ollama suite; run sequentially
npm run test:cursor  # gated read-only Cursor DB suite
```

The default suite uses Node's built-in test runner. It stubs the `vscode` API,
starts local mock Ollama/webhook servers, creates temporary git repos and
synthetic SQLite databases. Real-model and real-Cursor-DB suites skip unless
their environment variables are set:

- `STANDUP_E2E=1` for the real-Ollama tests.
- `STANDUP_OLLAMA_MODEL=<name>` to choose a model.
- `CURSOR_REAL_DB=1` for the real Cursor database checks.

Real-model tests must run with `--test-concurrency=1`; parallel files contend on
one Ollama instance, which causes very slow runs and fetch failures.

## Code conventions

- TypeScript strict mode; keep modules small and single-purpose.
- **No runtime npm dependencies.** The extension runs with the editor's bundled
  Node runtime; dev dependencies are fine.
- User-facing failures should produce actionable messages (`OllamaError`,
  `ProviderError`/`BackendError`, or `panel.setError`). Background collectors must
  never throw — log and degrade to an empty result.
- Keep privacy properties intact: activity stays local, Cursor's DB is opened
  read-only, and nothing is posted without an explicit user action.
- Add a comment explaining *why* for non-obvious code, not *what*.

## Adding a setting

Settings are read through `src/config.ts`. A new setting must be added in three
places:

1. `src/config.ts` (the typed accessor),
2. `package.json` → `contributes.configuration`,
3. the extension README settings table.

Add a test for the behavior the setting controls. If the setting affects the
prompt, update the prompt tests and any grounding/context tests.

## Pull requests

- Fork and branch from `main`; keep commits focused.
- Run `npm test` and `npx tsc -p extension --noEmit` before opening the PR.
- Describe the user-visible behavior, the tests added, and any privacy or
  compatibility implications.
- Do not commit generated output (`out/`), VSIX files, activity logs, editor
  state or local marketing drafts.
- By contributing you agree that your contribution is licensed under the
  repository's MIT license.

## Licensing and commercial plans

The extension is MIT-licensed. Planned paid plans cover hosted inference,
scheduled posting and enterprise deployment; the hosted service is a separate
component and its code may remain private. Do not add paid-service credentials,
billing logic or private API secrets to this repository.

## Questions

Open an issue with the `question` label. For security-sensitive reports, avoid
public details until a private channel is arranged.
