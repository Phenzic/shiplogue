"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { installVscodeStub, tmpDir, makeContext } = require("./helpers");

installVscodeStub();
const { StandupStore, localDateKey } = require("../out/standupStore");

function at(daysAgo, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d;
}

test("saves generated stand-ups per local day and reads yesterday from memory", () => {
  const dir = tmpDir();
  const store = new StandupStore(makeContext(dir));
  const yesterday = at(1);
  const record = store.saveGenerated("# Yesterday draft", {
    workspaceId: "ws1",
    projectName: "demo",
  }, yesterday);

  assert.equal(record.date, localDateKey(yesterday));
  assert.equal(record.status, "generated");
  assert.equal(store.getYesterday("ws1", new Date()), record);
  assert.equal(store.getYesterday("other", new Date()), undefined);
  assert.deepEqual(fs.readdirSync(path.join(dir, "standups")), [
    `standups-${localDateKey(yesterday)}.json`,
  ]);
});

test("markReviewed replaces the draft with the final text", () => {
  const dir = tmpDir();
  const store = new StandupStore(makeContext(dir));
  store.saveGenerated("generated text", { workspaceId: "ws1" });
  const reviewed = store.markReviewed("edited final text", { workspaceId: "ws1" });

  assert.equal(reviewed.markdown, "edited final text");
  assert.equal(reviewed.status, "reviewed");
  assert.ok(reviewed.reviewedAt);
  assert.equal(store.get(localDateKey()).markdown, "edited final text");
});

test("keeps only the rolling local window and removes older day files", () => {
  const dir = tmpDir();
  const store = new StandupStore(makeContext(dir));
  const now = new Date();
  store.saveGenerated("old", {}, at(8, 9));
  store.saveGenerated("recent", {}, at(1, 9));
  const removed = store.pruneOld(7, now);
  assert.equal(removed, 1);
  const files = fs.readdirSync(path.join(dir, "standups"));
  assert.equal(files.length, 1);
});

test("recent returns newest first", () => {
  const dir = tmpDir();
  const store = new StandupStore(makeContext(dir));
  const now = new Date();
  store.saveGenerated("older", {}, at(2, 9));
  store.saveGenerated("newer", {}, at(1, 9));
  const recent = store.recent(7, now);
  assert.equal(recent[0].markdown, "newer");
  assert.equal(recent[1].markdown, "older");
});
