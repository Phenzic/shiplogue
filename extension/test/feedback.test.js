"use strict";
// Feedback prompt policy + star nudge (all local counters).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, tmpDir, makeContext } = require("./helpers");

const { stub } = installVscodeStub();
const { State } = require("../out/state");
const { Feedback, openFeedback, openRate, openStar } = require("../out/feedback");

function setup({ config = {}, version = "0.1.10-test" } = {}) {
  stub.reset();
  stub.setConfig({
    "shiplogue.feedback.enabled": true,
    "shiplogue.feedback.promptAfter": 3,
    ...config,
  });
  const state = new State(makeContext(tmpDir(), version));
  return { state, fb: new Feedback(state, version) };
}

test("prompts once after the threshold, not before", async () => {
  const { state, fb } = setup();
  await fb.recordSuccess("Ollama");
  await fb.recordSuccess("Ollama");
  assert.equal(stub.notifications.length, 0);
  assert.equal(state.getSuccessfulDrafts(), 2);

  await fb.recordSuccess("Ollama");
  assert.equal(stub.notifications.length, 1);
  assert.match(stub.notifications[0].message, /How's Shiplogue working for you/);
  assert.deepEqual(stub.notifications[0].items, [
    "Share feedback",
    "Star on GitHub",
    "Not now",
    "Don't ask again",
  ]);

  await fb.recordSuccess("Ollama");
  assert.equal(stub.notifications.length, 1, "once per version");
});

test("'Share feedback' opens the form; a dismissal does not re-prompt", async () => {
  const { fb } = setup();
  stub.infoAnswers.push("Share feedback");
  for (let i = 0; i < 3; i++) await fb.recordSuccess("Ollama");
  assert.match(stub.openedUrls[0], /issues\/new.*feedback/);
  await fb.recordSuccess("Ollama");
  assert.equal(stub.notifications.length, 1);
});

test("'Star on GitHub' opens the repo and marks the star prompt done", async () => {
  const { state, fb } = setup();
  stub.infoAnswers.push("Star on GitHub");
  for (let i = 0; i < 3; i++) await fb.recordSuccess("Ollama");
  assert.equal(stub.openedUrls[0], "https://github.com/Phenzic/shiplogue");
  assert.equal(state.getStarPromptedVersion(), "0.1.10-test");
});

test("snooze suppresses for 30 days; opt-out is permanent", async () => {
  const { state, fb } = setup();
  stub.infoAnswers.push("Not now");
  for (let i = 0; i < 3; i++) await fb.recordSuccess("Ollama");
  assert.equal(stub.notifications.length, 1);
  assert.ok(state.getFeedbackSnoozedUntil() > Date.now() + 29 * 86400e3);

  await fb.recordSuccess("Ollama");
  assert.equal(stub.notifications.length, 1, "snoozed");

  // Snooze expires → the prompt returns, and "Don't ask again" opts out.
  await state.setFeedbackSnoozedUntil(Date.now() - 1000);
  stub.infoAnswers.push("Don't ask again");
  await fb.recordSuccess("Ollama");
  assert.equal(stub.notifications.length, 2, "re-prompts after the snooze expires");
  assert.equal(state.getFeedbackOptOut(), true);

  await state.setFeedbackSnoozedUntil(0);
  await fb.recordSuccess("Ollama");
  assert.equal(stub.notifications.length, 2, "no prompt after opting out");
});

test("a new version re-arms the prompt", async () => {
  const { state } = setup();
  const first = new Feedback(state, "0.1.10");
  for (let i = 0; i < 3; i++) await first.recordSuccess("Ollama");
  assert.equal(stub.notifications.length, 1);
  const next = new Feedback(state, "0.2.0");
  await next.recordSuccess("Ollama");
  assert.equal(stub.notifications.length, 2);
});

test("thumbs: 👎 opens the form; 👍 counts and asks for a star once", async () => {
  const { state, fb } = setup();
  await fb.recordThumbs("down", "Ollama");
  assert.match(stub.openedUrls[0], /feedback/);
  assert.equal(state.getThumbsUp(), 0);

  stub.infoAnswers.push("Star on GitHub");
  await fb.recordThumbs("up", "Ollama");
  assert.equal(state.getThumbsUp(), 1);
  assert.equal(stub.notifications.length, 1);
  assert.match(stub.notifications[0].message, /star on GitHub helps others/);
  assert.equal(stub.openedUrls[1], "https://github.com/Phenzic/shiplogue");

  await fb.recordThumbs("up", "Ollama");
  assert.equal(state.getThumbsUp(), 2);
  assert.equal(stub.notifications.length, 1, "star prompt once per version");
});

test("thumbs 'Rate on Marketplace' opens the review page", async () => {
  const { fb } = setup();
  stub.infoAnswers.push("Rate on Marketplace");
  await fb.recordThumbs("up", "Ollama");
  assert.match(stub.openedUrls[0], /marketplace\.visualstudio\.com/);
});

test("explicit commands open the right links", async () => {
  setup();
  await openFeedback();
  await openStar();
  await openRate();
  assert.equal(stub.openedUrls.length, 3);
  assert.match(stub.openedUrls[0], /issues\/new/);
  assert.equal(stub.openedUrls[1], "https://github.com/Phenzic/shiplogue");
  assert.match(stub.openedUrls[2], /marketplace\.visualstudio\.com/);
});
