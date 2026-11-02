# Shiplogue — Implementation Plan 3 (quick wins, cloud, feedback, shortcut)

> Status: proposed 2026-11-01. Builds on `extension/IMPLEMENTATION_PLAN_2.md` (rev 4) and
> `ARCHITECTURE.md`. This plan covers the next independent work that does **not** depend on
> the Marketplace publisher account or the CI billing lock.
>
> **Implemented in this pass:** Q1 (generate shortcut + Configure Shortcut command) and the
> `0.1.3` changelog entry. Everything else below is planned.
>
> Naming note: MCP/plugin work is rebranded from Standup to **Shiplogue** here. This plan
> supersedes Plan 2 Track M's `standup-*` package/env/plugin names.
>
> **Superseded:** Section 2 (“Phase 1 — MCP server and Claude Code plugin”) is replaced by
> `IMPLEMENTATION_PLAN_4.md` and `ARCHITECTURE.md` rev 2. The agent product is broader than MCP:
> it captures agent activity via hooks, stores events locally, renders drafts, syncs with the
> extension/cloud, and exposes MCP as one interface. Keep Section 1 (quick wins) and Section 3
> (cloud web/docs/API) from this plan.

## 0. Builder protocol

- One chunk per run. Read the chunk's **Read first** files before editing.
- Main repo: extension + MCP share `extension/src/core`; no runtime package.
- Cloud work happens in a **new repo** `Phenzic/shiplogue-cloud` (local dir `shiplogue-cloud/`
  first). Do not mix cloud commits into the extension repo.
- After extension changes: `npx tsc -p ./ --noEmit`, `npm test` (current baseline
  **184 pass / 0 fail / 10 skipped, 194 tests** after Q1).
- After cloud changes: `pnpm -r typecheck && pnpm -r test && pnpm -r build`.
- Update `CHANGELOG.md` for user-visible changes. Q1 landed in `0.1.3`; new work goes under
  `[Unreleased]` until the next version. Do not create a new
  `RELEASE_NOTES_*.md`; the changelog section is reused for GitHub + Marketplace.
- No secrets in code, logs, tests, screenshots or docs. No telemetry by default.

---

## 1. Phase 0 — quick wins (extension, no publish dependency)

### Q1 — Generate shortcut + Configure Shortcut command (0.5 day) — ✅ done 2026-11-01

**Read first:** `extension/package.json`, `extension/src/extension.ts`,
`extension/test/vscode-stub.js`, `extension/test/integration.activate.test.js`.

**Files:** `extension/package.json`, `extension/src/commands/shortcuts.ts` (new),
`extension/src/extension.ts`, `extension/README.md`, `extension/CHANGELOG.md`,
`extension/test/shortcuts.test.js` (new), `extension/test/integration.activate.test.js`.

**Keybinding contribution:**

```json
"keybindings": [
  {
    "command": "shiplogue.generate",
    "key": "ctrl+alt+shift+g",
    "mac": "cmd+alt+shift+g",
    "when": "!terminalFocus"
  }
]
```

**Command contribution:** `shiplogue.configureShortcut` — "Shiplogue: Configure Keyboard
Shortcut".

**Implementation:**

```ts
// src/commands/shortcuts.ts
import * as vscode from "vscode";
export async function configureShortcut(): Promise<void> {
  // VS Code accepts a filter string; this opens the editor filtered to the command.
  await vscode.commands.executeCommand(
    "workbench.action.openGlobalKeybindings",
    "shiplogue.generate",
  );
}
```

- Register in `activate()` next to the other commands.
- Extend `test/vscode-stub.js`:
  - add `executedCommands: []` to the stub + reset;
  - in `executeCommand`, push `{ id, args }`; for unregistered `workbench.*` commands,
    resolve instead of rejecting.
- Update the integration command-registry assertion to include `shiplogue.configureShortcut`.
- New test: invoking the command records
  `workbench.action.openGlobalKeybindings` with `"shiplogue.generate"`.
- README section "Keyboard shortcut": the chord, how to rebind, and the warning that a keymap
  extension may already use it.
- CHANGELOG `0.1.3` entry (done).

