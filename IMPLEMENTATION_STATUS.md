# Implementation Status — Shiplogue: shortcut, feedback, Plan-2 completion, agent kickstart, auto-post

> Started 2026-11-01. Tracks work guided by `IMPLEMENTATION_PLAN_3.md`,
> `IMPLEMENTATION_PLAN_4.md` and `extension/IMPLEMENTATION_PLAN_2.md` (rev 4).
> Previous ledgers: `extension/IMPLEMENTATION_STATUS.md` (0.1.x), `extension/IMPLEMENTATION_STATUS_0.1.0.md`.

## Baseline (verified 2026-11-01)

- Extension `shiplogue@0.1.3`, publisher `phenzic`.
- `npm test`: **184 pass / 0 fail / 10 skipped / 194 total**; runner recurses `test/**/*.test.js`.
- Q1 shortcut exists as `cmd+alt+shift+g` (plan 3) — **user override: change to `cmd+shift+J`** (win/linux `ctrl+shift+j`).
- BYOK (S4/R5.5) done; `src/model/*` registry exists (R1 done); `src/core/providers/*` pure.

## Scope decisions (user directives, 2026-11-01)

1. Keybinding → `cmd+shift+J` / `ctrl+shift+j` (user may rebind later; Configure Shortcut command retained).
2. Feedback = Plan 3 Q2 as designed. **Form URL**: plan leaves it TBD (Tally/Google Form); no form exists yet →
   single constant `FEEDBACK_FORM_URL` in `src/feedback.ts`, defaulting to the GitHub feedback issue page
   (works today); swap when a Tally/Google form exists.
3. "Complete Plan 2" = the code-completable remainder: **R0, R6, R7**. R1.5 (native-engine spike) needs a
   manual clean-profile VSIX install + 2.7 GB model download → stays gated/manual. S2 (clean-profile F5)
   is a manual QA item. R2–R5/R8–R10 stay blocked behind R1.5.
4. Agent kickstart = Plan 4 **A0 + A1** (pure core extraction + `agent/` scaffold; event schema/store/redaction/dedupe).
5. Auto-post = extension-side scheduler (Plan 2 §7.7 Phase 1 / Plan 3 P1) with a **mock Pro entitlement**
   (stub provider, always-Pro, clearly marked) until billing exists. Built on T1's multi-target posting.
6. GitHub Actions billing resolved — workflows already committed; CI runs on next push.

## Chunk ledger

| Chunk | Scope | Status | Tests | Result | Outstanding |
| --- | --- | --- | --- | --- | --- |
| KEY | Shortcut `cmd+shift+J` | ✅ done | `npm test` 184/184 | chord + mac variant + when-clause updated; shortcuts.test updated; README + CHANGELOG | user may rebind via Configure Shortcut |
| Q2 | Feedback loop | ✅ done (2026-11-01) | `npm test` 197/197 (207 total) | thumbs in panel, once-per-version prompt, snooze/opt-out, star/rate prompt, 3 commands, README/PRIVACY docs | `FEEDBACK_FORM_URL` = GitHub issues placeholder until a Tally/Google form exists |

### Q2 — changes made

- `src/feedback.ts` (new): URL constants (`FEEDBACK_FORM_URL`, `GITHUB_REPO_URL`, `MARKETPLACE_REVIEW_URL`), `feedbackFormUrl({version, backend})` (adds os; never activity text), `Feedback` class (`recordSuccess` prompt state machine; `recordThumbs`).
- `src/state.ts`: `successfulDrafts`, `feedbackPromptedVersion`, `feedbackSnoozedUntil`, `feedbackOptOut`, `lastRating`, `starPromptedVersion`.
- `src/config.ts` + `package.json`: `shiplogue.feedback.enabled` (true), `shiplogue.feedback.promptAfter` (3); commands `shiplogue.feedback`/`shiplogue.star`/`shiplogue.rate`.
- `src/extension.ts`: feedback instance; commands registered; `recordSuccess` after a successful draft (fire-and-forget); thumbs routed via panel callback.
- `src/shiploguePanel.ts`: 👍/👎 buttons next to Copy/Send — hidden while loading, reset per draft, post `{kind:"feedback", value, backend}`.
- `test/feedback.test.js` (new, 10 tests); `test/panel.test.js` thumbs + routing tests; integration command list updated; `helpers.makeContext` gains `extension.packageJSON.version`.
- README "Feedback & rating" section; PRIVACY "Feedback" section; CHANGELOG `[Unreleased]`.
| T1 | Multi-target posting | ✅ done (2026-11-01) | `npm test` 204/204 (214 total) | Slack+Discord+Teams targets, per-target isolation, legacy migration, Teams Adaptive Card | real Teams Workflows webhook check is manual (MANUAL_QA) |

