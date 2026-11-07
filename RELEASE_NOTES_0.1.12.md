# Shiplogue 0.1.12

**Theme-first stand-ups, with quieter settings and safer file detail.**

## Highlights

- **Theme-first Today:** a 1–2 sentence headline, then ranked workstreams tagged
  `feature`, `fix`, `debug`, `security`, `docs`, `refactor`, `test`,
  `performance` or `chore`. Each workstream gets one clean outcome sentence;
  files live in collapsed detail.
- **Settings no longer regenerate:** changing Detail or Tone only updates the
  setting. The current draft stays put until you click **Regenerate**.
- **File names only:** expanded rows show `email.ts`, not `lib/email.ts`, in the
  panel, weekly recap and cloud payload.
- **Yesterday is a story:** 2–4 synthesized bullets from yesterday's Today
  section, with no file paths or duplicated Today items.
- **Quality repair:** a deterministic check catches flat file lists, colon
  artifacts, duplicated Yesterday text, merge-first ordering and unsupported
  deploy claims. One targeted repair runs when needed; old flat drafts remain a
  fallback for smaller local models.
- **Calmer review strip:** “N claims to check” with “review before sending”
  instead of the oversized “left after a repair pass” warning.
- **Cloud-ready detail:** syncs `headline`, `labels`, `yesterday`, `themes`
  (`title`, `tag`, `summary`, `details`, `files`), `next`, `blockers` and
  `quality` alongside clean `bodyMarkdown`.

## Install

- **VS Code:** search for **Shiplogue**, or run
  `code --install-extension phenzic.shiplogue`.
- **Open VSX / Cursor / Antigravity:** search for **Shiplogue**, or install the
  VSIX from [Open VSX](https://open-vsx.org/extension/phenzic/shiplogue) /
  [Marketplace](https://marketplace.visualstudio.com/items?itemName=phenzic.shiplogue).

## Notes

- No model is bundled. Use Ollama or your own API key.
- No direct posting to Slack/Discord/Teams; delivery runs through Shiplogue Cloud.
- Manual VSIX installs receive the once-per-version update notice.

## Checksums

SHA-256 for `shiplogue-0.1.12.vsix`:

```
3d55b235b22ffcb399d9d3e5492205146e68aa05f82b2f91cb9c750ce8ffeaa9
```
