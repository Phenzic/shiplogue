# Manual QA Checklist — v0.1.1 beta

Run in a real extension host: `cd extension && npm run compile`, then **F5**
(Run Extension) on macOS — and on Windows if available (required for 0.2.0,
nice-to-have for 0.1.x). Have Ollama running with `gpt-oss:20b` pulled, and at
least one workspace with real git activity from today.

For the BYOK section, have at least one API key available (Anthropic, OpenAI or
Google). Never paste a key into a scratch file or the QA log. For §8, also have a
thinking-by-default endpoint/model (for example DeepSeek `deepseek-flash`, or a
reasoning model served through OpenRouter/vLLM).

## 1. Activation & first run

- [x] Extension activates on startup without errors (Extension Host output clean).
- [x] First run asks for a reminder time once; it is not asked again on reload.
- [x] Health check: with Ollama stopped, a warning offers "How to install" → opens ollama.com.
- [x] Health check: with `standup.ollama.model` set to a non-pulled model, the warning offers "Pull now" (runs `ollama pull` in a terminal) and "Pick another model" (writes the setting globally).
- [x] With Ollama running and the model pulled, no warning appears.

## 2. Generation quality (with `gpt-oss:20b`)

- [x] Generate at all three detail levels (concise / standard / elaborate) on a heavy day; all complete without empty-response errors.
- [x] Progress shows the current phase with elapsed seconds ("Writing your stand-up… (42s)").
- [x] On a day with >25 commits or >20 AI prompts, the panel meta line shows "showing N of M" and the prompt (via "Standup: Show Tracked Activity") shows the same markers.
- [x] If the draft mentions an unverifiable file or #number, the status line shows "⚠ Removed N unverifiable mention(s): …" and the draft does not contain them.
- [x] Compare the draft against "Standup: Show Tracked Activity" output: no invented filenames, issues, or PRs.
- [x] Inferred "Next" items render italic as `*(inferred)* …`.
- [x] `standup.tone: senior` reads distinctly terser than `neutral`.

## 3. Cancel & races

- [ ] Cancel during a long elaborate run returns control in ~1 s and shows "Cancelled." (not an error).
- [ ] Click Regenerate 5 times rapidly: exactly one final draft, from the last click; no "Cancelled." flash.
- [ ] While busy, Regenerate / Detail / Tone are disabled and Cancel is visible.
- [ ] With `standup.generate.timeoutSeconds` set low (e.g. 5), a slow run aborts with the "timed out after Ns" guidance message.

## 4. Sources

- [ ] Real GitHub sign-in ("Standup: Connect GitHub") → merged PRs / closed issues appear with a References block of real links.
- [ ] Cursor prompts appear when Cursor is installed; `standup.cursor.enabled: false` excludes them.
- [ ] Multi-root workspace: only the open folders' activity is included; two same-named folders in different windows don't leak into each other.
- [ ] A window with no folder open gathers the whole day and the panel notes "No folder open — included all projects."

## 5. Posting

- [ ] Discord webhook: a normal draft posts as one message.
- [ ] Discord webhook: a >1990-char elaborate draft posts as multiple ordered messages; beyond 3 messages the last ends with "…(truncated — full text copied to clipboard)" and the clipboard holds the full text.
- [ ] Slack webhook: draft posts in mrkdwn (`*bold*`, `<url|text>`), taken from the Markdown tab even when the Plain text tab is active.

## 6. Storage & soak

- [ ] 30-minute soak: memory stable, the daily reminder fires once, snooze works.
- [ ] `kill -9` the extension host mid-flush: no `.tmp` files remain in the activity dir, no torn JSON, no lost day.
- [ ] Day files older than `standup.store.retentionDays` are pruned on startup (check the debug console log).

## 7. Bring your own API key (new in 0.1.1)

- [ ] **Standup: Set API Key** → pick a provider → paste key → model list appears; choosing one writes `standup.provider.type/model` and switches `standup.model.backend` to `provider`.
- [ ] While the key is stored, `settings.json` contains no key; no output channel or notification prints it.
- [ ] **Standup: Test Provider** reports success for the chosen model.
- [ ] Generate a stand-up with the provider; the panel meta line shows `via <Provider> · <model>`.
- [ ] Stop Ollama: generation still works with `backend: provider`, and no "Ollama isn't running" warning appears at startup.
- [ ] Set `standup.model.backend: ollama` with a provider configured: generation uses Ollama and the badge says `via Ollama`.
- [ ] Set `backend: provider` with no key: generation fails with the "Run Standup: Set API Key" message, not a stack trace, and does not call Ollama.
- [ ] Revoke/garble the key: the error says the key was rejected and does not echo it.
- [ ] `openai-compatible`: point at LM Studio (`http://localhost:1234/v1`), leave the key blank, pick a loaded model, generate.
- [ ] **Standup: Clear API Key** removes the key and resets `provider.type`/`model.backend`.
- [ ] Reload the window: the key survives (keychain) and generation works without re-entry.

## 8. Reasoning-by-default BYOK endpoint (0.1.1 fix)

Use a provider/model that enables thinking by default (e.g. DeepSeek
`deepseek-flash`, or a reasoning model on OpenRouter/vLLM). The request is sent
without a `thinking`/`reasoning_effort` field, so the endpoint's default applies.

- [ ] **Standup: Test Provider** succeeds (the probe budget is ≥512 tokens, not 16).
- [ ] Generate at `concise`: the first reply may be reasoning-only; a draft still appears (recovery request at ≥4096 tokens with `reasoning_effort: "none"`).
- [ ] Generate at `standard`: same, with a draft in the panel.
- [ ] On an endpoint that rejects `reasoning_effort` with HTTP 400, generation still succeeds via the budget-only retry (provider request log shows 2–3 calls).
- [ ] Force both attempts to fail (e.g. `standup.provider.maxOutputTokens: 64`): the error names `finish_reason` and a reasoning-token count, and never echoes the key.
- [ ] The panel badge still shows `via <Provider> · <model>`.
- [ ] With `standup.model.backend: ollama`, the same project still generates through Ollama (no provider calls).

## 9. Launch

- [x] `npm run package` produces `standup-0.1.1.vsix` without warnings.
- [x] `npm test` passes locally (CI is blocked by a GitHub billing issue — record the local run in the release notes).
- [x] Sign-off → create the GitHub Release, attach the VSIX, then `vsce publish` / Open VSX when the publisher account exists.
