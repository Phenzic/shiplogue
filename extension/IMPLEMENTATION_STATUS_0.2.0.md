# Implementation Status — 0.2.0

Baseline: `main` at 0.1.7 (193 pass / 10 skipped / 0 fail on this branch).
Decision 2026-11-03: **no bundled model**. Backends are Ollama, BYOK, and the
planned hosted Shiplogue provider (paid).

## Sequence

| Step | Work | Status |
| --- | --- | --- |
| S2 | Clean-profile manual QA matrix | ⏳ user action |
| S5 | R6 grounding v2 + R7 context preflight | 🟡 in progress |
| IDE adapters | Prompt capture for Cursor, VS Code, Antigravity, others; watcher; folded into A3 | ⬜ next (before agent) |
| Agent | A0–A9 from `IMPLEMENTATION_PLAN_4.md` / `ARCHITECTURE.md` | ⬜ after adapters |

## S5 — R6 grounding v2

- [x] Structured `verifyClaims` with violation kinds (path, number, URL, completion)
- [x] URL and completion checks; deterministic removal for path/number/URL
- [x] `needsReview` signal for unsupported completion claims
- [x] Wired into `summarize`; warnings still shown; `verification` payload added
- [x] Tests: 183 pass / 10 skipped / 0 fail (5 new grounding tests)
- [x] One repair call, re-verify, `verification` payload in the panel
- [x] Person/date taxonomy; unsupported claims set `needsReview`
- [x] Panel warning: "Needs review: N unverified claim(s)"
- [ ] Eval fixtures (R8)

## IDE prompt capture (before agent)

Yes — the plan is a **unified capture layer**, not Cursor-only:
- Cursor: existing read-only chat DB.
- VS Code / Antigravity: chat-session stores (adapter per host/version).
- Other agents (Claude Code, Copilot, Codex, Gemini): hooks/transcripts per A3.
- A watcher keeps reading new prompts/events while the IDE runs (debounced,
  single-instance, deduped), instead of only a one-shot gather.

- [x] Adapter interface + Cursor adapter (existing DB)
- [x] VS Code / Antigravity chat-session adapters (JSON/JSONL)
- [x] Watcher for live updates (15 s poll, unref'd, deduped)
- [x] Merge into gather with source labels; privacy filters stay enforced
- [x] Tests/fixtures for chat sessions
- [ ] Claude Code / Copilot / Codex / Gemini hooks (agent A3)

## R7 — context preflight

- [x] `shiplogue.model.contextTokens` setting (0 = off)
- [x] Conservative token estimate + priority trimming (prompts → commits → bodies → files → touches → GitHub)
- [x] Refuses with an actionable error when even the minimum does not fit
- [x] Post-draft warning reports what was dropped
- [ ] Pre-generation loading note in the panel
- [x] Tests (191 pass / 10 skipped)
