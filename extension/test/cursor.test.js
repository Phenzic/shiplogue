"use strict";
// Cursor chat DB extraction and workspace scoping, against synthetic databases
// built with the sqlite3 CLI so the privacy contract is exercised deterministically.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { installVscodeStub, tmpDir } = require("./helpers");

installVscodeStub();
const { collectCursorPrompts } = require("../out/cursor");

const ORIGINAL_HOME = process.env.HOME;

function sqlite(db, sql) {
  execFileSync("sqlite3", [db, sql], { encoding: "utf8" });
}
function sqliteJson(db, sql) {
  const out = execFileSync("sqlite3", ["-readonly", `file:${db}?immutable=1`, "-json", sql], {
    encoding: "utf8",
  });
  return out.trim() ? JSON.parse(out) : [];
}
function esc(s) {
  return String(s).replace(/'/g, "''");
}

function bubble(composerId, uuid, createdAt, text, type = 1) {
  const key = `bubbleId:${composerId}:${uuid}`;
  const value = JSON.stringify({ type, text, createdAt });
  return `('${esc(key)}','${esc(value)}')`;
}

// Build a fake HOME with Cursor's global DB and one workspace DB per project.
function makeCursorHome({ workspaces = [], bubbles = [] } = {}) {
  const home = tmpDir("standup-home-");
  const base = path.join(home, "Library/Application Support/Cursor/User");
  const globalDir = path.join(base, "globalStorage");
  fs.mkdirSync(globalDir, { recursive: true });
  const globalDb = path.join(globalDir, "state.vscdb");
  sqlite(globalDb, "CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT);");
  if (bubbles.length) {
    sqlite(globalDb, `INSERT INTO cursorDiskKV (key,value) VALUES ${bubbles.join(",")};`);
  }
  for (const ws of workspaces) {
    const dir = path.join(base, "workspaceStorage", ws.hash);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "workspace.json"), JSON.stringify({ folder: `file://${ws.folder}` }));
    const db = path.join(dir, "state.vscdb");
    sqlite(
      db,
      "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT); " +
        `INSERT INTO ItemTable (key,value) VALUES ('composer.composerData','${esc(
          JSON.stringify({
            allComposers: ws.composerIds.map((composerId) => ({ composerId })),
            selectedComposerIds: [],
            lastFocusedComposerIds: [],
          }),
        )}');`,
    );
  }
  process.env.HOME = home;
  return { home, globalDb };
}

const now = Date.now();
const inWindow = new Date(now - 3600e3).toISOString();
const outOfWindow = new Date(now - 48 * 3600e3).toISOString();

test.beforeEach(() => {
  process.env.HOME = ORIGINAL_HOME;
});
test.after(() => {
  process.env.HOME = ORIGINAL_HOME;
});

test("extracts only in-window user prompts, read-only", async () => {
  const { globalDb } = makeCursorHome({
    workspaces: [],
    bubbles: [
      bubble("c1", "u1", inWindow, "fix the login bug"),
      bubble("c1", "u2", inWindow, "assistant reply", 2),
      bubble("c1", "u3", inWindow, "   "),
      bubble("c1", "u4", outOfWindow, "old prompt"),
      bubble("c2", "u5", inWindow, "different workspace"),
    ],
  });
  const before = fs.statSync(globalDb).mtimeMs;
  const prompts = await collectCursorPrompts(new Date(now - 24 * 3600e3), new Date(now + 60e3), null);
  assert.deepEqual(prompts.map((p) => p.text).sort(), ["different workspace", "fix the login bug"]);
  for (const p of prompts) assert.ok(Date.parse(p.ts) >= now - 24 * 3600e3);
  assert.equal(fs.statSync(globalDb).mtimeMs, before);
});

test("normalizes whitespace and truncates very long prompts", async () => {
  const long = "word ".repeat(100);
  makeCursorHome({
    bubbles: [
      bubble("c1", "n1", inWindow, "line one\nline two\t end"),
      bubble("c1", "n2", inWindow, long),
    ],
  });
  const prompts = await collectCursorPrompts(new Date(now - 24 * 3600e3), new Date(now + 60e3), null);
  const short = prompts.find((p) => p.text.startsWith("line one"));
  assert.equal(short.text, "line one line two end");
  const truncated = prompts.find((p) => p.text.startsWith("word"));
  assert.equal(truncated.text.length, 280);
});

test("scoping keeps a workspace's own prompts and drops other workspaces'", async () => {
  makeCursorHome({
    workspaces: [{ hash: "w1", folder: "/projects/alpha", composerIds: ["c1"] }],
    bubbles: [
      bubble("c1", "s1", inWindow, "alpha login work"),
      bubble("c2", "s2", inWindow, "beta secret work"),
      bubble("c3", "s3", inWindow, "unknown workspace prompt"),
    ],
  });
  const prompts = await collectCursorPrompts(new Date(now - 24 * 3600e3), new Date(now + 60e3), ["/projects/alpha"]);
  assert.deepEqual(prompts.map((p) => p.text), ["alpha login work"]);
});