**Acceptance:** F5 → `Cmd/Ctrl+Alt+Shift+G` opens the panel and generates; command appears in
the palette; Configure Shortcut opens the filtered editor; tests pass; no default-keybinding
conflict (documented).

### Q2 — Feedback loop (1–1.5 days)

**Read first:** `src/state.ts`, `src/extension.ts`, `src/shiploguePanel.ts`,
`test/vscode-stub.js`, `test/panel.test.js`, `test/integration.activate.test.js`.

**Files:** `src/feedback.ts` (new), `src/state.ts`, `src/extension.ts`,
`src/shiploguePanel.ts`, `package.json`, `README.md`, `PRIVACY.md`, `CHANGELOG.md`,
`test/feedback.test.js` (new), `test/panel.test.js`.

**Settings:** `shiplogue.feedback.enabled` (default true),
`shiplogue.feedback.promptAfter` (default 3).

**State keys:** `successfulDrafts`, `feedbackPromptedVersion`, `feedbackSnoozedUntil`,
`feedbackOptOut`, `lastRating`, `starPromptedVersion`.

**Panel:** add 👍/👎 buttons next to Copy/Send (hidden while loading; reset per draft). On click,
post `{ kind: "feedback", value: "up" | "down" }`; the extension records it. Never send draft
content.

**Extension flow:**

- `recordSuccess()` increments `successfulDrafts` and, if enabled and not opted out and
  `successfulDrafts >= promptAfter` and not prompted for this version, show a non-modal
  `showInformationMessage`:
  - Title: `How's Shiplogue working for you?`
  - Actions: `Share feedback` (opens the form), `Not now` (snooze 30 days),
    `Don't ask again` (opt out).
- 👎 opens the feedback form with `version`, `os`, `backend` only; no activity text.
- 👍 increments `lastRating`; if `starPromptedVersion !== currentVersion`, show once:
  `If Shiplogue saved you time, a star helps others find it.` with `Star on GitHub`,
  `Rate on Marketplace`, `Not now`.
- Commands: `shiplogue.feedback`, `shiplogue.star`, `shiplogue.rate`.
- Form/vendor constant in `feedback.ts` (Tally or Google Form; URL TBD); GitHub
  `https://github.com/Phenzic/shiplogue`; Marketplace review
  `https://marketplace.visualstudio.com/items?itemName=phenzic.shiplogue&ssr=false#review-details`.

**Tests:** counter increments only on successful generation; prompt once per version; snooze
suppresses; opt-out permanent; thumbs message round-trip; commands open the right URLs; no
prompt on error/cancel/first run; no activity content in URLs.

**Acceptance:** 3 successes trigger one prompt in a dev host; 👎 opens the form; 👍 can trigger
one star prompt; dismissal persists; zero network calls besides opening URLs.

### T1 — Multi-target posting: Slack + Discord + Teams (2 days)

**Read first:** `src/post.ts`, `src/config.ts`, `package.json`, `test/post.test.js`,
`MANUAL_QA.md`.

**Files:** `src/post.ts`, `src/config.ts`, `package.json`, `README.md`,
`src/shiploguePanel.ts`, `test/post.test.js`, `CHANGELOG.md`.

- Add `teams` as a target type and replace the single-target model with
  `shiplogue.posting.targets`:
  ```jsonc
  [{ "type": "slack",  "url": "https://hooks.slack.com/...", "enabled": true },
   { "type": "discord","url": "https://discord.com/api/webhooks/...", "enabled": true },
   { "type": "teams",  "url": "https://...powerplatform.com/...", "enabled": true }]
  ```
  Keep `shiplogue.webhook.type/url` as a legacy fallback when `targets` is empty; document the
  migration and add a one-time settings rewrite on activation if the old pair is set.
- Post to **all enabled targets**; isolate failures: a failed Slack post must not prevent
  Discord/Teams; return per-target `{ type, ok, status, error? }`.
- Teams payload: `message` with an Adaptive Card attachment
  (`application/vnd.microsoft.card.adaptive`, version 1.4, wrapped TextBlock) — Teams
  Workflows webhooks, not the retired Office 365 connectors.
