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
de9fa8e132c2529959a36e35c0409a7082468bb0e23393fcf395bd5b268b4302
```
