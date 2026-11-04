"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { estimateTokens, trimForBudget, ContextBudgetError } = require("../out/model/budget");

function ctx(commits = 20) {
  return {
    since: new Date(0),
    until: new Date(),
    commits: Array.from({ length: commits }, (_, i) => ({
      hash: `h${i}`,
      date: "",
      subject: `change ${i} `.repeat(20),
      body: "body ".repeat(100),
      repo: "a/b",
      files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"],
    })),
    touches: Array.from({ length: 30 }, (_, i) => ({ file: `f${i}.ts`, project: "p", lang: "ts", saves: 1, edits: 3, lastTs: "" })),
    github: Array.from({ length: 30 }, (_, i) => ({ kind: "pr", number: i, title: `pr ${i}`, url: `https://github.com/a/b/pull/${i}`, repo: "a/b", closedAt: "" })),
    cursorPrompts: Array.from({ length: 25 }, (_, i) => ({ ts: String(i), text: "prompt ".repeat(50) })),
  };
}

test("estimateTokens is conservative and monotonic", () => {
  assert.ok(estimateTokens("x".repeat(360)) > 100);
  assert.ok(estimateTokens("x".repeat(720)) > estimateTokens("x".repeat(360)));
});

test("under-budget prompts are not trimmed", () => {
  const c = ctx(1);
  const out = trimForBudget(c, (x) => JSON.stringify(x.commits[0].hash), 10000);
  assert.equal(out.report.dropped.commits, 0);
  assert.ok(out.report.estimated <= 10000);
});

test("heavy activity is trimmed until it fits and reports what was dropped", () => {
  const c = ctx();
  const out = trimForBudget(c, (x) => JSON.stringify(x), 500);
  assert.ok(out.report.estimated <= 500, `${out.report.estimated} > 500`);
  assert.ok(out.report.dropped.commits > 0 || out.report.dropped.prompts > 0 || out.report.dropped.github > 0);
});

test("a tiny budget refuses instead of sending an over-budget prompt", () => {
  assert.throws(() => trimForBudget(ctx(), (x) => JSON.stringify(x), 1), ContextBudgetError);
});
