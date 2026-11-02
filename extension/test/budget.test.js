"use strict";
// R7 context preflight: token estimation, priority trimming, refusal at the
// minimum, and the no-over-budget-prompt guarantee.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, startServer } = require("./helpers");

const { stub } = installVscodeStub();
const { estimateTokens, planPrompt, ContextBudgetError } = require("../out/model/budget");
const { generateStandup } = require("../out/summarize");
const { setDetailGetter, setToneGetter } = require("../out/config");
const { contextToText, detailDefaults } = require("../out/gather");

function heavyCtx() {
  const now = new Date().toISOString();
  return {
    since: new Date(Date.now() - 24 * 3600e3),
    until: new Date(),
    commits: Array.from({ length: 40 }, (_, i) => ({
      hash: `h${String(i).padStart(2, "0")}`,
      date: now,
      subject: `feat(area${i}): change number ${i}`,
      body: "Explains the reasoning at some length. ".repeat(8),
      repo: "acme/web",
      files: Array.from({ length: 12 }, (_, j) => `src/area${i}/file${j}.ts`),
    })),
    touches: Array.from({ length: 25 }, (_, i) => ({
      file: `src/work${i}.ts`,
      project: "web",
      lang: "typescript",
      saves: 3,
      edits: 1,
      lastTs: now,
    })),
    github: [],
    cursorPrompts: Array.from({ length: 60 }, (_, i) => ({
      ts: now,
      text: `prompt ${i}: ` + "please help me refactor this module and explain the approach in detail ".repeat(3).slice(0, 260),
    })),
  };
}

const measure = (ctx, fmt) => contextToText(ctx, fmt); // prompt-less: template overhead is constant

test.beforeEach(() => {
  stub.reset();
  setDetailGetter(() => "elaborate");
  setToneGetter(() => "neutral");
});

test("estimateTokens is conservative and monotonic", () => {
  assert.ok(estimateTokens("abcd") >= 1);
  assert.ok(estimateTokens("x".repeat(3600)) > estimateTokens("x".repeat(36)));
  assert.ok(estimateTokens("a\nb\nc") > estimateTokens("abc"));
});

test("heavy day is trimmed to fit and reports what was dropped", () => {
  const ctx = heavyCtx();
  const plan = planPrompt(ctx, {
    contextTokens: 8192,
    maxOutputTokens: 1600,
    defaults: detailDefaults("elaborate"),
    measure,
  });
  assert.ok(plan.report.estimated <= plan.report.budget, `estimated ${plan.report.estimated} <= ${plan.report.budget}`);
  assert.ok(plan.report.steps.length > 0, "trim steps were reported");
  assert.ok(plan.report.dropped.cursorPrompts > 0, "prompts were compacted");
  assert.ok(plan.ctx.cursorPrompts.length <= 20);
});

test("under-budget input is untouched (no false trimming)", () => {
  const ctx = heavyCtx();
  const plan = planPrompt(ctx, {
    contextTokens: 128000,
    maxOutputTokens: 1600,
    defaults: detailDefaults("elaborate"),
    measure,
  });
  assert.deepEqual(plan.report.steps, []);
  assert.equal(plan.ctx.commits.length, 40);
  assert.equal(plan.ctx.cursorPrompts.length, 60);
});

test("a tiny context refuses with an actionable error and never measures a backend", () => {
  assert.throws(
    () =>
      planPrompt(heavyCtx(), {
        contextTokens: 2048,
        maxOutputTokens: 1600,
        defaults: detailDefaults("elaborate"),
        measure,
      }),
    (e) =>
      e instanceof ContextBudgetError &&
      /too large for the model's context window/.test(e.message) &&
      /contextTokens/.test(e.message),
  );
});

test("generateStandup never sends an over-budget prompt (elaborate heavy day)", async () => {
  const server = await startServer(() => ({
    body: {
      response: "**Done**\n- Updated the health endpoint.\n\n**Next**\n- Keep going.\n\n**Blockers**\n- None",
    },
  }));
  stub.setConfig({
    "shiplogue.ollama.url": server.url,
    "shiplogue.ollama.model": "m",
    "shiplogue.ollama.numCtx": 8192,
  });
  try {
    let reported;
    const out = await generateStandup(heavyCtx(), undefined, (r) => (reported = r));
    const sent = server.requests[0].body.prompt;
    const budget = 8192 - 1600 - 256;
    assert.ok(
      estimateTokens(sent) <= budget,
      `sent prompt ~${estimateTokens(sent)} tokens must fit ${budget}`,
    );
    assert.ok(reported.steps.length > 0);
    assert.ok(out.budget, "budget report surfaces in the result");
    assert.equal(out.budget.steps, reported.steps);
  } finally {
    await server.close();
  }
});

test("generateStandup refuses (no backend call) when nothing fits", async () => {
  const server = await startServer(() => ({ body: { response: "x" } }));
  stub.setConfig({
    "shiplogue.ollama.url": server.url,
    "shiplogue.ollama.model": "m",
    "shiplogue.ollama.numCtx": 2048,
  });
  try {
    await assert.rejects(generateStandup(heavyCtx()), (e) => e instanceof ContextBudgetError);
    assert.equal(server.requests.length, 0, "backend never called");
  } finally {
    await server.close();
  }
});
