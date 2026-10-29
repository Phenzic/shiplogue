# Debug notes — 2026-10-29 — “The endpoint returned an empty response.”

## Symptom

Running **Standup: Test Provider** (or generating a stand-up) with the
OpenAI-compatible provider (used for DeepSeek, Kimi, OpenRouter, Groq, LM Studio,
llama.cpp…) failed with:

```
The endpoint returned an empty response. (code: bad_response)
```

## Reproduction

- Command: **Standup: Test Provider** (or a full generate run).
- Provider type: `openai-compatible`.
- Base URL: DeepSeek (`https://api.deepseek.com`).
- Key: present (non-empty).
- Model: user-selected (deepseek-chat / deepseek-reasoner).

## Root cause analysis

- The error string exists in exactly one backend: `src/core/providers/compatible.ts`
  (“The endpoint returned an empty response.”). The OpenAI adapter uses
  “OpenAI returned an empty response.”, Anthropic/Gemini have their own variants —
  so this is definitively the **OpenAI-compatible adapter**, i.e. a DeepSeek (or other
  OpenAI-compatible) endpoint.
- Flow: adapter POSTs `{base}/chat/completions`, reads
  `choices[0].message.content`, trims it, and throws the generic error when empty.
- An HTTP 200 with no usable content ⇒ the provider returned an empty assistant
  message.

## Leading hypotheses

1. **Reasoning model selected (e.g. `deepseek-reasoner`).** DeepSeek returns
   `reasoning_content` and may leave assistant `content` empty/null for reasoning
   models; the adapter treats that as “empty response” and throws a generic error.
2. Output budget truncation (`max_tokens`) leaving nothing usable.
3. Endpoint/key issues would fail earlier (unavailable / auth / 404) — so an *empty
   response* points at content-level emptiness, not connectivity.

## Implemented fix (2026-10-29)

In `src/core/providers/compatible.ts`, when the assistant content is empty and a
`reasoning_content` field is present, throw an actionable error instead of the
generic “empty response” one:

```
The endpoint returned reasoning but no final answer content. If you use a reasoning
model (for example deepseek-reasoner), switch to the non-reasoning model (for example
deepseek-chat) or raise the output budget.
```

## Checks run

- `npx tsc -p ./ --noEmit` — clean.
- `npm test` — full suite green after the fix (188 tests, 178 pass / 10 skipped / 0 fail;
  see `test/model/providers.test.js` for the reasoning/empty-content case).