test("a scope with no attributable chats returns nothing (never leaks)", async () => {
  makeCursorHome({
    workspaces: [{ hash: "w1", folder: "/projects/alpha", composerIds: ["c1"] }],
    bubbles: [bubble("c2", "l1", inWindow, "someone else's prompt")],
  });
  const prompts = await collectCursorPrompts(new Date(now - 24 * 3600e3), new Date(now + 60e3), [
    "/projects/not-open",
  ]);
  assert.deepEqual(prompts, []);
});

test("no Cursor database means no prompts and no error", async () => {
  process.env.HOME = tmpDir("standup-nohome-");
  assert.deepEqual(await collectCursorPrompts(new Date(now - 24 * 3600e3), new Date(now + 60e3), null), []);
});

test("caps the number of prompts sent to the model at 60", async () => {
  const bubbles = Array.from({ length: 80 }, (_, i) =>
    bubble("c1", `cap${i}`, new Date(now - 3600e3 + i * 1000).toISOString(), `prompt ${i}`),
  );
  makeCursorHome({ bubbles });
  const prompts = await collectCursorPrompts(new Date(now - 24 * 3600e3), new Date(now + 60e3), null);
  assert.equal(prompts.length, 60);
  assert.equal(prompts[0].text, "prompt 79", "newest first");
});

test("workspace filtering happens inside SQL: a quiet workspace's prompt survives >200 newer prompts elsewhere", async () => {
  const older = new Date(now - 20 * 3600e3).toISOString();
  const bubbles = Array.from({ length: 205 }, (_, i) =>
    bubble("cBusy", `busy${i}`, new Date(now - 10 * 3600e3 + i * 1000).toISOString(), `busy ${i}`),
  );
  bubbles.push(bubble("cQuiet", "quiet1", older, "quiet workspace prompt"));
  makeCursorHome({
    workspaces: [{ hash: "wq", folder: "/projects/quiet", composerIds: ["cQuiet"] }],
    bubbles,
  });
  const prompts = await collectCursorPrompts(new Date(now - 24 * 3600e3), new Date(now + 60e3), [
    "/projects/quiet",
  ]);
  assert.deepEqual(
    prompts.map((p) => p.text),
    ["quiet workspace prompt"],
    "a workspace's own prompt survives the limit",
  );
});

test("Windows file URIs (file:///C:/…) match backslashed folder paths", async () => {
  makeCursorHome({
    workspaces: [{ hash: "w1", folder: "/C:/Users/me/proj", composerIds: ["c1"] }], // file:///C:/Users/me/proj
    bubbles: [bubble("c1", "w1", inWindow, "windows prompt"), bubble("c2", "w2", inWindow, "other")],
  });
  const prompts = await collectCursorPrompts(new Date(now - 24 * 3600e3), new Date(now + 60e3), [
    "C:\\Users\\me\\proj",
  ]);
  assert.deepEqual(prompts.map((p) => p.text), ["windows prompt"]);
});

test("the composer-id map is cached until the workspaceStorage dir changes", async () => {
  const { home } = makeCursorHome({
    workspaces: [{ hash: "w1", folder: "/projects/alpha", composerIds: ["c1"] }],
    bubbles: [bubble("c1", "a", inWindow, "alpha one"), bubble("c2", "b", inWindow, "alpha two")],
  });
  const wsRoot = path.join(home, "Library/Application Support/Cursor/User/workspaceStorage");
  const since = new Date(now - 24 * 3600e3);
  const until = new Date(now + 60e3);

  let prompts = await collectCursorPrompts(since, until, ["/projects/alpha"]);
  assert.deepEqual(prompts.map((p) => p.text), ["alpha one"]);

  // Attribute composer c2 to the workspace WITHOUT bumping the directory mtime
  // (Cursor's own writes would bump it; a pure inner-file write does not).
  const wsDb = path.join(wsRoot, "w1", "state.vscdb");
  sqlite(
    wsDb,
    `UPDATE ItemTable SET value='${esc(
      JSON.stringify({
        allComposers: [{ composerId: "c1" }, { composerId: "c2" }],
        selectedComposerIds: [],
        lastFocusedComposerIds: [],
      }),
    )}' WHERE key='composer.composerData';`,
  );
  prompts = await collectCursorPrompts(since, until, ["/projects/alpha"]);
  assert.deepEqual(prompts.map((p) => p.text), ["alpha one"], "unchanged mtime serves the cache");

  const future = new Date(Date.now() + 10_000);
  fs.utimesSync(wsRoot, future, future);
  prompts = await collectCursorPrompts(since, until, ["/projects/alpha"]);
  assert.deepEqual(
    prompts.map((p) => p.text).sort(),
    ["alpha one", "alpha two"],
    "an mtime bump invalidates the cache",
  );
});
