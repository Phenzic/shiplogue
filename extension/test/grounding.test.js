"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verifyClaims } = require("../out/grounding");

const ctx = (over = {}) => ({
  since: new Date(0),
  until: new Date(),
  commits: [],
  touches: [],
  github: [],
  cursorPrompts: [],
  ...over,
});

test("invented URLs are removed; activity URLs survive", () => {
  const c = ctx({
    github: [{ kind: "pr", number: 1, title: "Login", url: "https://github.com/a/b/pull/1", repo: "a/b", closedAt: "" }],
  });
  const draft = "- See https://github.com/a/b/pull/1 and https://example.com/fake for details";
  const v = verifyClaims(draft, c);
  assert.match(v.cleanDraft, /github\.com\/a\/b\/pull\/1/);
  assert.doesNotMatch(v.cleanDraft, /example\.com/);
  assert.ok(v.violations.some((x) => x.kind === "url"));
});

test("unsupported completion verbs are flagged, not silently cleaned", () => {
  const v = verifyClaims("- Shipped the new onboarding flow", ctx());
  assert.equal(v.needsReview, true);
  assert.ok(v.violations.some((x) => x.kind === "completion"));
  assert.match(v.cleanDraft, /Shipped/);
});

test("completion verbs are accepted when commit evidence exists", () => {
  const v = verifyClaims(
    "- Shipped the new onboarding flow",
    ctx({ commits: [{ hash: "abc", date: "", subject: "feat: onboarding", body: "", repo: "a/b", files: ["a.ts"] }] }),
  );
  assert.equal(v.needsReview, false);
});

test("inferred bullets are exempt from completion verification", () => {
  const v = verifyClaims("- (inferred) Ship the onboarding flow next", ctx());
  assert.equal(v.needsReview, false);
});

test("path/number grounding still removes invented mentions", () => {
  const v = verifyClaims("- Updated README.md and fixed #99", ctx());
  assert.doesNotMatch(v.cleanDraft, /README\.md/);
  assert.doesNotMatch(v.cleanDraft, /#99/);
  assert.ok(v.violations.some((x) => x.kind === "path"));
  assert.ok(v.violations.some((x) => x.kind === "number"));
});
