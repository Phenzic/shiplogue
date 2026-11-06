# Shiplogue 0.1.11

**A fixed daily format, a real local history, and a weekly recap that tells the
whole story.**

## Highlights

- **One built-in format:** Yesterday / Today / Next / Blockers. It is no longer a
  user setting. Paid workspaces can relabel/reorder those four sections from a
  cloud profile; free plans always get the built-in format.
- **Yesterday is a summary, not a copy:** it is condensed from yesterday's saved
  Today section into **1–2 bullets**, with a hard post-processing cap. File
  sub-bullets and Next items are not carried into Yesterday.
- **Reliable local history:** every generated draft is written atomically to the
  editor's global storage, one record per local day/workspace, and kept for **7
  days**. Copying marks it reviewed and replaces the generated text. Run
  **Shiplogue: Open Stand-up History** to browse the last week.
- **Sync vs Send:** the history action previously called “Send again” is now
  **Sync** — it pushes the stored draft to Shiplogue Cloud without posting it.
  The draft's **Send via Shiplogue Cloud** button still asks the cloud to deliver
  to connected Slack/Discord/Teams targets.
- **Better weekly recap:** reads each day's **Today** section (not Yesterday),
  keeps details, adds week-level coverage counts (commits, files, PRs/issues, AI
  prompts/sessions, sources), and lists work carried into next week.

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
35884e6769dd80748d32ae9bfddbf43d739c6b94fe5822f38413e9d52a6d2977
```
