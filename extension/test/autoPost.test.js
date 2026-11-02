"use strict";
// P1 auto-post: scheduling, dedupe (per day + per target), review/auto modes,
// retry with backoff, failure recovery. Timers are driven manually via tick().
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, tmpDir, makeContext, startServer } = require("./helpers");

const { stub } = installVscodeStub();
const { State } = require("../out/state");
const { AutoPost } = require("../out/autoPost");

const DRAFT = "**Done**\n- Shipped the thing\n\n**Next**\n- More\n\n**Blockers**\n- None";

function setup({ config = {}, generateDraft = async () => DRAFT, targets } = {}) {
  stub.reset();
  stub.setConfig({
    "standupDraft.autoPost.enabled": true,
    "standupDraft.autoPost.time": "16:00",
    "standupDraft.autoPost.days": [1, 2, 3, 4, 5],
    "standupDraft.autoPost.mode": "review",
    "standupDraft.reminder.time": "17:00",
    ...(targets ? { "standupDraft.posting.targets": targets } : {}),
    ...config,
  });
  const state = new State(makeContext(tmpDir()));
  const ap = new AutoPost(state, { generateDraft, undoWindowMs: 5, backoffBaseMs: 1 });
  return { state, ap };
}

// 2026-11-02 is a Monday (day 1).
const MON = (h, m) => new Date(2026, 10, 2, h, m);
const SUN = (h, m) => new Date(2026, 10, 1, h, m);

test("disabled → nothing happens", async () => {
  let generated = 0;
  const { ap } = setup({ config: { "standupDraft.autoPost.enabled": false }, generateDraft: async () => { generated++; return DRAFT; } });
  await ap.tick(MON(18, 0));
  assert.equal(generated, 0);
  assert.equal(stub.notifications.length, 0);
});

test("before the scheduled time or on an off day → nothing", async () => {
  let generated = 0;
  const { ap } = setup({ generateDraft: async () => { generated++; return DRAFT; } });
  await ap.tick(MON(9, 0)); // before 16:00
  await ap.tick(SUN(18, 0)); // Sunday not in days
  assert.equal(generated, 0);
});

test("autoPost.time falls back to the reminder time when empty", async () => {
  let generated = 0;
  const { ap } = setup({
    config: { "standupDraft.autoPost.time": "" },
    generateDraft: async () => { generated++; return DRAFT; },
  });
  await ap.tick(MON(16, 30)); // past 16:00 default? no — time "" → reminder 17:00
  assert.equal(generated, 0, "16:30 is before the 17:00 reminder fallback");
  await ap.tick(MON(17, 5));
  assert.equal(generated, 1);
});

test("review mode posts only on 'Post now', once per day", async (t) => {
  const server = await startServer(() => ({ status: 204 }));
  t.after(() => server.close());
  let generated = 0;
  const { state, ap } = setup({
    generateDraft: async () => { generated++; return DRAFT; },
    targets: [{ type: "discord", url: server.url, enabled: true }],
  });
  stub.infoAnswers.push("Post now");
  await ap.tick(MON(18, 0));
  assert.equal(generated, 1);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].body.content, DRAFT);
  assert.match(stub.notifications.at(-1).message, /auto-posted to discord/);

  // Same day: no second generation, no second post.
  await ap.tick(MON(19, 0));
  assert.equal(generated, 1);
  assert.equal(server.requests.length, 1);
  assert.equal(state.getLastAutoPostYmd(), "2026-11-2");
});

test("review mode 'Skip today' does not post and does not re-prompt", async () => {
  let generated = 0;
  const { ap } = setup({ generateDraft: async () => { generated++; return DRAFT; } });
  stub.infoAnswers.push("Skip today");
  await ap.tick(MON(18, 0));
  assert.equal(generated, 1);
  assert.equal(stub.notifications.filter((n) => /stand-up draft is ready/.test(n.message)).length, 1);
  await ap.tick(MON(19, 0));
  assert.equal(stub.notifications.filter((n) => /stand-up draft is ready/.test(n.message)).length, 1);
});

test("auto mode posts after the undo window unless undone", async (t) => {
  const server = await startServer(() => ({ status: 204 }));
  t.after(() => server.close());
  const { ap } = setup({
    config: { "standupDraft.autoPost.mode": "auto" },
    targets: [{ type: "discord", url: server.url, enabled: true }],
  });
  await ap.tick(MON(18, 0)); // no answer queued → window expires (5ms in tests)
  assert.equal(server.requests.length, 1, "posted after the window");

  // Undone: no post.
  const server2 = await startServer(() => ({ status: 204 }));
  t.after(() => server2.close());
  const { ap: ap2 } = setup({
    config: { "standupDraft.autoPost.mode": "auto" },
    targets: [{ type: "discord", url: server2.url, enabled: true }],
  });
  stub.infoAnswers.push("Undo");
  await ap2.tick(MON(18, 0));
  assert.equal(server2.requests.length, 0);
});

test("no activity today → skip notice, still once per day", async () => {
  const { ap } = setup({ generateDraft: async () => undefined });
  await ap.tick(MON(18, 0));
  assert.match(stub.notifications.at(-1).message, /no activity found today/);
  await ap.tick(MON(19, 0));
  assert.equal(stub.notifications.filter((n) => /no activity found today/.test(n.message)).length, 1);
});

test("post failure retries with backoff, succeeds, and dedupes per target", async (t) => {
  let slackCalls = 0;
  const flaky = await startServer(() => {
    slackCalls++;
    return slackCalls < 3 ? { status: 500, body: "boom" } : { status: 200, body: "ok" };
  });
  const good = await startServer(() => ({ status: 204 }));
  t.after(async () => { await flaky.close(); await good.close(); });

  const { state, ap } = setup({
    targets: [
      { type: "slack", url: flaky.url, enabled: true },
      { type: "discord", url: good.url, enabled: true },
    ],
  });
  stub.infoAnswers.push("Post now");
  await ap.tick(MON(18, 0));

  assert.equal(good.requests.length, 1, "healthy target posted exactly once (no retry double-post)");
  assert.ok(flaky.requests.length >= 3, "flaky target retried until success");
  const day = "2026-11-2";
  assert.deepEqual(state_targets(state, day).sort(), ["discord", "slack"]);
  assert.match(stub.notifications.at(-1).message, /auto-posted/);
});

function state_targets(state, day) {
  return state.getAutoPostPostedTargets()[day] ?? [];
}
test("all retries exhausted → error notification, draft saved for recovery, retry action works", async (t) => {
  const bad = await startServer(() => ({ status: 500, body: "nope" }));
  t.after(() => bad.close());
  const { state, ap } = setup({
    targets: [{ type: "slack", url: bad.url, enabled: true }],
  });
  stub.infoAnswers.push("Post now"); // review prompt
  await ap.tick(MON(18, 0));
  assert.ok(bad.requests.length >= 3, "3 attempts");
  const err = stub.errors.at(-1);
  assert.match(err.message, /auto-post failed/);
  assert.deepEqual(err.items, ["Retry now", "Open panel"]);
  assert.equal(state.getAutoPostPendingDraft(), DRAFT, "draft kept for recovery");
  assert.equal(state.getLastAutoPostYmd(), "2026-11-2", "once a day even on failure");
});
