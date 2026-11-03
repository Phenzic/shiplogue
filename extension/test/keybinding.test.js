const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

test("generate has the Cmd/Ctrl+Shift+Quote keybinding", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const kb = (pkg.contributes.keybindings || []).find((k) => k.command === "shiplogue.generate");
  assert.ok(kb, "shiplogue.generate keybinding missing");
  assert.equal(kb.key, "ctrl+shift+'");
  assert.equal(kb.mac, "cmd+shift+'");
});
