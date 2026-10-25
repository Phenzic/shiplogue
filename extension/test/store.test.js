"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { installVscodeStub, tmpDir, makeContext } = require("./helpers");

installVscodeStub();
const { Store } = require("../out/store");

function event(ts, file = "src/a.ts") {
  return { ts, type: "save", file, lang: "typescript", project: "proj" };
}

test("add + flush writes one local-day JSON file", () => {
  const dir = tmpDir();
  const store = new Store(makeContext(dir));
  const now = new Date();
  store.add(event(now.toISOString()));
  store.add(event(now.toISOString(), "src/b.ts"));
  store.flush();

  const files = fs.readdirSync(path.join(dir, "activity"));
  assert.equal(files.length, 1);
  assert.match(files[0], /^activity-\d{4}-\d{2}-\d{2}\.json$/);

  const events = store.readRange(new Date(now.getTime() - 3600e3), new Date(now.getTime() + 60e3));
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.file).sort(), ["src/a.ts", "src/b.ts"]);
});

test("flush with an empty buffer is a no-op and creates no files", () => {
  const dir = tmpDir();
  const store = new Store(makeContext(dir));
  store.flush();
  assert.deepEqual(fs.readdirSync(path.join(dir, "activity")), []);
});

test("readRange excludes events outside the window", () => {
  const dir = tmpDir();
  const store = new Store(makeContext(dir));
  const base = Date.now();
  store.add(event(new Date(base - 10 * 3600e3).toISOString())); // 10h ago
  store.add(event(new Date(base - 2 * 3600e3).toISOString())); // 2h ago
  store.flush();

  const inWindow = store.readRange(new Date(base - 3 * 3600e3), new Date(base));
  assert.equal(inWindow.length, 1);
  const outside = store.readRange(new Date(base - 20 * 3600e3), new Date(base - 15 * 3600e3));
  assert.equal(outside.length, 0);
});

test("events straddling midnight land in two day files and both are read back", () => {
  const dir = tmpDir();
  const store = new Store(makeContext(dir));

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const before = new Date(midnight.getTime() - 30e3); // 23:59:30 yesterday
  const after = new Date(midnight.getTime() + 30e3); // 00:00:30 today

  store.add(event(before.toISOString(), "night.ts"));
  store.add(event(after.toISOString(), "morning.ts"));
  store.flush();

  const files = fs.readdirSync(path.join(dir, "activity")).sort();
  assert.equal(files.length, 2);
  const read = store.readRange(new Date(before.getTime() - 1000), new Date(after.getTime() + 1000));
  assert.deepEqual(read.map((e) => e.file).sort(), ["morning.ts", "night.ts"]);
});

test("a corrupt day file degrades to no events instead of throwing", () => {
  const dir = tmpDir();
  const store = new Store(makeContext(dir));
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  fs.writeFileSync(path.join(dir, "activity", `activity-${key}.json`), "{not json", "utf8");

  assert.doesNotThrow(() => store.readRange(new Date(now.getTime() - 3600e3), new Date(now.getTime() + 60e3)));
  assert.deepEqual(store.readRange(new Date(now.getTime() - 3600e3), new Date(now.getTime() + 60e3)), []);
});

test("a day spanning a DST-free multi-day window reads every day", () => {
  const dir = tmpDir();
  const store = new Store(makeContext(dir));
  const now = new Date();
  store.add(event(now.toISOString()));
  store.flush();
  const read = store.readRange(new Date(now.getTime() - 48 * 3600e3), new Date(now.getTime() + 60e3));
  assert.equal(read.length, 1);
});

test("a failed write re-queues events into the next successful flush (no lost events)", () => {
  const dir = tmpDir();
  const ctx = makeContext(dir);
  const store = new Store(ctx);
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dayFile = path.join(dir, "activity", `activity-${key}.json`);

  // Force the rename to fail: the day file's path is a directory.
  fs.mkdirSync(dayFile, { recursive: true });
  store.add(event(now.toISOString(), "src/keep-me.ts"));
  store.flush();
  assert.equal(
    fs.readdirSync(path.join(dir, "activity")).filter((f) => f.endsWith(".tmp")).length,
    0,
    "no temp file left behind after a failed write",
  );

  // Fix the disk problem; the buffered events survive into the next flush.
  fs.rmdirSync(dayFile);
  store.flush();
  const events = store.readRange(new Date(now.getTime() - 3600e3), new Date(now.getTime() + 60e3));
  assert.deepEqual(events.map((e) => e.file), ["src/keep-me.ts"]);
});

test("a successful flush leaves no .tmp files behind", () => {
  const dir = tmpDir();
  const store = new Store(makeContext(dir));
  store.add(event(new Date().toISOString()));
  store.flush();
  assert.deepEqual(
    fs.readdirSync(path.join(dir, "activity")).filter((f) => f.endsWith(".tmp")),
    [],
  );
});

test("retention deletes day files older than the window and keeps recent ones", () => {
  const dir = tmpDir();
  const store = new Store(makeContext(dir));
  const actDir = path.join(dir, "activity");
  fs.writeFileSync(path.join(actDir, "activity-2020-01-01.json"), "[]");
  fs.writeFileSync(path.join(actDir, "activity-2020-02-01.json"), "[]");
  const recent = new Date();
  const recentKey = `${recent.getFullYear()}-${String(recent.getMonth() + 1).padStart(2, "0")}-${String(recent.getDate()).padStart(2, "0")}`;
  fs.writeFileSync(path.join(actDir, `activity-${recentKey}.json`), "[]");
  fs.writeFileSync(path.join(actDir, "not-an-activity-file.json"), "[]");

  const removed = store.pruneOld(14);
  assert.equal(removed, 2);
  const left = fs.readdirSync(actDir).sort();
  assert.deepEqual(left, [`activity-${recentKey}.json`, "not-an-activity-file.json"]);
});

test("retentionDays=0 keeps every file", () => {
  const dir = tmpDir();
  const store = new Store(makeContext(dir));
  const actDir = path.join(dir, "activity");
  fs.writeFileSync(path.join(actDir, "activity-2020-01-01.json"), "[]");
  assert.equal(store.pruneOld(0), 0);
  assert.deepEqual(fs.readdirSync(actDir), ["activity-2020-01-01.json"]);
});
