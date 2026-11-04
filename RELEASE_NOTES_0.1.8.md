# Shiplogue 0.1.8

**Optional cloud sync, reliable update notices, and a sharper draft.**

This release adds the pieces that make Shiplogue a daily workflow rather than a
one-off generator: a private cloud dashboard connector, update notices for manual
installs, stronger grounding, and a context preflight that refuses to send an
over-budget prompt.

## Added

- **Cloud sync (optional).** Connect a `shp_live_…` connector key with
  **Shiplogue: Connect Cloud**. Finished drafts sync to your private workspace at
  [shiplogue.dev](https://shiplogue.dev); **Cloud Status** and **Disconnect Cloud**
  are included. Only the draft, date, model label and estimated time saved are
  uploaded — never raw activity, prompts or diffs. Local generation works without
  an account.
- **Update notices for manual installs.** Shiplogue checks Marketplace and Open
  VSX at startup and, once per version, offers **Update now**, **Open listing**,
  **Enable auto-update**, or dismiss. **Shiplogue: Check for Update** runs the
  same check on demand. Marketplace/Open VSX installs keep the editor's own
  auto-update.
- **Grounding v2.** Structured checks for paths, numbers, URLs, completion,
  people and dates. Unsupported claims trigger one repair pass, then surface a
  review warning; invented URLs are removed deterministically.
- **Context preflight.** Set `shiplogue.model.contextTokens` to guarantee the
  assembled prompt fits the model window. Activity is trimmed by priority and the
  panel reports what was omitted. `0` disables preflight.
- **AI prompt capture** now covers Cursor, VS Code Copilot and Antigravity chat
  stores (read-only), with a background watcher.
- A small provenance note under **Copy** shows the model used, e.g.
  “done with OpenAI BYOK”.

## Improved

- README trimmed to what a user needs: what it does, features, compatibility,
  install, quick start, model/privacy choices, settings and troubleshooting.
- Marketplace/Open VSX links, `shiplogue.dev` and Open VSX badges added.
- Package description shortened; `homepage` points at
  [shiplogue.dev](https://shiplogue.dev).

## Install

- **VS Code:** search for **Shiplogue**, or
  `code --install-extension phenzic.shiplogue`.
- **Open VSX / Cursor / Antigravity:** search for **Shiplogue**, or install the
  VSIX from [Open VSX](https://open-vsx.org/extension/phenzic/shiplogue) /
  [Marketplace](https://marketplace.visualstudio.com/items?itemName=phenzic.shiplogue).

Updating from 0.1.7: if you connected a cloud key, the existing key continues to
work; no reinstall of the connector key is needed.

## Known limitations

- No posting to Slack/Discord/Teams in this build — drafts are copied, not sent.
- No model is bundled. Use Ollama or your own API key.
- Manual VSIX installs have no gallery update channel; use the update notice.
- The docs site (`docs.shiplogue.dev`) lives in the cloud repo and is not part of
  the extension package.

## Checksums

SHA-256: `ac050b1e4f6b186bedfa9b4b3df1f6f18f7a344e4451b1fe83964ad76e8ffcef`  `shiplogue-0.1.8.vsix`
