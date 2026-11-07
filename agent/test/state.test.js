const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadState, saveState, STATE_SCHEMA_VERSION } = require("../dist/state");

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-state-"));
  return path.join(dir, "state.json");
}

test("loadState creates a stable device id on a fresh install", () => {
  const file = tmpFile();
  const a = loadState("1.2.3", file);
  assert.equal(a.schemaVersion, STATE_SCHEMA_VERSION);
  assert.equal(a.agentVersion, "1.2.3");
  assert.match(a.deviceId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(a.cursors, {});
});

test("saveState/loadState round-trip and preserve the device id", () => {
  const file = tmpFile();
  const first = loadState("1.0.0", file);
  saveState({ ...first, cursors: { "claude-code": 42 }, lastSync: "now" }, file);
  const second = loadState("2.0.0", file);
  assert.equal(second.deviceId, first.deviceId);
  assert.equal(second.agentVersion, "2.0.0");
  assert.deepEqual(second.cursors, { "claude-code": 42 });
  assert.equal(second.lastSync, "now");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});

test("corrupt state falls back to a fresh state", () => {
  const file = tmpFile();
  fs.writeFileSync(file, "{nope");
  const state = loadState("1.0.0", file);
  assert.equal(state.agentVersion, "1.0.0");
  assert.ok(state.deviceId);
});
