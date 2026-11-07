const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SCHEMA_VERSION,
  SchemaVersionError,
  parseEventLine,
} = require("../dist/agent/src/events/schema");

test("parseEventLine accepts a valid event and preserves fields", () => {
  const ev = { schemaVersion: 1, id: "x", ts: "2026-01-01T00:00:00Z" };
  assert.deepEqual(parseEventLine(JSON.stringify(ev)), ev);
});

test("parseEventLine returns null for malformed JSON or non-objects", () => {
  assert.equal(parseEventLine("{nope"), null);
  assert.equal(parseEventLine("null"), null);
  assert.equal(parseEventLine('"string"'), null);
});

test("parseEventLine refuses a newer schema with an actionable error", () => {
  const line = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, id: "x" });
  assert.throws(
    () => parseEventLine(line),
    (err) => err instanceof SchemaVersionError && err.found === 2,
  );
});

test("an event without schemaVersion is tolerated for forward compatibility", () => {
  assert.deepEqual(parseEventLine(JSON.stringify({ id: "legacy" })), {
    id: "legacy",
  });
});