- Slack conversion and Discord split stay per-target; caps and error bodies redacted.
- Panel: Send label shows the number of targets; result notification lists successes/failures.
- Auto-post later reuses the same target list and dedupes per target.
- Tests: 3-target success; one target 500 → others still post; Teams card shape; long text;
  legacy migration; no secret in errors.

**Acceptance:** a single Send reaches all three enabled targets; partial failure is reported
per target; real Teams Workflows webhook verified if available; Slack/Discord snapshots unchanged
apart from the new target list.

---

## 2. Phase 1 — MCP server and Claude Code plugin

### M0 — Extract the pure core (1.5 days)

**Read first:** `src/summarize.ts`, `src/gather.ts`, `src/format.ts`, `src/core/providers/*`,
`src/model/*`, tests.

**Files:** `extension/src/core/{types,prompt,grounding,format,budget}.ts`,
`extension/src/core/gather/{git,github,cursor,activity}.ts`; update extension imports.
`mcp/tsconfig.json` includes `../extension/src/core/**/*.ts`.

- Move pure logic out of `vscode`-coupled files:
  - prompt builder takes `{ detail, tone, format }`;
  - grounding/format/budget are data-in/data-out;
  - git takes a folder list;
  - GitHub takes a token + repos;
  - Cursor takes a DB path + allowed folders.
- Extension adapters supply `vscode.workspace.workspaceFolders`, SecretStorage token, tracker
  store. Behavior must be byte-identical.
- Add core tests: temp git repo, synthetic Cursor DB, mock provider.

**Acceptance:** all extension tests pass unchanged; no `vscode` import under `src/core`;
`summarize`/`gather` output byte-identical for the same inputs.

### M1 — `@phenzic/shiplogue-mcp` (2–3 days)

**Read first:** `ARCHITECTURE.md` §7; Plan 2 §6 M1 (updated names).

**Files:** `mcp/package.json`, `mcp/tsconfig.json`, `mcp/src/index.ts`,
`mcp/src/config.ts`, `mcp/src/tools/*.ts`, `mcp/src/resources.ts`, `mcp/src/prompts.ts`,
`mcp/test/*.test.mjs`.

- `serveStdio(() => createServer(config))`; `@modelcontextprotocol/server` v2, Zod v4, Node ≥20,
  ESM.
- Tools:
  - `get_activity`: lookback 1–168 (default 24), repoPath (default cwd), includeGitHub,
    includeCursor → text + JSON summary; annotations `{ readOnlyHint: true }`.
  - `generate_standup`: detail/tone/format/lookback/repoPath → markdown + warnings; BYOK/Ollama;
    clear "no provider configured" error.
- Resource `shiplogue://activity/today`; prompt `shiplogue-daily`.
- Config: CLI > env (`SHIPLOGUE_*`, `GITHUB_TOKEN`) > `~/.shiplogue/config.json` (0600) >
  defaults. Never print values.
- No local 4B engine; no posting tool.
- Tests: in-memory MCP client lists tools/calls them in a temp repo; mock provider; redaction;
  no-provider error.

**Acceptance:** `npx -y @phenzic/shiplogue-mcp` starts, lists tools, returns activity with no
VS Code; secrets never printed.

### M2 — Claude Code plugin (1–2 days)

**Files:** `.claude-plugin/marketplace.json`, `plugins/shiplogue/.claude-plugin/plugin.json`,
`.mcp.json`, `skills/daily/SKILL.md`, optional `commands/daily.md`.

- `plugin.json`: name `shiplogue`, version, description, author, license, repository,
  homepage; `userConfig` strict objects (provider options, sensitive `api_key`, model,
  base_url, lookback, detail, tone); `.mcp.json` launches npx with `${user_config.*}` env.
- Skill instructs: call `get_activity`, write the stand-up with the template/rules, mark
  inferred Next items, no invented specifics. No key path.
- Marketplace `Phenzic/shiplogue`, plugin source `./plugins/shiplogue`.
- Install: `claude plugin marketplace add Phenzic/shiplogue` →
  `claude plugin install shiplogue@shiplogue` → `/shiplogue:daily`.
- Validate with `claude plugin validate`.

**Acceptance:** `/shiplogue:daily` produces a draft from real commits with no key; BYOK works;
key never in plaintext settings; validation passes.

### M3 — Hosts + extension bridge (1–2 days)

