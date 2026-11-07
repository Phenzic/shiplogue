const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../dist/agent/src/core");

test("the agent build contains the shared core", () => {
  assert.equal(typeof core.buildPrompt, "function");
  assert.equal(typeof core.contextToText, "function");
  assert.equal(typeof core.verifyClaims, "function");
  assert.equal(typeof core.parseStandupDocument, "function");
  assert.equal(typeof core.DETAIL_LEVELS.standard.predict, "number");
});

test("the shared core renders activity without VS Code", () => {
  const ctx = {
    since: new Date("2026-11-07T00:00:00.000Z"),
    until: new Date("2026-11-07T23:59:59.000Z"),
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
    touches: [],
    github: [],
    cursorPrompts: [],
  };
  const text = core.contextToText(ctx, "standard");
  assert.match(text, /add health endpoint/);
  assert.match(text, /BEGIN UNTRUSTED ACTIVITY/);

  const prompt = core.buildPrompt(ctx, { detail: "standard", tone: "neutral" });
  assert.match(prompt, /### <Theme title> \[feature\]/);
});
