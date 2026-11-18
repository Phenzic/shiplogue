# Shiplogue 0.1.15

**Install presence, cloud-synced style, and Devin support.**

## Added

- **Anonymous install presence:** Shiplogue sends one random install ID and the
  extension version per version. It only runs when the editor telemetry setting
  is enabled and `shiplogue.installTelemetry.enabled` is on. No IP address,
  account, workspace, prompt, or activity data is sent. This is not a download
  count; it counts installs that activated with telemetry enabled.
- **Cloud-synced stand-up style:** cloud profiles can supply the detail level,
  tone, and section labels/order. Changing Detail or Tone in the extension now
  updates the cloud summary settings.

## Changed

- **Devin support:** Devin is recognized as a source from either its app name or
  its install path, and update checks use the Open VSX listing for Devin.
- Stand-up tags now appear after the item text.
- The verification banner is more compact, and warning-pill copy is trimmed.

## Notes

- Activity sync and cloud sync behavior are unchanged from 0.1.13/0.1.14.
- Existing drafts are unchanged; regenerate to pick up display-only changes.
- No model is bundled. Use Ollama, your own API key, or the cloud review flow.

## Install

- **VS Code:** search for **Shiplogue**, or run
  `code --install-extension phenzic.shiplogue`.
- **Open VSX / Cursor / Antigravity / Devin:** search for **Shiplogue**, or
  install the VSIX from Open VSX / Marketplace.
- **Manual VSIX:** `extension/shiplogue-0.1.15.vsix`.

## Checksums

SHA-256 for `shiplogue-0.1.15.vsix`:

```
0271c19894f261e759f53308e8a9455246f1a0938b59f29eedfe79b3a60c72bc
```
