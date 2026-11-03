"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { isPrivatePath, isAlwaysPrivate } = require("../out/ignore");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "standup-ignore-"));
}

test("always-private names are excluded without any ignore file", () => {
  for (const p of [
    ".env",
    ".env.local",
    "config/.env.production",
    "id_rsa",
    "keys/server.pem",
    "secrets.json",
    ".ssh/config",
    ".aws/credentials",
  ]) {
    assert.equal(isAlwaysPrivate(p), true, p);
  }
  assert.equal(isAlwaysPrivate("src/app.ts"), false);
  assert.equal(isAlwaysPrivate("src/secrets.ts"), false);
});

test("gitignore patterns, directories and negation are honored", () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, ".gitignore"), "*.log\nsecret/\n!important.log\n");
  assert.equal(isPrivatePath("debug.log", root), true);
  assert.equal(isPrivatePath("important.log", root), false);
  assert.equal(isPrivatePath("secret/db.txt", root), true);
  assert.equal(isPrivatePath("src/app.ts", root), false);
  assert.equal(isPrivatePath(".env.local", root), true);
});

test("other .*ignore files and nested ignore files are honored", () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, ".npmignore"), "dist/\n");
  fs.writeFileSync(path.join(root, ".cursorignore"), "private/\n");
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "sub", ".gitignore"), "*.tmp\n");
  assert.equal(isPrivatePath("dist/bundle.js", root), true);
  assert.equal(isPrivatePath("private/notes.md", root), true);
  assert.equal(isPrivatePath("sub/cache.tmp", root), true);
  assert.equal(isPrivatePath("other/cache.tmp", root), false);
});

test("anchored and nested-slash patterns are relative to their ignore file", () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, ".gitignore"), "/build/output.js\nlogs/*.txt\n");
  assert.equal(isPrivatePath("build/output.js", root), true);
  assert.equal(isPrivatePath("src/build/output.js", root), false);
  assert.equal(isPrivatePath("logs/run.txt", root), true);
  assert.equal(isPrivatePath("src/logs/run.txt", root), false);
});
