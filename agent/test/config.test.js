const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULTS,
  loadConfig,
  writeConfig,
  shiplogueHome,
  eventsDir,
  configPath,
} = require("../dist/config");

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-home-"));
  const prev = process.env.SHIPLOGUE_HOME;
  process.env.SHIPLOGUE_HOME = home;
  for (const key of [
    "SHIPLOGUE_CAPTURE_PROMPTS",
    "SHIPLOGUE_CAPTURE_READS",
    "SHIPLOGUE_RETENTION_DAYS",
    "SHIPLOGUE_LOOKBACK_HOURS",
  ]) {
    delete process.env[key];
  }
  try {
    return fn(home);
  } finally {
    if (prev === undefined) delete process.env.SHIPLOGUE_HOME;
    else process.env.SHIPLOGUE_HOME = prev;
  }
}

test("SHIPLOGUE_HOME overrides the default home and paths derive from it", () => {
  withHome((home) => {
    assert.equal(shiplogueHome(), home);
    assert.equal(eventsDir(), path.join(home, "agent", "events"));
    assert.equal(configPath(), path.join(home, "config.json"));
  });
});

test("defaults apply when no env or file config exists", () => {
  withHome(() => {
    assert.deepEqual(loadConfig(), DEFAULTS);
  });
});

test("environment wins over file config, file wins over defaults", () => {
  withHome((home) => {
    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ capturePrompts: false, retentionDays: 3 }),
    );
    assert.equal(loadConfig().capturePrompts, false);
    assert.equal(loadConfig().retentionDays, 3);
    const env = {
      SHIPLOGUE_CAPTURE_PROMPTS: "1",
      SHIPLOGUE_RETENTION_DAYS: "7",
    };
    const out = loadConfig(env);
    assert.equal(out.capturePrompts, true);
    assert.equal(out.retentionDays, 7);
    assert.equal(out.lookbackHours, DEFAULTS.lookbackHours);
  });
});

test("writeConfig merges updates, writes 0600 where supported, and reads back", () => {
  withHome((home) => {
    const out = writeConfig({ capturePrompts: false, retentionDays: 9 });
    assert.equal(out.capturePrompts, false);
    assert.equal(out.retentionDays, 9);
    const onDisk = JSON.parse(fs.readFileSync(path.join(home, "config.json")));
    assert.equal(onDisk.capturePrompts, false);
    assert.equal(onDisk.retentionDays, 9);
    if (process.platform !== "win32") {
      assert.equal(
        fs.statSync(path.join(home, "config.json")).mode & 0o777,
        0o600,
      );
    }
  });
});
