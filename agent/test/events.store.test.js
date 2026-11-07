const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  EventStore,
  dayKey,
} = require("../dist/events/store");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-agent-"));
}

function draft(overrides = {}) {
  return {
    ts: new Date().toISOString(),
    source: "claude-code",
    workspaceRoot: "/tmp/project",
    kind: "prompt",
    actor: "user",
    sessionId: "s1",
    text: "hello",
    ...overrides,
  };
}

test("append stores a schema-versioned event in a day file", () => {
  const dir = tmpDir();
  const store = new EventStore(dir);
  const ev = store.append(draft({ sourceEventId: "e1" }));
  assert.ok(ev);
  assert.equal(ev.schemaVersion, 1);
  assert.equal(ev.id, "claude-code:s1:e1");
  assert.equal(ev.workspaceId.length, 16);
  const file = path.join(dir, `${dayKey(new Date(ev.ts))}.jsonl`);
  assert.equal(fs.existsSync(file), true);
  assert.deepEqual(store.readDay(dayKey(new Date(ev.ts))), [ev]);
});

test("append dedupes across store instances (restart safety)", () => {
  const dir = tmpDir();
  const first = new EventStore(dir);
  assert.ok(first.append(draft({ sourceEventId: "e1" })));
  const second = new EventStore(dir);
  assert.equal(second.append(draft({ sourceEventId: "e1" })), null);
});

test("append skips sensitive paths and redacts/caps text", () => {
  const store = new EventStore(tmpDir());
  assert.equal(store.append(draft({ file: ".env" })), null);
  const ev = store.append(
    draft({
      sourceEventId: "e2",
      text: `token sk-abcdefgh12345678 ${"x".repeat(3000)}`,
    }),
  );
  assert.ok(ev.text.includes("[redacted]"));
  assert.ok(!ev.text.includes("sk-abcdefgh12345678"));
  assert.equal(ev.text.length, 2049); // 2048 + ellipsis
});

test("readRange filters by timestamp and sorts by ts", () => {
  const store = new EventStore(tmpDir());
  store.append(
    draft({
      sourceEventId: "late",
      ts: "2026-11-07T12:00:00.000Z",
    }),
  );
  store.append(
    draft({
      sourceEventId: "early",
      ts: "2026-11-07T08:00:00.000Z",
    }),
  );
  store.append(
    draft({
      sourceEventId: "outside",
      ts: "2026-11-06T12:00:00.000Z",
    }),
  );
  const out = store.readRange(
    new Date("2026-11-07T07:00:00.000Z"),
    new Date("2026-11-07T13:00:00.000Z"),
  );
  assert.deepEqual(
    out.map((e) => e.id),
    ["claude-code:s1:early", "claude-code:s1:late"],
  );
});

test("corrupt lines are skipped; newer schema is refused", () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, "2026-11-07.jsonl"),
    'not json\n{"schemaVersion":1,"id":"ok","ts":"2026-11-07T10:00:00Z"}\n',
  );
  const store = new EventStore(dir);
  const oldError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(
      store.readDay("2026-11-07").map((e) => e.id),
      ["ok"],
    );
  } finally {
    console.error = oldError;
  }

  fs.writeFileSync(
    path.join(dir, "2026-11-08.jsonl"),
    '{"schemaVersion":99,"id":"future"}\n',
  );
  assert.throws(() => store.readDay("2026-11-08"), /newer than this agent/);
});

test("pruneOld removes only files older than the retention window", () => {
  const dir = tmpDir();
  const store = new EventStore(dir);
  fs.writeFileSync(path.join(dir, "2000-01-01.jsonl"), "");
  fs.writeFileSync(path.join(dir, "2026-11-07.jsonl"), "");
  fs.writeFileSync(path.join(dir, "notes.txt"), "keep");
  const removed = store.pruneOld(14, new Date("2026-11-07T12:00:00.000Z"));
  assert.equal(removed, 1);
  assert.equal(fs.existsSync(path.join(dir, "2000-01-01.jsonl")), false);
  assert.equal(fs.existsSync(path.join(dir, "2026-11-07.jsonl")), true);
  assert.equal(fs.existsSync(path.join(dir, "notes.txt")), true);
  assert.equal(store.pruneOld(0), 0);
});

test("countToday counts only today's events", () => {
  const store = new EventStore(tmpDir());
  store.append(draft({ sourceEventId: "today" }));
  assert.equal(store.countToday(), 1);
});
