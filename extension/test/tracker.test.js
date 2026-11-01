"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { installVscodeStub, tmpDir, makeContext } = require("./helpers");

const { stub } = installVscodeStub();
const { Store } = require("../out/store");
const { Tracker } = require("../out/tracker");

const ROOT = path.join("/tmp", "standup-tracker-ws");

function setup() {
  stub.reset();
  stub.setFolders([{ fsPath: ROOT, name: "proj" }]);
  const dir = tmpDir();
  const store = new Store(makeContext(dir));
  const tracker = new Tracker(store);
  tracker.start();
  const flush = () => store.flush();
  const read = () => store.readRange(new Date(Date.now() - 3600e3), new Date(Date.now() + 60e3));
  return { store, tracker, flush, read };
}

test("a save is recorded with project, relative path and language", () => {
  const { tracker, flush, read } = setup();
  stub.emitSave(stub.makeDoc(path.join(ROOT, "src/a.ts"), { languageId: "typescript" }));
  flush();
  const events = read();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "save");
  assert.equal(events[0].file, "src/a.ts");
  assert.equal(events[0].project, "proj");
  assert.equal(events[0].lang, "typescript");
  tracker.dispose();
});

test("edits are throttled to one heartbeat per file per 2 minutes", () => {
  const { tracker, flush, read } = setup();
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const doc = stub.makeDoc(path.join(ROOT, "src/b.ts"));
    stub.emitChange(doc);
    stub.emitChange(doc); // within throttle window
    flush();
    assert.deepEqual(read().map((e) => e.type), ["edit"]);

    now += 120_001; // just past the 2-minute throttle
    stub.emitChange(doc);
    flush();
    assert.deepEqual(read().map((e) => e.type), ["edit", "edit"]);

    // A different file has its own throttle bucket.
    stub.emitChange(stub.makeDoc(path.join(ROOT, "src/c.ts")));
    flush();
    assert.equal(read().length, 3);
  } finally {
    Date.now = realNow;
    tracker.dispose();
  }
});

test("noise paths are ignored", () => {
  const { tracker, flush, read } = setup();
  const noise = [
    "node_modules/react/index.js",
    ".git/COMMIT_EDITMSG",
    "dist/bundle.js",
    "out/extension.js",
    "build/main.js",
    ".next/server/page.js",
    "coverage/lcov.info",
  ];
  for (const rel of noise) {
    stub.emitSave(stub.makeDoc(path.join(ROOT, rel)));
  }
  flush();
  assert.deepEqual(read(), []);
  tracker.dispose();
});

test("untitled and non-file documents are ignored", () => {
  const { tracker, flush, read } = setup();
  stub.emitSave(stub.makeDoc(path.join(ROOT, "src/u.ts"), { isUntitled: true }));
  stub.emitSave(stub.makeDoc("/virtual/schema.graphql", { scheme: "vscode-notebook-cell" }));
  flush();
  assert.deepEqual(read(), []);
  tracker.dispose();
});

test("a document outside every workspace folder falls back to its absolute path", () => {
  const { tracker, flush, read } = setup();
  stub.emitSave(stub.makeDoc("/elsewhere/notes.md"));
  flush();
  const events = read();
  assert.equal(events.length, 1);
  assert.equal(events[0].project, "(no folder)");
  assert.equal(events[0].file, "/elsewhere/notes.md");
  tracker.dispose();
});

test("Windows-style backslash paths are normalized and noise-filtered", () => {
  const { tracker, flush, read } = setup();
  // The folder boundary uses path.sep so the stub's getWorkspaceFolder finds
  // the folder on Windows too; the inner backslashes simulate asRelativePath's
  // Windows output (on POSIX they are ordinary characters).
  stub.emitSave(stub.makeDoc(`${ROOT}${path.sep}node_modules\\x\\y.js`));
  stub.emitSave(stub.makeDoc(`${ROOT}${path.sep}src\\win\\style.ts`, { languageId: "typescript" }));
  flush();
  const events = read();
  assert.deepEqual(events.map((e) => e.file), ["src/win/style.ts"]);
  tracker.dispose();
});

test("events record the normalized folder path for path-keyed scoping", () => {
  const { tracker, flush, read } = setup();
  stub.emitSave(stub.makeDoc(path.join(ROOT, "src/p.ts")));
  flush();
  assert.equal(read()[0].projectPath, ROOT.replace(/\\/g, "/"));
  tracker.dispose();
});

test("dispose unsubscribes: later saves are not recorded", () => {
  const { tracker, flush, read } = setup();
  tracker.dispose();
  assert.equal(stub.listenerCount(), 0);
  stub.emitSave(stub.makeDoc(path.join(ROOT, "src/after.ts")));
  flush();
  assert.deepEqual(read(), []);
});
