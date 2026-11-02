"use strict";
// A0: the CLI runs from source build and reports status, including real git data.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CLI = path.join(__dirname, "..", "dist", "agent", "src", "cli.js");

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-cli-"));
  const run = (args) =>
    execFileSync("git", args, {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: "dev@x.co", GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: "dev@x.co" },
    });
  run(["init", "-q"]);
  run(["config", "commit.gpgsign", "false"]);
  run(["config", "user.email", "dev@x.co"]);
  run(["config", "user.name", "Dev"]);
  fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
  run(["add", "a.ts"]);
  run(["commit", "-q", "-m", "feat: initial"]);
  return dir;
}

test("shiplogue status --json reports version, workspace and source counts", () => {
  const repo = makeRepo();
  const out = execFileSync(process.execPath, [CLI, "status", "--json"], { cwd: repo, encoding: "utf8" });
  const info = JSON.parse(out);
  assert.ok(info.agent.length > 0);
  assert.equal(info.workspace, fs.realpathSync(repo));
  assert.ok(info.workspaceId.length === 16);
  assert.equal(info.sources.gitCommits24h, 1);
  assert.equal(typeof info.sources.eventsToday, "number");
  assert.ok(info.paths.events.includes(".shiplogue"));
});

test("unknown command exits non-zero with usage", () => {
  assert.throws(() => execFileSync(process.execPath, [CLI, "bogus"], { encoding: "utf8" }));
});

test("plain status prints human-readable lines", () => {
  const out = execFileSync(process.execPath, [CLI, "status"], { encoding: "utf8" });
  assert.match(out, /Shiplogue agent v/);
  assert.match(out, /Workspace:/);
});
