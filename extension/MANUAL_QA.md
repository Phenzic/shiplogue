# Manual QA Checklist — v0.1.0 launch

Run in a real extension host: `cd extension && npm run compile`, then **F5**
(Run Extension) on macOS — and on Windows if available (required for 0.2.0,
nice-to-have for 0.1.0). Have Ollama running with `gpt-oss:20b` pulled, and at
least one workspace with real git activity from today.

## 1. Activation & first run

- [ ] Extension activates on startup without errors (Extension Host output clean).
- [ ] First run asks for a reminder time once; it is not asked again on reload.
- [ ] Health check: with Ollama stopped, a warning offers "How to install" → opens ollama.com.
- [ ] Health check: with `standup.ollama.model` set to a non-pulled model, the warning offers "Pull now" (runs `ollama pull` in a terminal) and "Pick another model" (writes the setting globally).
- [ ] With Ollama running and the model pulled, no warning appears.

## 2. Generation quality (with `gpt-oss:20b`)

- [ ] Generate at all three detail levels (concise / standard / elaborate) on a heavy day; all complete without empty-response errors.
- [ ] Progress shows the current phase with elapsed seconds ("Writing your stand-up… (42s)").
- [ ] On a day with >25 commits or >20 AI prompts, the panel meta line shows "showing N of M" and the prompt (via "Standup: Show Tracked Activity") shows the same markers.
- [ ] If the draft mentions an unverifiable file or #number, the status line shows "⚠ Removed N unverifiable mention(s): …" and the draft does not contain them.
- [ ] Compare the draft against "Standup: Show Tracked Activity" output: no invented filenames, issues, or PRs.
- [ ] Inferred "Next" items render italic as `*(inferred)* …`.
- [ ] `standup.tone: senior` reads distinctly terser than `neutral`.

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

## 7. Launch

- [ ] `npx @vscode/vsce package` produces `standup-0.1.0.vsix` without warnings.
- [ ] CI workflow green on ubuntu/macos/windows.
- [ ] Sign-off → tag `v0.1.0`, `vsce publish`, Marketplace listing text finalized.
