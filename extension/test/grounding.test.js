"use strict";
// Grounding v2 (R6): claim taxonomy — paths, #numbers, URLs, dates/metrics,
// people, completion claims; inferred exemption; false-positive guardrails.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub } = require("./helpers");

installVscodeStub();
const { verify } = require("../out/grounding");

function ctx(overrides = {}) {
  return {
    commits: [
      {
        hash: "abc12345",
        date: new Date().toISOString(),
        subject: "feat(api): add health endpoint",
        body: "Adds /health. Bumps the client to v1.4. Paired with Amina on the probe.",
        repo: "acme/demo",
        files: ["src/health.ts"],
      },
    ],
    touches: [],
    github: [
      { kind: "pr", number: 41, title: "Add health endpoint", url: "https://github.com/acme/demo/pull/41", repo: "acme/demo" },
    ],
    cursorPrompts: [],
    ...overrides,
  };
}

test("supported claims of every kind pass untouched", () => {
  const draft = [
    "**Done**",
    "- Added the health endpoint in src/health.ts and merged #41: https://github.com/acme/demo/pull/41",
    "- Shipped the client bump to v1.4, paired with Amina",
    "",
    "**Next**",
    "- Keep going.",
    "",
    "**Blockers**",
    "- None",
  ].join("\n");
  const r = verify(draft, ctx());
  assert.equal(r.cleanDraft, draft);
  assert.deepEqual(r.violations, []);
  assert.ok(r.checkedClaims >= 4);
});

test("unsupported URL, date, metric and person are stripped", () => {
  const draft = [
    "**Done**",
    "- Added the health endpoint in src/health.ts",
    "- Shipped the release on 2026-03-14 to v9.9, paired with Beatriz — see https://staging.example.com/deploy",
    "",
    "**Next**",
    "- Keep going.",
    "",
    "**Blockers**",
    "- None",
  ].join("\n");
  const r = verify(draft, ctx());
  assert.doesNotMatch(r.cleanDraft, /2026-03-14/);
  assert.doesNotMatch(r.cleanDraft, /v9\.9/);
  assert.doesNotMatch(r.cleanDraft, /Beatriz/);
  assert.doesNotMatch(r.cleanDraft, /staging\.example\.com/);
  const kinds = r.violations.map((v) => v.kind).sort();
  // The leftover "Shipped the release — see" has no activity anchor either, so
  // the whole bullet is dropped as an ungrounded completion claim.
  assert.deepEqual(kinds, ["completion", "date", "metric", "person", "url"]);
});

test("dates and metrics in NON-completion bullets are left alone", () => {
  const draft = [
    "**Done**",
    "- Updated the health endpoint docs.",
    "",
    "**Next**",
    "- Draft the v1.5 rollout notes for 2026 planning.",
    "",
    "**Blockers**",
    "- None",
  ].join("\n");
  const r = verify(draft, ctx());
  assert.equal(r.cleanDraft, draft);
  assert.deepEqual(r.violations, []);
});

test("a completion claim with no activity anchor is dropped entirely", () => {
  const draft = [
    "**Done**",
    "- Added the health endpoint in src/health.ts.",
    "- Shipped the billing reconciliation pipeline.",
    "",
    "**Next**",
    "- Keep going.",
    "",
    "**Blockers**",
    "- None",
  ].join("\n");
  const r = verify(draft, ctx());
  assert.doesNotMatch(r.cleanDraft, /billing reconciliation/);
  assert.equal(r.violations.filter((v) => v.kind === "completion").length, 1);
  assert.match(r.cleanDraft, /health endpoint/);
});

test("inferred bullets keep their marker and skip completion verification", () => {
  const draft = [
    "**Done**",
    "- Added the health endpoint.",
    "",
    "**Next**",
    "- *(inferred)* Ship the probe to production next.",
    "",
    "**Blockers**",
    "- None",
  ].join("\n");
  const r = verify(draft, ctx());
  assert.equal(r.cleanDraft, draft);
  assert.equal(r.inferredCount, 1);
  assert.deepEqual(r.violations, []);
});

test("tech terms are not false positives (React, Slack, VS Code, CI)", () => {
  const c = ctx({
    commits: [
      {
        hash: "abc12345",
        date: new Date().toISOString(),
        subject: "fix: stabilize the React settings panel",
        body: "CI was flaking on the panel spec.",
        repo: "acme/demo",
        files: ["src/panel.tsx"],
      },
    ],
  });
  const draft = [
    "**Done**",
    "- Fixed the React settings panel in src/panel.tsx after the CI flake.",
    "",
    "**Next**",
    "- Keep going.",
    "",
    "**Blockers**",
    "- None",
  ].join("\n");
  const r = verify(draft, c);
  assert.equal(r.cleanDraft, draft, "anchored bullet mentioning tech terms survives");
  assert.deepEqual(r.violations, []);
});

test("@handle is allowed only when the handle appears in the activity", () => {
  const withMention = ctx({
    cursorPrompts: [{ ts: new Date().toISOString(), text: "review with @amina before posting" }],
  });
  const draft = "- Added the health endpoint with @amina and @ghost";
  const r = verify(draft, withMention);
  assert.doesNotMatch(r.cleanDraft, /@ghost/);
  assert.match(r.cleanDraft, /@amina/);
});
