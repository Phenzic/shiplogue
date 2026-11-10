# Shiplogue 0.1.14

**Preview and stand-up formatting fixes.**

## Fixed

- Preview now recognizes untagged model headings such as `### feat: ...` and renders the structured UI instead of falling back to raw Markdown.
- `feat:` headings map to `feature`; fix, docs, refactor, test, security and related prefixes map to their tags.
- `files:` lines are parsed separately and no longer appear in the stand-up preview or copied Markdown/plain text. Files remain in Activity.
- The Preview tab shows the structured headline, sections, tags and details again.

## Notes

- Existing drafts generated with the malformed format may still display their stored Markdown until regenerated.
- Activity sync and cloud sync are unchanged.

## Checksums

SHA-256 for `shiplogue-0.1.14.vsix`:

```
ac8e85496d7682af5b3ab4c11ab840b2fdd0b155dda307446b814ff992837aa1
```