### T1 — changes made

- `src/post.ts`: `PostTarget`/`TargetResult`; `effectiveTargets()` (posting.targets wins, legacy webhook.type/url fallback, invalid entries filtered); `postToWebhook(text, markdown?)` posts to all enabled targets with isolated per-target results; Teams Workflows Adaptive Card payload; Discord split per target; errors never include URLs or response bodies.
- `src/config.ts` + `package.json`: `shiplogue.posting.targets` setting (array of {type,url,enabled}, machine scope).
- `src/state.ts` + `src/extension.ts`: one-time legacy → `posting.targets` migration on activation (`postingMigrated` flag).
- `src/shiploguePanel.ts`: Send label shows "N targets" / single type; result notification lists per-target successes/failures; clipboard fallback on Discord truncation.
- Tests: 3-target success, failure isolation (+ no URL/secret in errors), disabled/malformed filtering, legacy fallback precedence, migration once-only (integration), Send label counts.
- README "Posting" rewritten for multi-target + Teams; CHANGELOG `[Unreleased]`.
| P1 | Auto-post (mock Pro) | ✅ done (2026-11-01) | `npm test` 213/213 (223 total) | scheduler, review/auto modes, 60s undo, per-day+per-target dedupe, 3× backoff retry, draft recovery | entitlement = `src/entitlements.ts` stub (always Pro) until billing; cloud-side scheduler is the later phase |

### P1 — changes made

- `src/entitlements.ts` (new): mock `isProFeatureEnabled` seam (grants Pro) — swap for the real check later.
- `src/autoPost.ts` (new): `AutoPost` scheduler (60s tick, day/time filters, once-a-day marker), review/auto modes, undo window, per-target retry+dedupe, failure recovery (`autoPostPendingDraft`, Retry/Open panel).
- `src/post.ts`: `postToWebhook(text, markdown?, onlyTypes?)` — retries hit only failed targets.
- `src/state.ts`: `lastAutoPostYmd`, `autoPostPostedTargets`, `autoPostPendingDraft`.
- `src/config.ts` + `package.json`: `shiplogue.autoPost.enabled/time/days/mode`.
- `src/extension.ts`: `produceDraft()` (panel-less generate) + AutoPost start/dispose.
- `test/autoPost.test.js` (new, 8 tests): disabled/off-day/before-time gates, reminder-time fallback, review post/skip, auto undo, once-per-day, retry dedupe, failure recovery.
- README auto-post section + settings; CHANGELOG `[Unreleased]`.
| R0 | Verify script + fake engine | ✅ done (2026-11-01) | `npm run verify` green | `scripts/verify.mjs` (typecheck+tests+artifact sizes), `test/model/fixtures/fake-engine.mjs` + README, `test:local` placeholder (gated), `.gitignore` for `*.gguf` | — |
| R6 | Grounding v2 | ✅ done (2026-11-01) | `npm test` 222/222; grounding.test.js 7 tests | claim taxonomy (path/number/url/date/metric/person/completion), inferred exemption, repair pass, `needsReview` flag, panel verification summary | false-positive tuning is iterative (R8 eval will measure) |

### R6 — changes made

- `src/grounding.ts` (new): `verify(draft, ctx)` with claim extraction, violations, removed/inferred counts; completion claims need a supported mention or a content-word anchor in the activity; `*(inferred)*` bullets exempt. `verifyGrounding` v1 shape kept (re-exported via `format.ts`; `PATHISH` moved here, re-exported by format.ts).
- `src/summarize.ts`: grounding violations → one repair pass ("these claims are not supported…"), re-verify; still-dirty → `verification.needsReview`; `GenerateResult.verification` payload.
- `src/shiploguePanel.ts`: status line shows "Verified N claims · M removed · K inferred" or the "⚠ Needs review" warning (error styling).
- Tests: `test/grounding.test.js` (7: per-kind fixtures, non-completion date/metric pass-through, tech-term false positives, @handles); summarize repair/needsReview tests; panel verification rendering. Synthetic fixtures re-anchored to fixture activity (completion rule).
- README grounding sections + limitations updated; CHANGELOG `[Unreleased]`.
| R7 | Context preflight | ✅ done (2026-11-01) | `npm test` 229/229; budget.test.js 6 tests | `estimateTokens`, `planPrompt` priority trimming, `ContextBudgetError`, panel notes; backend never receives over-budget prompt | — |

### R7 — changes made

