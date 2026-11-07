const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.join(__dirname, "..", "dist", "cli.js");

function run(args, env) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: os.tmpdir(),
  });
}

test("status --json reports agent, paths, capture, and counts", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-cli-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-ws-"));
  const res = run(["status", "--json", "--workspace", workspace], {
    SHIPLOGUE_HOME: home,
  });
  assert.equal(res.status, 0, res.stderr);
  const info = JSON.parse(res.stdout);
  assert.equal(info.agent, "0.3.0-dev.0");
  assert.equal(info.schemaVersion, 1);
  assert.equal(info.workspace, workspace);
  assert.equal(info.paths.events, path.join(home, "agent", "events"));
  assert.equal(info.paths.config, path.join(home, "config.json"));
  assert.equal(info.capture.prompts, true);
  assert.equal(info.capture.fileReads, false);
  assert.equal(info.sources.gitCommits24h, 0);
  assert.equal(info.sources.eventsToday, 0);
});

test("status prints a human summary", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-cli-"));
  const res = run(["status"], { SHIPLOGUE_HOME: home });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Shiplogue agent v0\.3\.0-dev\.0/);
  assert.match(res.stdout, /Events today: 0/);
  assert.match(res.stdout, /Capture: prompts on/);
});

test("unknown commands exit non-zero with the available command list", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-cli-"));
  const res = run(["nope"], { SHIPLOGUE_HOME: home });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Unknown command: nope/);
  assert.match(res.stderr, /Available: status/);
});
