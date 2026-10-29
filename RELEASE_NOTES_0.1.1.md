First public beta of Standup — local-first daily stand-ups from your real IDE activity.

**Pick a backend:**
- Ollama (local, free): install Ollama, then `ollama pull llama3.2`
- Your own API key: Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible
  endpoint (DeepSeek, Kimi, OpenRouter, LM Studio…)

**Install:** download `standup-0.1.1.vsix` below →
Extensions view → `…` menu → “Install from VSIX”.
Or: `code --install-extension standup-0.1.1.vsix`

**Setup:** Command Palette → `Standup: Set API Key` (or just run Ollama) →
`Standup: Generate Today's Update`.

**Known limitations:** no Marketplace listing yet (manual updates), activity
tracking only starts after install (today's git commits are included), no bundled
model yet, UI tested mainly on macOS/Antigravity.
SHA-256: `21ef9552609d47c6d87581b08ca40d14a43422b3337d553be313e2ec92e0ec27`  `standup-0.1.1.vsix`