- `src/model/budget.ts` (new): `estimateTokens` (chars/3.6 + 2/line), `planPrompt` (budget = context − output − 256; trim order: compact AI prompts → oldest commits → body chars → files/commit → touches → GitHub; steps clamped to detail defaults), `ContextBudgetError` (userFacing, actionable).
- `src/gather.ts`: `contextToText(ctx, opts)` overrides + `detailDefaults()`.
- `src/summarize.ts`: `planStandupPrompt(ctx, backendKind)` (Ollama → `ollama.numCtx`, local/provider → `model.contextTokens`); `generateStandup(ctx, signal, onPlan)`; `budget` in the result when trimming happened.
- `src/extension.ts`: loading note "Fitting activity to NK context (…)" while generating; panel summary note "context ~7.8K/16K — dropped …".
- `src/config.ts` + `package.json` + README: `shiplogue.model.contextTokens` (16384).
- `test/budget.test.js` (6): estimate monotonicity, heavy-day trim+report, no false trimming, tiny-context refusal, no over-budget prompt reaches the mock backend, refusal without backend call.
| A0 | Core extraction + agent scaffold | ✅ done (2026-11-01) | extension 233/233 (244 total); agent 11/11 | `src/core/{types,paths,format,grounding,budget,prompt,gather/*}` pure (no vscode imports, guard test); extension adapters byte-identical (suite unchanged); `agent/` package builds, `shiplogue status [--json]` works with real git data | MCP/ESM packaging decisions land in A4/A9 |
| A1 | Agent event store | ✅ done (2026-11-01) | agent 8/8 event tests | AgentEvent schema v1 (+ newer-schema refusal), JSONL day store (append/read/order/retention), dedupe (id + hash fallback, disk-backed), redaction (sk-/ghp_/Bearer/api_key/.env/keys/binaries) with caps, workspaceId = sha256(realpath), state.json, config precedence (env > file > defaults, 0600) | perf target "10k events <100ms" not yet benchmarked |

### A0+A1 — changes made

- `extension/src/core/`: `types.ts`, `paths.ts`, `format.ts`, `grounding.ts`, `budget.ts` (from `src/model/`), `prompt.ts` (prompt builder + activity renderer + DETAIL_LEVELS/TONES/baseTemplate), `gather/{git,cursor,github}.ts`. Old locations are re-export shims or thin vscode adapters (`git.ts`, `github.ts`, `gather.ts`, `summarize.ts`).
- `agent/`: `package.json` (`@phenzic/shiplogue-agent`, bin `shiplogue`), `tsconfig.json` (compiles `../extension/src/core` — no runtime core package), `src/config.ts`, `src/state.ts`, `src/events/{schema,store,redact,dedupe}.ts`, `src/cli.ts` (`status`), `src/index.ts`.
- Tests: `extension/test/core/core.test.js` (no-vscode guard, core git, byte-identical activity rendering, explicit-style prompt); `agent/test/events.test.js` (8), `agent/test/cli.test.js` (3).
- CI: new `agent` job (3 OSes × Node 20). `.gitignore`: `agent/dist/`, `*.gguf`, `.standup/`.
- Root README: Shiplogue Agent preview section. CHANGELOG `[Unreleased]`.

## Final results (2026-11-01)

- Extension: `npx tsc -p ./ --noEmit` clean; `npm test` **233 pass / 0 fail / 11 skipped (gated) / 244 total** (baseline was 184/194).
- `npm run verify`: typecheck + tests + artifact listing — green.
- Gated real-model suite `SHIPLOGUE_E2E=1 SHIPLOGUE_OLLAMA_MODEL=gpt-oss:20b test/e2e.ollama.test.js`: **5/5** (with grounding v2 + preflight active).
- Agent: `npm test` in `agent/` — **11/11** (8 event-store + 3 CLI).
- Not run this pass: `e2e.pipeline` (real model; unchanged by these chunks beyond grounding/preflight — e2e.ollama covers the same path), real Teams/Slack/Discord webhooks (manual), F5 manual QA.

## Open items for the user

- **Feedback form URL**: `FEEDBACK_FORM_URL` in `extension/src/feedback.ts` currently points at the GitHub feedback issue page — swap in the Tally/Google Form URL when it exists (one constant).
- **Shortcut conflict check**: `cmd+shift+J`/`ctrl+shift+j` set per your instruction; verify once in a real host (Keyboard Shortcuts → filter `@command:shiplogue.generate`), and note that browsers/DevTools use the same chord outside the editor.
- **Plan 2 items intentionally not done**: R1.5 native-engine spike (needs a manual clean-profile VSIX install + 2.7 GB model download — gates R2–R5/R8–R10), S2 clean-profile F5 pass (manual QA).
- **Auto-post entitlement** is the local mock (`src/entitlements.ts` grants Pro); wire to the real check when billing exists.
- **CI**: billing noted as resolved; the workflow (extension + agent jobs) validates on next push.
- **Agent next steps** (Plan 4): A2 watcher daemon, A3 hook adapters (Claude Code/Cursor first), A4 MCP server, A5 render/preview/post CLI.
