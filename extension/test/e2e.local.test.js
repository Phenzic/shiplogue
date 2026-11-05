"use strict";
// Checks against this machine's real Cursor database (read-only). Skipped unless
// CURSOR_REAL_DB=1 because paths are machine-specific.
const { test } = require("node:test");
const { execFileSync } = require("child_process");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { installVscodeStub } = require("./helpers");

installVscodeStub();
const { collectCursorPrompts } = require("../out/cursor");

const ENABLED = process.env.CURSOR_REAL_DB === "1";

test("reads prompts from the real Cursor DB without touching it", { skip: !ENABLED }, async (t) => {
  const home = process.env.HOME || "";
  const db = path.join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb");
  if (!fs.existsSync(db)) {
    t.skip("Cursor DB not present on this machine");
    return;
  }
  const before = fs.statSync(db).mtimeMs;
  const since = new Date(Date.now() - 400 * 24 * 3600e3);
  const until = new Date();
  const started = Date.now();
  const prompts = await collectCursorPrompts(since, until, null);
  const elapsed = Date.now() - started;
  t.diagnostic(`real Cursor DB (${(fs.statSync(db).size / 1e6).toFixed(0)}MB): ${prompts.length} prompts in ${elapsed}ms`);

  assert.ok(prompts.length > 0, "expected historical prompts to be extractable");
  for (const p of prompts) {
    assert.equal(typeof p.text, "string");
    assert.ok(p.text.length > 0 && p.text.length <= 280);
    assert.ok(!p.text.includes("\n"), "whitespace is collapsed");
    const ts = Date.parse(p.ts);
    assert.ok(ts >= since.getTime() && ts <= Date.now(), `prompt ts in range: ${p.ts}`);
  }
  assert.equal(fs.statSync(db).mtimeMs, before, "DB is never modified");
});

test("scoping to a real Cursor workspace includes its own prompts", { skip: !ENABLED }, async (t) => {
  const home = process.env.HOME || "";
  const wsRoot = path.join(home, "Library/Application Support/Cursor/User/workspaceStorage");
  const globalDb = path.join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb");
  if (!fs.existsSync(wsRoot) || !fs.existsSync(globalDb)) {
    t.skip("Cursor workspaceStorage/global DB missing");
    return;
  }
  const sql = (db, q) =>
    JSON.parse(execFileSync("sqlite3", ["-readonly", `file:${db}?immutable=1`, "-json", q], { encoding: "utf8" }) || "[]");

  // The extension takes the 200 most recent prompts and then filters by
  // workspace, so pick a workspace that is represented in that recent window.
  const recent = sql(
    globalDb,
    "SELECT substr(key,10,36) AS composer FROM cursorDiskKV " +
      "WHERE key LIKE 'bubbleId:%' AND json_extract(value,'$.type')=1 " +
      "AND json_extract(value,'$.text')<>'' " +
      "AND json_extract(value,'$.createdAt') >= '2025-09-20T00:00:00.000Z' " +
      "ORDER BY json_extract(value,'$.createdAt') DESC LIMIT 200;",
  );
  const recentComposers = new Set(recent.map((r) => r.composer));
  if (recentComposers.size === 0) {
    t.skip("no recent prompts in the Cursor DB");
    return;
  }

  let best = null;
  for (const dir of fs.readdirSync(wsRoot)) {
    const metaPath = path.join(wsRoot, dir, "workspace.json");
    const dbPath = path.join(wsRoot, dir, "state.vscdb");
    if (!fs.existsSync(metaPath) || !fs.existsSync(dbPath)) continue;
    let folder;
    try {
      folder = decodeURIComponent(String(JSON.parse(fs.readFileSync(metaPath, "utf8")).folder || "").replace(/^file:\/\//, ""));
    } catch {
      continue;
    }
    if (!folder || !fs.existsSync(folder)) continue;
    let ids = [];
    try {
      const rows = sql(dbPath, "SELECT value FROM ItemTable WHERE key='composer.composerData';");
      if (!rows.length) continue;
      const data = JSON.parse(rows[0].value);
      ids = [
        ...(data.allComposers || []).map((c) => c.composerId).filter(Boolean),
        ...(data.selectedComposerIds || []),
        ...(data.lastFocusedComposerIds || []),
      ];
    } catch {
      continue;
    }
    if (new Set(ids).size && ids.some((id) => recentComposers.has(id))) {
      best = { folder, matched: ids.filter((id) => recentComposers.has(id)).length };
      break;
    }
  }
  if (!best) {
    t.skip("no workspace with prompts in the recent window");
    return;
  }

  const prompts = await collectCursorPrompts(new Date(Date.now() - 400 * 24 * 3600e3), new Date(), [best.folder]);
  t.diagnostic(`workspace ${best.folder}: ${prompts.length} prompts, ${best.matched} of its composers in recent window`);
  assert.ok(prompts.length > 0, "a workspace with recent prompts must keep them when scoped");
});