- `shiplogue-mcp print-config --host cursor|vscode|claude-code|claude-desktop|codex|gemini`
  prints snippets without secrets.
- Docs for each host config location; verify at build.
- Extension command `shiplogue.mcpSetup`: QuickPick host → copy snippet / open docs; never copy
  a stored key.
- README panel section "Use with Claude Code".

**Acceptance:** each snippet connects; `get_activity` returns data; command writes nothing
without consent.

### M4 — Distribution/security (1–2 days)

- npm publish `@phenzic/shiplogue-mcp` with provenance (`--access public`).
- Plugin/marketplace install/update/uninstall docs.
- Security review: read-only tool, path restriction, no arbitrary file read, no posting, keys
  only from env/userConfig, redaction tests, no telemetry.
- CI: MCP tests, plugin validation, package smoke test, secret scan.
- Docs: privacy/data flow, troubleshooting, no-key path.

**Acceptance:** fresh machine install works; no secret leaks; docs verified.

---

## 3. Phase 2 — cloud repo (web, docs, API)

### C0 — Scaffold + contracts (1 day)

**New repo:** `shiplogue-cloud/` (private), pnpm workspaces.

```
apps/web · apps/docs · apps/api · packages/contracts · packages/ui · infra/
```

- TypeScript strict; Node 22; pnpm.
- `packages/contracts`: Zod schemas for Activity, GenerateRequest/Response, Auth, Entitlements,
  Billing, Draft.
- CI: typecheck/test/build; Cloudflare deploy configs.
- Local dev: `pnpm dev` runs web/docs/api with local D1.

**Acceptance:** `pnpm -r build` passes; API `/health` responds; contracts imported by all apps.

### W0 — Web + docs scaffold with design (2–3 days)

**Input needed:** design file in `design/README.md` + `design/screens/`; map tokens to CSS
variables/Tailwind. Do not invent final visuals.

- Astro + Tailwind web app: layout, nav, footer, landing, pricing, features, MCP, changelog,
  login/account placeholders, privacy/terms/security/support.
- Astro Starlight docs app: sidebar, search, MDX, getting started + integrations + privacy +
  troubleshooting stubs.
- SEO/OG, responsive, accessibility, cookieless analytics.
- Deploy previews to Cloudflare Pages.

**Acceptance:** pages build and deploy; Lighthouse ≥90; mobile layout; docs search works.

### A0 — API skeleton + auth (2–3 days)

- Hono Worker; `/health`; D1 migrations for users/devices/magic_links/sessions.
- Device-code flow + magic-link web login; JWT (15 min) + refresh (30 days, rotated);
  `GET /v1/me`.
- Resend integration (dev logs only); rate limits; request IDs; tests with Miniflare/mocks.

**Acceptance:** local device flow signs in; token expiry/refresh/revocation tested; no secrets
logged.

### A1 — Billing + entitlements (2–3 days)

- Polar/Creem checkout + portal; webhook signature verification + idempotency.
- `subscriptions`/`entitlements`; plan gating middleware; cancel/downgrade.
- Test-mode purchase → Pro; webhook replay safe; portal link.

### A2 — Hosted generation + metering (3 days)

- `/v1/standups`; provider adapters (Haiku/GPT class); prompt version; quota/rate limit;
  `usage_events`/`monthly_usage`; error taxonomy; fallback signals.
- No raw prompt/diff storage by default; request IDs; tests with a mock provider.

### E1 — Extension hosted backend (2–3 days)

- `HostedBackend`; account command (device login); token in SecretStorage; data-flow preview;
  cloud-off toggle; automatic local fallback; panel badge; tests.
- No secrets in settings/logs.

### P1 — Extension auto-post (2 days)

- Settings `shiplogue.autoPost.*`; scheduler; dedupe; retry; review/auto; Teams target.
- Tests: fake timers, DST, day rollover, duplicate prevention, failure notification.

### P2 — API auto-post (3 days)

- `drafts` table; encrypted final draft; 24 h retention; Cron/DO alarm; idempotent posting;
  cancel; timezone; failure email; tests.

### W1 — Account/usage pages (2 days)

- Login, plan, usage chart, portal, delete account; free/Pro/past-due states.

