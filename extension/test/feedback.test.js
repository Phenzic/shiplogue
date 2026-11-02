"use strict";
// Q2 feedback loop: counters, prompt policy (once per version, snooze,
// opt-out), thumbs routing, and URL hygiene (no activity content ever).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, tmpDir, makeContext } = require("./helpers");

const { stub } = installVscodeStub();
const { State } = require("../out/state");
const { Feedback, feedbackFormUrl, openFeedback, openRate, openStar } = require("../out/feedback");

function setup({ config = {}, version = "0.1.3-test" } = {}) {
  stub.reset();
  stub.setConfig({
    "shiplogue.feedback.enabled": true,
    "shiplogue.feedback.promptAfter": 3,
    ...config,
  });
  const ctx = makeContext(tmpDir(), version);
  const state = new State(ctx);
  return { state, feedback: new Feedback(state, version) };
}

test("the form URL carries version/os/backend only — never activity content", () => {
  const url = feedbackFormUrl({ version: "0.1.3", backend: "Ollama · llama3.2" });
  assert.match(url, /version=0\.1\.3/);
  assert.match(url, new RegExp(`os=${process.platform}`));
  assert.match(url, /backend=/);
  assert.doesNotMatch(url, /commit|draft|stand-up|file/);
});

test("recordSuccess increments the counter and prompts once after the threshold", async () => {
  const { state, feedback } = setup();
  await feedback.recordSuccess("Ollama · llama3.2");
  await feedback.recordSuccess("Ollama · llama3.2");
  assert.equal(state.getSuccessfulDrafts(), 2);
  assert.equal(stub.notifications.length, 0, "no prompt before the threshold");

  await feedback.recordSuccess("Ollama · llama3.2");
  assert.equal(stub.notifications.length, 1);
  assert.match(stub.notifications[0].message, /How's Shiplogue working for you/);
  assert.deepEqual(stub.notifications[0].items, ["Share feedback", "Not now", "Don't ask again"]);

  // Same version: no second prompt even past the threshold.
  await feedback.recordSuccess("Ollama · llama3.2");
  assert.equal(stub.notifications.length, 1, "once per version");
});

test("'Share feedback' opens the form; dismissal does not re-prompt this version", async () => {
  const { feedback } = setup();
  stub.infoAnswers.push("Share feedback");
  for (let i = 0; i < 3; i++) await feedback.recordSuccess("Ollama · llama3.2");
  assert.equal(stub.openedUrls.length, 1);
  assert.match(stub.openedUrls[0], /version=0\.1\.3-test/);
  await feedback.recordSuccess("Ollama · llama3.2");
  assert.equal(stub.notifications.length, 1);
  assert.equal(stub.openedUrls.length, 1);
});

test("'Not now' snoozes 30 days; the prompt returns only after the snooze", async () => {
  const { state, feedback } = setup();
  stub.infoAnswers.push("Not now");
  for (let i = 0; i < 3; i++) await feedback.recordSuccess("Ollama · llama3.2");
  assert.equal(stub.notifications.length, 1);
  assert.ok(state.getFeedbackSnoozedUntil() > Date.now() + 29 * 24 * 3600e3);

  await feedback.recordSuccess("Ollama · llama3.2");
  assert.equal(stub.notifications.length, 1, "snoozed");

  // Snooze expired → the prompt may return (same version).
  await state.setFeedbackSnoozedUntil(Date.now() - 1000);
  await feedback.recordSuccess("Ollama · llama3.2");
  assert.equal(stub.notifications.length, 2, "re-prompts after the snooze expires");
});

test("'Don't ask again' opts out permanently", async () => {
  const { state, feedback } = setup();
  stub.infoAnswers.push("Don't ask again");
  for (let i = 0; i < 3; i++) await feedback.recordSuccess("Ollama · llama3.2");
  assert.equal(state.getFeedbackOptOut(), true);
  await state.setFeedbackSnoozedUntil(0);
  await feedback.recordSuccess("Ollama · llama3.2");
  assert.equal(stub.notifications.length, 1, "no prompt after opt-out");
});

test("feedback.enabled=false suppresses the prompt but still counts", async () => {
  const { state, feedback } = setup({ config: { "shiplogue.feedback.enabled": false } });
  for (let i = 0; i < 5; i++) await feedback.recordSuccess("Ollama · llama3.2");
  assert.equal(state.getSuccessfulDrafts(), 5);
  assert.equal(stub.notifications.length, 0);
});

test("a new version re-arms the prompt", async () => {
  const { state, feedback } = setup({ version: "0.1.3" });
  for (let i = 0; i < 3; i++) await feedback.recordSuccess("Ollama · llama3.2");
  assert.equal(stub.notifications.length, 1);
  const next = new Feedback(state, "0.2.0");
  await next.recordSuccess("Ollama · llama3.2");
  assert.equal(stub.notifications.length, 2, "prompts again for the new version");
});

test("thumbs down opens the form; no counter or star prompt", async () => {
  const { state, feedback } = setup();
  await feedback.recordThumbs("down", "Ollama · llama3.2");
  assert.equal(stub.openedUrls.length, 1);
  assert.match(stub.openedUrls[0], /backend=Ollama/);
  assert.equal(state.getLastRating(), 0);
  assert.equal(stub.notifications.length, 0);
});

test("thumbs up counts and triggers the star prompt once per version", async () => {
  const { state, feedback } = setup();
  stub.infoAnswers.push("Star on GitHub");
  await feedback.recordThumbs("up", "Ollama · llama3.2");
  assert.equal(state.getLastRating(), 1);
  assert.equal(stub.notifications.length, 1);
  assert.match(stub.notifications[0].message, /a star helps others find it/);
  assert.deepEqual(stub.openedUrls, ["https://github.com/Phenzic/shiplogue"]);

  await feedback.recordThumbs("up", "Ollama · llama3.2");
  assert.equal(state.getLastRating(), 2);
  assert.equal(stub.notifications.length, 1, "star prompt once per version");
});

test("thumbs up 'Rate on Marketplace' opens the review page", async () => {
  const { feedback } = setup();
  stub.infoAnswers.push("Rate on Marketplace");
  await feedback.recordThumbs("up", "Ollama · llama3.2");
  assert.deepEqual(stub.openedUrls, [
    "https://marketplace.visualstudio.com/items?itemName=phenzic.shiplogue&ssr=false#review-details",
  ]);
});

test("explicit commands open the right URLs", async () => {
  setup();
  await openFeedback("0.1.3", "Ollama · llama3.2");
  await openStar();
  await openRate();
  assert.equal(stub.openedUrls.length, 3);
  assert.match(stub.openedUrls[0], /labels=feedback/);
  assert.equal(stub.openedUrls[1], "https://github.com/Phenzic/shiplogue");
  assert.match(stub.openedUrls[2], /marketplace\.visualstudio\.com/);
});
