"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, tmpDir, makeContext, ymd } = require("./helpers");

const { stub } = installVscodeStub();
const { State } = require("../out/state");
const { Reminder } = require("../out/reminder");

function setup(config = {}) {
  stub.reset();
  const ctx = makeContext(tmpDir());
  const state = new State(ctx);
  stub.setConfig({
    "shiplogue.reminder.enabled": true,
    "shiplogue.reminder.time": "00:00",
    ...config,
  });
  return { ctx, state, reminder: undefined };
}

// Capture the 60s interval so tick() is driven manually.
function captureTimer() {
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  let tick;
  let cleared = false;
  global.setInterval = (fn, ms) => {
    tick = fn;
    assert.equal(ms, 60_000);
    return { unref() {} };
  };
  global.clearInterval = () => {
    cleared = true;
  };
  return {
    tick: () => tick(),
    wasCleared: () => cleared,
    restore: () => {
      global.setInterval = realSetInterval;
      global.clearInterval = realClearInterval;
    },
  };
}

const settle = () => new Promise((r) => setImmediate(r));

test("reminder fires once after the configured time and marks the day", async () => {
  const { state } = setup();
  const timer = captureTimer();
  const fired = [];
  const reminder = new Reminder(state, () => fired.push("generate"));
  try {
    reminder.start(); // immediate first tick + interval
    await settle();
    assert.equal(stub.notifications.length, 1);
    assert.match(stub.notifications[0].message, /Time to send your stand-up/);
    assert.deepEqual(stub.notifications[0].items, ["Generate now", "Snooze 1h"]);
    assert.equal(state.getLastReminderYmd(), ymd());

    timer.tick();
    await settle();
    assert.equal(stub.notifications.length, 1, "does not re-fire the same day");
  } finally {
    reminder.dispose();
    timer.restore();
  }
});

test("'Generate now' runs the generate callback", async () => {
  const { state } = setup();
  const timer = captureTimer();
  let generated = 0;
  const reminder = new Reminder(state, () => generated++);
  stub.infoAnswers.push("Generate now");
  try {
    reminder.start();
    await settle();
    assert.equal(generated, 1);
  } finally {
    reminder.dispose();
    timer.restore();
  }
});

test("'Snooze 1h' suppresses the reminder and lets it fire again afterwards", async () => {
  const { state } = setup();
  const timer = captureTimer();
  const reminder = new Reminder(state, () => {});
  stub.infoAnswers.push("Snooze 1h");
  try {
    reminder.start();
    await settle();
    assert.equal(stub.notifications.length, 1);
    assert.equal(state.getLastReminderYmd(), "", "snooze clears the day marker");

    timer.tick();
    await settle();
    assert.equal(stub.notifications.length, 1, "snoozed, so no second toast");

    reminder.snoozeUntil = 0; // simulate the hour elapsing
    timer.tick();
    await settle();
    assert.equal(stub.notifications.length, 2, "fires again after the snooze");
  } finally {
    reminder.dispose();
    timer.restore();
  }
});

test("before the configured time nothing fires", async () => {
  const now = new Date();
  if (now.getHours() >= 23) {
    return; // would wrap; not meaningful at 23:xx
  }
  const later = `${String(now.getHours() + 1).padStart(2, "0")}:59`;
  const { state } = setup({ "shiplogue.reminder.time": later });
  const timer = captureTimer();
  const reminder = new Reminder(state, () => {});
  try {
    reminder.start();
    await settle();
    assert.equal(stub.notifications.length, 0);
    assert.equal(state.getLastReminderYmd(), "");
  } finally {
    reminder.dispose();
    timer.restore();
  }
});

test("a disabled reminder never fires", async () => {
  const { state } = setup({ "shiplogue.reminder.enabled": false });
  const timer = captureTimer();
  const reminder = new Reminder(state, () => {});
  try {
    reminder.start();
    await settle();
    assert.equal(stub.notifications.length, 0);
  } finally {
    reminder.dispose();
    timer.restore();
  }
});

test("an already-notified day is not re-notified", async () => {
  const { state } = setup();
  await state.setLastReminderYmd(ymd());
  const timer = captureTimer();
  const reminder = new Reminder(state, () => {});
  try {
    reminder.start();
    await settle();
    assert.equal(stub.notifications.length, 0);
  } finally {
    reminder.dispose();
    timer.restore();
  }
});

test("dispose stops the timer", () => {
  const { state } = setup();
  const timer = captureTimer();
  const reminder = new Reminder(state, () => {});
  reminder.start();
  reminder.dispose();
  assert.equal(timer.wasCleared(), true);
  timer.restore();
});

test("pickTime validates 24h HH:MM and saves globally", async () => {
  const { state } = setup();
  stub.inputAnswers.push("18:30");
  const reminder = new Reminder(state, () => {});
  await reminder.pickTime("What time?");
  assert.equal(stub.config["shiplogue.reminder.time"], "18:30");
  assert.deepEqual(stub.configUpdates.at(-1), {
    key: "shiplogue.reminder.time",
    value: "18:30",
    target: 1,
  });
  const validate = stub.inputBoxes[0].validateInput;
  assert.equal(validate("09:05"), undefined);
  assert.equal(validate("23:59"), undefined);
  assert.equal(typeof validate("9:5"), "string");
  assert.equal(typeof validate("24:00"), "string");
  assert.equal(typeof validate("noon"), "string");
});

test("ensureSetup asks once on first run and records completion", async () => {
  const { state } = setup();
  stub.inputAnswers.push("09:15");
  const reminder = new Reminder(state, () => {});
  await reminder.ensureSetup();
  assert.equal(stub.inputBoxes.length, 1);
  assert.match(stub.inputBoxes[0].prompt, /nudge you to send your stand-up/);
  assert.equal(state.getLastReminderYmd(), "");
  assert.equal(state.isSetupDone(), true);

  await reminder.ensureSetup();
  assert.equal(stub.inputBoxes.length, 1, "second run does not ask again");
});

test("ensureSetup also marks setup done when the user cancels", async () => {
  const { state } = setup();
  const reminder = new Reminder(state, () => {});
  await reminder.ensureSetup();
  assert.equal(stub.inputBoxes.length, 1);
  assert.equal(state.isSetupDone(), true);
});
