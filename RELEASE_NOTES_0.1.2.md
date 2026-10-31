Beta 0.1.2 — **the extension is now Shiplogue**. Same tool, renamed before the
Marketplace launch, so the published id is clean from day one.

**Why the name change:** Marketplace extension ids (`publisher.name`) cannot be
renamed after publishing. Doing it now costs a handful of testers a reinstall;
doing it later would cost every user one, plus a second listing.

**If you installed 0.1.1 (Standup):** uninstall it first, install this VSIX, then
run `Shiplogue: Set API Key` again. The renamed extension has a new id, so it
cannot read the old build's keychain entry or activity logs.

**Pick a backend:**
- Ollama (local, free): install Ollama, then `ollama pull llama3.2`
- Your own API key: Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible
  endpoint (DeepSeek, Kimi, OpenRouter, LM Studio…)

**Install:** download `shiplogue-0.1.2.vsix` below →
Extensions view → `…` menu → “Install from VSIX”.
Or: `code --install-extension shiplogue-0.1.2.vsix`

**Setup:** Command Palette → `Shiplogue: Set API Key` (or just run Ollama) →
`Shiplogue: Generate Today's Update`. Use `Shiplogue: Test Provider` to verify a
key, endpoint and model in one short request.

**What changed since 0.1.1:**
- Extension id `phenzic.shiplogue`; commands and settings under `shiplogue.*`.
- Local activity is stored in `globalStorage/phenzic.shiplogue/`.
- Panel title and all user-facing messages renamed.
- No change to drafting, grounding or posting behaviour.

**Known limitations:** no Marketplace/Open VSX listing yet (install from this
VSIX), activity tracking only starts after install (today's git commits are
included), no bundled model yet, UI tested mainly on macOS/Antigravity.

SHA-256: `dd15c0d9777329163362859130af0b80e7eb45add22ee9adc59175f655529970`  `shiplogue-0.1.2.vsix`
