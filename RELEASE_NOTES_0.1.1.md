First public beta of Standup — local-first daily stand-ups from your real IDE activity.

**Pick a backend:**
- Ollama (local, free): install Ollama, then `ollama pull llama3.2`
- Your own API key: Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible
  endpoint (DeepSeek, Kimi, OpenRouter, LM Studio…)

**Install:** download `standup-0.1.1.vsix` below →
Extensions view → `…` menu → “Install from VSIX”.
Or: `code --install-extension standup-0.1.1.vsix`

**Setup:** Command Palette → `Standup: Set API Key` (or just run Ollama) →
`Standup: Generate Today's Update`. Use `Standup: Test Provider` to verify a key,
endpoint and model in one short request.

**Fixes in this build:**
- Endpoints that think by default (for example DeepSeek) no longer fail with
  "reasoning but no final answer": if a reply contains reasoning but no answer,
  Standup retries once with a larger budget (at least 4096 tokens) and thinking
  disabled, then falls back to the budget alone if the endpoint rejects that
  parameter.
- `Standup: Test Provider` now probes with a realistic budget (at least 512
  tokens) instead of 16, so it no longer reports a false failure on those
  endpoints.

**Known limitations:** no Marketplace listing yet (manual updates), activity
tracking only starts after install (today's git commits are included), no bundled
model yet, UI tested mainly on macOS/Antigravity.
SHA-256: `caabfecfd5681fc2d45dc943a4e9fb07623c516d3334f34fb03fe082952ef7b1`  `standup-0.1.1.vsix`
