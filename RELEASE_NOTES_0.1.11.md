# Shiplogue 0.1.11

**A theme-first daily story, a real local history, and a weekly recap that tells
the whole story.**

## Highlights

- **One built-in format:** Yesterday / Today / Next / Blockers. It is no longer a
  user setting. Paid workspaces can relabel/reorder those four sections from a
  cloud profile; free plans always get the built-in format.
- **Yesterday is a story, not a copy:** it is synthesized from yesterday's saved
  Today section into **2–4 readable bullets**; no file lists, no Next items, and
  no repeated Today work.
- **Settings no longer regenerate:** changing Detail or Tone just updates the
  setting for the next generation; your current draft stays put.
- **Safer file detail:** expanded rows show only the file name, never the full
  path, in the panel, weekly recap and cloud payload.
- **Theme-first Today:** a 1–2 sentence headline, then ranked workstreams with
  `feature` / `fix` / `debug` / `security` / `docs` tags. Files and supporting
  detail sit underneath each theme, collapsed until opened. A quality check
  catches flat file lists, colon artifacts, merge-first ordering and unsupported
  deploy claims, with one targeted repair; old flat drafts remain a fallback.
- **Reliable local history:** every generated draft is written atomically to the
  editor's global storage, one record per local day/workspace, and kept for **7
  days**. Copying marks it reviewed and replaces the generated text. Run
  **Shiplogue: Open Stand-up History** to browse the last week.
- **Sync vs Send:** the history action previously called “Send again” is now
  **Sync** — it pushes the stored draft to Shiplogue Cloud without posting it.
  The draft's **Send via Shiplogue Cloud** button still asks the cloud to deliver
  to connected Slack/Discord/Teams targets.
- **Better weekly recap:** reads structured themes and tags when available,
  keeps details, adds week-level coverage counts, and lists work carried into
  next week.
- **Cloud-ready detail:** syncs the headline and structured themes (title, tag,
  summary, detail, files) alongside clean Markdown so the dashboard can render
  collapsible rows.

## Install

- **VS Code:** search for **Shiplogue**, or run
  `code --install-extension phenzic.shiplogue`.
- **Open VSX / Cursor / Antigravity:** search for **Shiplogue**, or install the
  VSIX from [Open VSX](https://open-vsx.org/extension/phenzic/shiplogue) /
  [Marketplace](https://marketplace.visualstudio.com/items?itemName=phenzic.shiplogue).

## Notes

- No model is bundled. Use Ollama or your own API key.
- No posting to Slack/Discord/Teams directly from the extension; delivery runs
  through Shiplogue Cloud.
- Manual VSIX installs receive the once-per-version update notice.

## Checksums

SHA-256 for `shiplogue-0.1.11.vsix`:

```
e04ef596245d95b29c6b8f945ec6cd5cbdd30b577318bdf7b0d6d901c2c0d1e9
```
