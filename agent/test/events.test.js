"use strict";
// A1: event store — append/read/order, dedupe, corrupt lines, retention,
// redaction, caps, schema version refusal, workspaceId stability.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { EventStore, SchemaVersionError, workspaceIdFor, redactText, shouldSkipPath } = require("../dist/agent/src");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-agent-test-"));
}

function draft(overrides = {}) {
  return {
    ts: new Date().toISOString(),
    source: "claude-code",
    sessionId: "s1",
    sourceEventId: undefined,
    workspaceRoot: "/projects/demo",
    kind: "prompt",
    actor: "user",
    text: "fix the login bug",
    ...overrides,
  };
}

test("append + read back, ordered by ts", () => {
  const store = new EventStore(tmp());
  const t1 = new Date(Date.now() - 2000).toISOString();
  const t2 = new Date(Date.now() - 1000).toISOString();
  store.append(draft({ ts: t2, text: "second" }));
  store.append(draft({ ts: t1, text: "first" }));
  const events = store.readRange(new Date(Date.now() - 3600e3), new Date(Date.now() + 60e3));
  assert.deepEqual(events.map((e) => e.text), ["first", "second"]);
  for (const e of events) {
    assert.equal(e.schemaVersion, 1);
    assert.ok(e.id.length > 0);
    assert.equal(e.workspaceId, workspaceIdFor("/projects/demo"));
  }
});

test("dedupe: same sourceEventId appends once; hash fallback dedupes same minute/kind/text", () => {
  const dir = tmp();
  const store = new EventStore(dir);
  assert.ok(store.append(draft({ sourceEventId: "e1" })) !== null);
  assert.equal(store.append(draft({ sourceEventId: "e1" })), null, "duplicate id skipped");
  assert.equal(store.countToday(), 1);

  // No sourceEventId: same kind+text+minute dedupes (hook + watcher double report).
  const ts = new Date().toISOString();
  assert.ok(store.append(draft({ ts, text: "same thing", sourceEventId: undefined })) !== null);
  assert.equal(store.append(draft({ ts, text: "same thing" })), null);
  assert.equal(store.countToday(), 2);

  // A fresh store (new process) still dedupes against disk.
  const store2 = new EventStore(dir);
  assert.equal(store2.append(draft({ sourceEventId: "e1" })), null, "disk-backed dedupe");
  assert.equal(store2.countToday(), 2);
});

test("corrupt lines are skipped and logged, not fatal", () => {
  const dir = tmp();
  const store = new EventStore(dir);
  store.append(draft({ text: "good" }));
  const day = new Date();
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  fs.appendFileSync(path.join(dir, `${key}.jsonl`), "{not json\n");
  const events = store.countToday();
  assert.equal(events, 1);
});

test("a newer schema version is refused with an actionable error", () => {
  const dir = tmp();
  const key = new Date();
  const k = `${key.getFullYear()}-${String(key.getMonth() + 1).padStart(2, "0")}-${String(key.getDate()).padStart(2, "0")}`;
  fs.writeFileSync(path.join(dir, `${k}.jsonl`), JSON.stringify({ schemaVersion: 99 }) + "\n");
  const store = new EventStore(dir);
  assert.throws(() => store.readDay(k), (e) => e instanceof SchemaVersionError && /Upgrade the shiplogue agent/.test(e.message));
});

test("redaction strips keys/tokens before anything touches disk", () => {
  const dir = tmp();
  const store = new EventStore(dir);
  store.append(
    draft({
      text: "use sk-abc123def456ghi789 and ghp_0123456789abcdefghij0123 with Bearer abcdef123456, api_key=zzz999888777aaa",
    }),
  );
  const raw = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8");
  assert.ok(!raw.includes("sk-abc"), "no OpenAI key on disk");
  assert.ok(!raw.includes("ghp_0123"), "no GitHub PAT on disk");
  assert.ok(!raw.includes("abcdef123456"), "no bearer token on disk");
  assert.ok(!raw.includes("zzz999888777"), "no api_key value on disk");
  assert.ok(raw.includes("[redacted]"));
});

test("sensitive paths are never recorded; caps bound free text", () => {
  const store = new EventStore(tmp());
  assert.equal(store.append(draft({ file: ".env", text: "x" })), null);
  assert.equal(store.append(draft({ file: "certs/prod.pem" })), null);
  assert.equal(store.append(draft({ file: "node_modules/pkg/index.js" })), null);
  assert.equal(store.append(draft({ file: "logo.png" })), null);
  assert.equal(store.countToday(), 0);

  const long = "x".repeat(5000);
  const ev = store.append(draft({ text: long }));
  assert.ok(ev.text.length <= 2049, "prompt text capped at 2 KB + ellipsis");
});

test("retention prunes old day files; 0 keeps everything", () => {
  const dir = tmp();
  const store = new EventStore(dir);
  fs.writeFileSync(path.join(dir, "2020-01-01.jsonl"), "");
  fs.writeFileSync(path.join(dir, "2020-01-02.jsonl"), "");
  assert.equal(store.pruneOld(14), 2);
  assert.equal(fs.readdirSync(dir).length, 0);

  fs.writeFileSync(path.join(dir, "2020-01-01.jsonl"), "");
  assert.equal(store.pruneOld(0), 0);
  assert.equal(fs.readdirSync(dir).length, 1);
});

test("redactText/shouldSkipPath units", () => {
  assert.equal(redactText("token sk-abcdefghij12345 here"), "token [redacted] here");
  assert.equal(redactText("normal text"), "normal text");
  assert.ok(shouldSkipPath(".env.local"));
  assert.ok(shouldSkipPath("a/b/id_ed25519"));
  assert.ok(!shouldSkipPath("src/index.ts"));
});
