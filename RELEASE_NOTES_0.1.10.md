# Shiplogue 0.1.10

## New panel
- Rendered **Preview** by default, with raw Markdown and Plain-text modes.
- Verification strip: "N claims verified · M removed · K inferred", with a
  "What was checked?" details list. Needs-review drafts highlight unverified
  claims inline.
- Model chip, generation stats in the status bar, inline Detail/Tone.
- **Draft history tab:** search, day grouping, per-draft state, preview, copy and
  restore. Local retention is 7 days (`shiplogue.history.retentionDays`).

## Sending (Pro, via Shiplogue Cloud)
- **Send** asks Shiplogue Cloud to post the stand-up to your workspace's
  Slack/Discord/Teams targets. Scheduled posting is configured in the dashboard.
- Free workspaces are prompted to upgrade instead of failing silently.

## Feedback
- One polite question per version after a few drafts, a star nudge after 👍, and
  three commands: Share Feedback, Star on GitHub, Rate on the Marketplace.

## Fixes
- Weekly recap now reads from stored daily drafts (no model call).

SHA-256: `7ec3c4ecf8b0be5871a34b38a2af13fbc56ac00cf1f5e7ad5e107e32611d03a0`  `shiplogue-0.1.8.vsix`

