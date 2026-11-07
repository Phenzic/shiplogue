const test = require("node:test");
const assert = require("node:assert/strict");
const {
  redactText,
  redactAndCap,
  shouldSkipPath,
  CAPS,
} = require("../dist/events/redact");

test("redactText removes common provider keys", () => {
  const input =
    "key sk-abcdefgh12345678 and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 " +
    "AKIAABCDEFGHIJKLMNOP Bearer abc.def.ghi api_key=supersecret123";
  const out = redactText(input);
  assert.ok(!out.includes("sk-abcdefgh12345678"));
  assert.ok(!out.includes("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"));
  assert.ok(!out.includes("AKIAABCDEFGHIJKLMNOP"));
  assert.ok(!out.includes("abc.def.ghi"));
  assert.ok(!out.includes("supersecret123"));
  assert.ok(out.includes("[redacted]"));
});

test("redactText strips control chars but keeps newlines", () => {
  assert.equal(redactText("a\x00b\x1bc\nnext"), "abc\nnext");
});

test("redactAndCap caps after redaction and marks truncation", () => {
  const long = "x".repeat(CAPS.text + 10);
  const out = redactAndCap(long, CAPS.text);
  assert.equal(out.length, CAPS.text + 1);
  assert.ok(out.endsWith("…"));
});

test("sensitive and binary paths are skipped", () => {
  for (const p of [
    ".env",
    ".env.local",
    "config/id_rsa",
    "certs/server.pem",
    "node_modules/pkg/index.js",
    "src/image.png",
    "dist/out.js",
  ]) {
    assert.equal(shouldSkipPath(p), true, p);
  }
  for (const p of ["src/index.ts", "README.md", "docs/setup.md"]) {
    assert.equal(shouldSkipPath(p), false, p);
  }
});