### D1 — Docs content (2–3 days)

- Getting started, models, panel, posting, GitHub, Cursor, MCP, account/billing, privacy,
  troubleshooting, changelog. Link from extension README.

### R1 — Release/changelog (0.5 day)

- Fold `[Unreleased]` into the next version; use the same section for GitHub and Marketplace;
  verify links; no separate release-note file.

---

## 4. Keybinding verification record

**Candidate:** `Cmd+Alt+Shift+G` / `Ctrl+Alt+Shift+G`.

| Evidence | Finding |
|---|---|
| VS Code 1.95 default keybindings dump (macOS 1,078 rules) | 0 hits for `cmd+alt+shift+g` |
| Same dump (Windows 993, Linux 984) | 0 hits for `ctrl+alt+shift+g` |
| Official default keybindings reference | 0 hits for the chord |
| JetBrains keymap | `Ctrl+Alt+Shift+S` = Project Structure → avoid S; no G evidence |
| Common conflicts | `Cmd+G` find-next, `Cmd+Shift+G` find-previous/source control — different chord |

**Verdict:** safe default in stock VS Code/Cursor; residual risk from third-party keymaps and
OS-level shortcuts. Final acceptance: Keyboard Shortcuts → filter `@command:shiplogue.generate`
→ press the chord → Developer: Toggle Keyboard Shortcuts Troubleshooting → confirm one match.
If a user has a conflict, Configure Shortcut lets them rebind.

---

## 5. Feedback recommendation (implementation summary)

Do **not** show a modal on startup. Use:

1. Panel 👍/👎 after a draft (low friction, contextual).
2. 👎 opens a short form with version/OS/backend only.
3. One prompt after 3 successful drafts, once per version: Share feedback / Not now /
   Don't ask again.
4. After a 👍, once per version: Star on GitHub / Rate on Marketplace / Not now.
5. Commands for explicit feedback/star/rate.
6. Passive: GitHub issue forms, Discussions, README feedback, Marketplace Q&A.

No telemetry. No activity content. No gating. Full implementation is Q2.

---

## 6. Sequencing

```
Q1 (0.5d) → Q2 (1–1.5d) → T1 (1d)
M0 (1.5d) → M1 (2–3d) → M2 (1–2d) → M3 (1–2d) → M4 (1–2d)
C0 (1d) → A0 (2–3d) → A1 (2–3d) → A2 (3d) → E1 (2–3d)
W0 (2–3d, design-gated) → W1 (2d) → D1 (2–3d)
P1 (2d) → P2 (3d)
R1 (0.5d)
```

Parallelizable: M-track with C0/A0; W0 with A0; P1 with A1. P2 after A1/A2.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Shortcut conflicts with keymaps/OS | Verified defaults, Configure Shortcut, docs, `when: !terminalFocus` |
| Feedback prompts annoy | Value trigger, once/version, snooze/opt-out, no startup modal |
| MCP supply chain | provenance, pinned deps, read-only tool, no secrets, security review |
| Cloud/extension contract drift | `packages/contracts`, contract tests, versioned API |
| Auto-post duplicates/DST | per-day/per-target marker, idempotency, fake timers, stored timezone |
| Teams payload rejected | Workflows Adaptive Card, live test, error body |
| Design missing | Block visual W0; neutral scaffold; no invented visuals |
| Branding drift | Shiplogue names everywhere; grep user-facing `standup` before publish |

## 8. Acceptance checklist

- [ ] Q1 shortcut + Configure Shortcut + README + `0.1.3` changelog + tests.
- [ ] Q2 feedback: thumbs, one prompt/version, snooze/opt-out, commands, no activity in URLs.
- [ ] T1 Teams Adaptive Card verified.
- [ ] M0 core has no `vscode` imports; extension tests unchanged.
- [ ] M1/M2 `npx -y @phenzic/shiplogue-mcp` + `/shiplogue:daily` no-key path.
- [ ] C0/W0/A0 cloud builds, previews, health/auth.
- [ ] A1/A2/E1 test purchase + hosted generation + local fallback.
- [ ] P1/P2 one post/day/target, DST, failure notification.
- [ ] D1/R1 docs + single changelog section reused.
