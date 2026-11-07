const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { runHook } = require("../dist/agent/src/hooks/command");
const { EventStore, dayKey } = require("../dist/agent/src/events/store");
const { eventsDir } = require("../dist/agent/src/config");

const CLI = path.join(__dirname, "..", "dist", "agent", "src", "cli.js");

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-hook-"));
  const prev = process.env.SHIPLOGUE_HOME;
  process.env.SHIPLOGUE_HOME = home;
  try {
    return fn(home);
  } finally {
    if (prev === undefined) delete process.env.SHIPLOGUE_HOME;
    else process.env.SHIPLOGUE_HOME = prev;
  }
}

test("runHook stores a normalized, redacted event", () => {
  withHome(() => {
    const result = runHook(
      "claude",
      JSON.stringify({
        session_id: "s1",
        cwd: "/tmp/project",
        hook_event_name: "UserPromptSubmit",
        prompt: "use sk-abcdefgh12345678 to test",
        prompt_id: "p1",
      }),
    );
    assert.equal(result.stored, 1);
    const events = new EventStore(eventsDir()).readDay(dayKey(new Date()));
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "prompt");
    assert.ok(events[0].text.includes("[redacted]"));
    assert.ok(!events[0].text.includes("sk-abcdefgh12345678"));
  });
});

test("runHook fails open on malformed JSON", () => {
  withHome(() => {
    const result = runHook("claude", "{not json", "UserPromptSubmit");
    assert.equal(result.stored, 0);
  });
});

test("runHook skips prompts when capturePrompts is off", () => {
  withHome(() => {
    process.env.SHIPLOGUE_CAPTURE_PROMPTS = "0";
    try {
      const result = runHook(
        "claude",
        JSON.stringify({
          session_id: "s1",
          cwd: "/tmp/project",
          hook_event_name: "UserPromptSubmit",
          prompt: "private",
        }),
      );
      assert.equal(result.stored, 0);
      assert.equal(result.skipped, 1);
    } finally {
      delete process.env.SHIPLOGUE_CAPTURE_PROMPTS;
    }
  });
});

test("the CLI hook command reads stdin and stores an event", () => {
  withHome(() => {
    const res = spawnSync(
      process.execPath,
      [CLI, "hook", "cursor", "--event", "afterFileEdit"],
      {
        input: JSON.stringify({
          file_path: "/tmp/project/src/a.ts",
          edits: [{ old_string: "a", new_string: "b" }],
        }),
        encoding: "utf8",
        env: { ...process.env, CURSOR_PROJECT_DIR: "/tmp/project" },
      },
    );
    assert.equal(res.status, 0, res.stderr);
    const events = new EventStore(eventsDir()).readDay(dayKey(new Date()));
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "file_edit");
    assert.equal(events[0].file, "src/a.ts");
  });
});
