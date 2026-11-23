const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildInstructions } = require("../dist/extension/src/core/prompt");

const SKILL = path.join(
  __dirname,
  "..",
  "..",
  "plugins",
  "shiplogue",
  "skills",
  "daily",
  "SKILL.md",
);

test("the Claude skill is generated from the shared core instructions", () => {
  const skill = fs.readFileSync(SKILL, "utf8");
  const expected = buildInstructions({ detail: "standard", tone: "neutral" });
  assert.ok(skill.includes(expected), "run npm run sync:skill");
  assert.ok(skill.includes("Generated from extension/src/core/prompt.ts"));
  assert.ok(!skill.includes("activity below"));
  assert.ok(skill.includes("call save_standup exactly once"));
  assert.ok(skill.includes("do not rewrite and save again"));
});
