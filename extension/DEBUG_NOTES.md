# Debug notes — BYOK generation fails: “reasoning but no final answer content”

**Status:** root cause identified, reproduced locally, and **fixed on 2026-10-30**. The 2026-10-29
change only improved the error message; it did not change the request. See
[Implemented fix](#implemented-fix-2026-10-30).

## Symptom

Running a BYOK generation (or **Standup: Test Provider**) against an OpenAI-compatible endpoint
fails. Both messages come from the same adapter, `src/core/providers/compatible.ts`, and both
mean “HTTP 200, but `choices[0].message.content` was empty”:

```
The endpoint returned an empty response. (code: bad_response)          # before 2026-10-29
The endpoint returned reasoning but no final answer content. …          # after the message change
```

The second message additionally proves the response carried `message.reasoning_content`.

## What is actually happening

Reasoning (“thinking”) is **on by default** on the current DeepSeek API and on several other
OpenAI-compatible reasoning endpoints, and the hidden chain-of-thought is drawn from the same
`max_tokens` completion budget as the answer. This app asks for far too few output tokens, and
it never tells the endpoint to stop thinking, so the CoT consumes the entire budget and the
answer never starts:

- `content: null`
- `reasoning_content: "…"`
- `finish_reason: "length"`

The adapter then treats “content is empty” as a fatal error.

DeepSeek's docs are explicit:

- “Thinking mode is **enabled by default**, with the default effort being `high`.”
  ([Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode))
- Thinking is toggled with `{"thinking": {"type": "disabled"}}`, or disabled with
  `reasoning_effort: "none"`.
- `max_tokens` is “the maximum number of tokens that can be generated in the chat completion”,
  and usage reports `completion_tokens_details.reasoning_tokens` inside `completion_tokens`.
  ([Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion))
- The current model ids are `deepseek-flash` (thinking **default**) and `deepseek-v4-pro`.
  ([Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing))

### Budgets the app sent before the fix

| Path | `max_tokens` | Why |
| --- | --- | --- |
| **Standup: Test Provider** | **16** | Hard-coded probe: `src/commands/providerKeys.ts:229` (now ≥512) |
| Generate — `concise` (default) | **400** | `DETAIL_LEVELS.concise.predict`, `src/summarize.ts:22` |
| Generate — `standard` | **900** | `src/summarize.ts:30` |
| Generate — `elaborate` | **1600**, capped to **1200** | `src/summarize.ts:39`, then `Math.min` in `src/model/providerBackend.ts:20-23` with `standup.provider.maxOutputTokens` default `1200` (`src/config.ts:51`) |

The default detail level is `concise` (`package.json` → `standup.detail` default, and
`src/state.ts:16-18`), i.e. **400 tokens on a fresh install**. A 400-token budget is routinely
smaller than the model's hidden reasoning for a stand-up prompt, so the first run fails before a
single visible token is produced.

The first request body (`src/core/providers/compatible.ts:96-101`) contains only:

```json
{ "model": "…", "messages": [{ "role": "user", "content": "…" }],
  "temperature": 0.4, "max_tokens": 400 }
```

There is no `thinking` and no `reasoning_effort`, so the endpoint applies its default — thinking
on. (`temperature` is also ignored in DeepSeek thinking mode, so the per-detail temperature has no
effect there.)

## Reproduction (verified locally, 2026-10-30)

A harness drove the **real compiled code** (`out/commands/providerKeys.js`,
`out/summarize.js`) against a mock OpenAI-compatible endpoint that behaves like DeepSeek today:
thinking on unless `thinking.type === "disabled"` / `reasoning_effort === "none"`, reasoning
counting against `max_tokens`, `content: null` + `reasoning_content` + `finish_reason: "length"` when
the budget runs out.

Results from the **pre-fix** build (the harness is also the post-fix check):

| Case | CoT size | Result |
| --- | --- | --- |
| Test Provider (`max_tokens: 16`) | any | **fails**, reasoning-only — every time |
| Generate, `concise` (400) | 200 tokens | succeeds (reasoning + answer fit) |
| Generate, `concise` (400) | 480 tokens | **fails**, reasoning-only |
| Generate, `standard` (900) | 480 tokens | succeeds |
| Generate, `elaborate` (1200 after cap) | 480 tokens | succeeds |

The user's own raw response was not captured (the extension logs none), so their exact
`finish_reason` is inferred — but the mock reproduces the same error text through the same code
path, and the only way to reach that branch is a reasoning-only response.

This explains the intermittent first run: the same configuration succeeds or fails depending on
how long the model reasons. It also explains why the 2026-10-29 “fix” changed the wording but not
the outcome.

## Why the 2026-10-29 change did not fix it

It only branched on the presence of `reasoning_content` to pick a better message (the old
`generate` body, lines 56–72 of the pre-fix file). Nothing changed about the request, the budget, or the
retry behaviour. The new advice is also **stale**: it recommends `deepseek-chat`, which is no
longer in DeepSeek's documented model list (`deepseek-flash` / `deepseek-v4-pro` are), and it
does not mention the actual lever, `thinking: {"type": "disabled"}` / `reasoning_effort: "none"`.

## Secondary defects found

1. **Test Provider could never pass on a thinking endpoint.** `maxTokens: 16` guaranteed the
   probe was spent on reasoning. **Fixed:** the probe is now
   `Math.max(cfg().providerMaxOutputTokens, 512)`.
2. **The output cap makes things worse.** `standup.provider.maxOutputTokens` defaults to `1200`
   and is a hard `Math.min`, so `elaborate` (1600) is silently reduced. **Mitigated:** the
   recovery request may exceed the cap because it only runs when the first request produced no
   answer at all. The default itself is unchanged.
3. **Only one reasoning field was detected.** The old code checked `message.reasoning_content`
   only; OpenRouter-style endpoints return `message.reasoning`. **Fixed:** both fields, plus
   `finish_reason: "length"`, now trigger recovery.
4. **`finish_reason` was discarded.** **Fixed for errors:** the thrown message now includes
   `finish_reason` and `completion_tokens_details.reasoning_tokens`. Request/response logging is
   still absent.
5. **No recovery path for BYOK.** **Fixed:** the provider path now retries like Ollama does
   (`src/model/ollama.ts:102-119`).
6. **Same failure class elsewhere (unverified here):** the OpenAI adapter
   (`max_completion_tokens`) and Gemini 2.5 Flash (thinking on by default, `maxOutputTokens`
   includes thinking) can produce the same empty-content outcome. Not changed in this fix.

## Implemented fix (2026-10-30)

**`src/core/providers/compatible.ts`**

- Extracted `messageText`, `messageReasoning` (accepts `reasoning_content` **and** OpenRouter's
  `reasoning`), `finishReason`, `reasoningOnly`, and `emptyResponseError`.
- The first request is unchanged. If it returns no text but shows reasoning (`reasoning_content`,
  `reasoning`, or `finish_reason: "length"`), one recovery request is sent with
  `max_tokens: Math.max(req.maxTokens * 4, 4096)` and `reasoning_effort: "none"`.
- If the endpoint rejects `reasoning_effort` with HTTP 400, a second recovery request is sent
  with the larger budget only. Other failures (auth, rate limit, context length) propagate
  unchanged instead of being retried.
- If both attempts are still empty, the error names the cause and the evidence, e.g.
  “The endpoint spent its whole output budget on reasoning and returned no answer
  (finish_reason: length, reasoning tokens: 4096). Raise standup.provider.maxOutputTokens, or
  use a model without thinking mode.”
- The recovery budget deliberately exceeds `standup.provider.maxOutputTokens`: it only fires
  when the first request produced nothing, and a retry bounded by a too-small cap would fail
  again by construction.

**`src/commands/providerKeys.ts`**

- **Test Provider** probes with `Math.max(cfg().providerMaxOutputTokens, 512)` instead of `16`,
  so thinking models have room to finish.

**`package.json` / `CHANGELOG.md`**

- The `standup.provider.maxOutputTokens` description now documents the one-off recovery request
  (which may exceed the cap), and the 0.1.1 changelog records the fix.

**Tests**

- `test/model/providers.test.js`: reasoning-only retry (via `message.reasoning`),
  `reasoning_effort` 400 fallback, still-empty error detail (finish_reason + reasoning tokens),
  and “a plain empty response is not retried”.
- `test/model/providerKeys.test.js`: Test Provider succeeds against an endpoint whose thinking
  consumes anything below a 512-token probe, and sends `max_tokens >= 512`.

Remaining (out of scope here): a `standup.provider.think` setting, matching recovery in the
OpenAI/Gemini adapters, and request logging.

## Checks run (2026-10-30)

- `npx tsc -p ./ --noEmit` — clean (exit 0).
- `npm test` — **192 tests, 182 pass / 10 skipped / 0 fail**. The old “reasoning but no final
  answer” assertion was replaced by the retry/fallback cases.
- End-to-end harness driving the real `testProvider` and `generateStandup` against the
  thinking-by-default mock (the same harness that reproduced the bug):
  - Test Provider: works — 1200-token probe.
  - `concise` (CoT 200), `standard` (CoT 200), `elaborate` (CoT 200): work on the first request.
  - `concise` with CoT 480: first request fails at 400 tokens, recovery request
    `max_tokens: 4096` + `reasoning_effort: "none"` succeeds.
- The unit tests assert the outgoing request bodies, not just the result, because a mock can
  otherwise make a too-small budget look fine — exactly how this bug slipped through before.

## How to verify on a real endpoint

1. **Standup: Test Provider** — should now reply instead of failing.
2. Generate at `concise` and `standard` — both should return a draft. If the first request is
   reasoning-only, the adapter's second request is the recovery call.
3. If it still fails, the error now names `finish_reason` and the reasoning-token count; raise
   `standup.provider.maxOutputTokens` (e.g. 4096) and retry.
