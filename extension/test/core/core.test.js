"use strict";
// The core must be usable outside VS Code: these tests never install the
// `vscode` stub, so any accidental import would fail at require time.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { makeGitRepo } = require("../helpers");

const core = require("../../out/core");
const {
  collectCommits,
  repoSlug,
} = require("../../out/core/gather/git");
const {
  contextToText,
  capActivity,
  aggregateTouches,
} = require("../../out/core/gather/activity");
const { buildPrompt, DETAIL_LEVELS } = require("../../out/core/prompt");

function ctx(overrides = {}) {
  return {
    since: new Date("2026-11-07T00:00:00.000Z"),
    until: new Date("2026-11-07T23:59:59.000Z"),
    commits: [],
    touches: [],
    github: [],
    cursorPrompts: [],
    ...overrides,
  };
}

test("core index loads without a vscode module", () => {
  assert.equal(typeof core.buildPrompt, "function");
  assert.equal(typeof core.collectCommits, "function");
  assert.equal(typeof core.verifyClaims, "function");
});

test("core collectCommits reads a temp repo with folder refs", async () => {
  const { dir } = makeGitRepo();
  const now = Date.now();
  const commits = await collectCommits(
    [{ name: "demo", path: dir }],
    new Date(now - 3600e3),
    new Date(now + 60e3),
  );
  assert.equal(commits.length, 2);
  assert.equal(commits[0].repo, "acme/demo");
  assert.ok(commits.every((c) => c.hash.length === 8));
  assert.equal(await repoSlug(dir), "acme/demo");
});

test("core activity rendering scales with detail and renders metadata", () => {
  const base = ctx({
    commits: [
      {
        hash: "abc12345",
        date: "2026-11-07T10:00:00.000Z",
        subject: "feat: add health endpoint",
        body: "Adds /health.",
        repo: "acme/demo",
        files: ["src/a.ts", "src/b.ts"],
      },
    ],
    touches: [
      {
        file: "src/a.ts",
        project: "demo",
        lang: "typescript",
        saves: 2,
        edits: 1,
        lastTs: "2026-11-07T10:00:00.000Z",
      },
    ],
  });
  const concise = contextToText(base, "concise");
  assert.match(concise, /BEGIN UNTRUSTED ACTIVITY/);
  assert.match(concise, /add health endpoint/);
  assert.doesNotMatch(concise, /files: src\/a\.ts/);

  const elaborate = contextToText(base, "elaborate");
  assert.match(elaborate, /files: src\/a\.ts, src\/b\.ts/);
});

test("core capActivity dedupes commits and reports truncation", () => {
  const commits = Array.from({ length: 30 }, (_, i) => ({
    hash: `h${i}`,
    date: `2026-11-07T10:${String(i).padStart(2, "0")}:00.000Z`,
    subject: `commit ${i}`,
    body: "",
    repo: "acme/demo",
    files: [],
  }));
  const capped = capActivity(ctx({ commits }));
  assert.equal(capped.commits.length, 25);
  assert.equal(capped.truncated.commits, 30);
});

test("core aggregateTouches counts saves and edits", () => {
  const touches = aggregateTouches([
    { ts: "2026-11-07T10:00:00Z", type: "save", file: "a.ts", lang: "ts", project: "p" },
    { ts: "2026-11-07T10:01:00Z", type: "edit", file: "a.ts", lang: "ts", project: "p" },
    { ts: "2026-11-07T10:02:00Z", type: "save", file: "a.ts", lang: "ts", project: "p" },
  ]);
  assert.equal(touches.length, 1);
  assert.equal(touches[0].saves, 2);
  assert.equal(touches[0].edits, 1);
});

test("core buildPrompt applies detail and tone without VS Code", () => {
  const prompt = buildPrompt(
    ctx({
      commits: [
        {
          hash: "abc12345",
          date: "2026-11-07T10:00:00.000Z",
          subject: "feat: add health endpoint",
          body: "",
          repo: "acme/demo",
          files: ["src/a.ts"],
        },
      ],
    }),
    { detail: "elaborate", tone: "senior" },
  );
  assert.match(prompt, /### <Theme title> \[feature\]/);
  assert.match(prompt, /senior engineer/);
  assert.match(prompt, /add health endpoint/);
  assert.equal(DETAIL_LEVELS.elaborate.predict, 1600);
});
