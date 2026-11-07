const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeEventId,
  workspaceIdFor,
  DedupeSet,
} = require("../dist/events/dedupe");

const base = {
  ts: "2026-11-07T10:15:00.000Z",
  source: "claude-code",
  workspaceRoot: "/tmp/project",
  kind: "prompt",
  actor: "user",
  text: "hello",
};

test("workspaceIdFor is stable, short, and does not expose the path", () => {
  const a = workspaceIdFor("/tmp/project");
  const b = workspaceIdFor("/tmp/project");
  assert.equal(a, b);
  assert.equal(a.length, 16);
  assert.ok(!a.includes("project"));
});

test("source/session/sourceEventId wins over the fallback hash", () => {
  const ev = { ...base, sessionId: "s1", sourceEventId: "e1" };
  assert.equal(computeEventId(ev, "ws"), "claude-code:s1:e1");
});

test("fallback id is stable within a minute and changes across minutes", () => {
  const id = computeEventId(base, "ws");
  assert.equal(computeEventId({ ...base }, "ws"), id);
  assert.notEqual(
    computeEventId({ ...base, ts: "2026-11-07T10:16:00.000Z" }, "ws"),
    id,
  );
  assert.notEqual(
    computeEventId({ ...base, text: "different" }, "ws"),
    id,
  );
});

test("fallback id changes with workspace", () => {
  assert.notEqual(computeEventId(base, "ws-a"), computeEventId(base, "ws-b"));
});

test("DedupeSet tracks and primes ids", () => {
  const d = new DedupeSet();
  assert.equal(d.has("a"), false);
  d.add("a");
  d.prime(["b", "c"]);
  assert.equal(d.has("a"), true);
  assert.equal(d.has("b"), true);
  assert.equal(d.has("c"), true);
  assert.equal(d.has("d"), false);
});
