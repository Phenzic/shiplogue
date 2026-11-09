# Shiplogue 0.1.13

**Stable Marketplace release of the 0.1.12 feature set.**

0.1.12-b was rejected because the Marketplace does not accept semver prerelease suffixes. 0.1.13 is the same feature release with a stable version.

## Highlights

- **Activity sync:** opt-in metadata-only capture of file edits, 30 days of commits across open local workspaces, GitHub items, AI prompts, sessions, and token usage.
- **Commit-level activity:** commits include files and per-file additions/deletions, ready for the Activities timeline.
- **Sectioned stand-ups:** Today is grouped by major folder/section, with multiple tags per item and no tag headers.
- **Activity sync enabled by default:** use **Shiplogue: Enable Activity Sync** if it was previously disabled.
- **Review & sync:** the cloud action syncs and compiles the project story, then opens the review page.
- **Project-scoped delivery:** Slack, Discord and Teams destinations, multiple Slack/Discord channels, review-first posting, and duplicate-post warnings.

## Fixes

- Section source attribution now uses the host editor/agent instead of prompt context.
- Today's copy output uses bullet lists without file paths.
- Delivery queueing now works on Neon's HTTP driver (no transactions).
- Weekly recap is a Pro feature.

## Install

- **VS Code:** search for **Shiplogue**, or run
  `code --install-extension phenzic.shiplogue`.
- **Open VSX / Cursor / Antigravity:** search for **Shiplogue**, or install the
  VSIX from [Open VSX](https://open-vsx.org/extension/phenzic/shiplogue) /
  [Marketplace](https://marketplace.visualstudio.com/items?itemName=phenzic.shiplogue).

## Notes

- No model is bundled. Use Ollama or your own API key.
- Activity sync uploads metadata only: no file contents, raw prompts, or terminal output.
- Manual VSIX installs receive the once-per-version update notice.

## Checksums

SHA-256 for `shiplogue-0.1.13.vsix`:

```
62078063fad4859f9c71ba13b4cb3687d784322f36572521438820eb5e0b1df1
```
