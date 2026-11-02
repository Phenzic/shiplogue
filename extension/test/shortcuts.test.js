"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub } = require("./helpers");

const { stub } = installVscodeStub();
const { configureShortcut } = require("../out/commands/shortcuts");
const pkg = require("../package.json");

test("generate has a cross-platform keybinding that avoids terminal focus", () => {
  const binding = (pkg.contributes.keybindings || []).find(
    (k) => k.command === "shiplogue.generate",
  );
  assert.ok(binding, "shiplogue.generate keybinding is declared");
  assert.equal(binding.key, "ctrl+shift+j");
  assert.equal(binding.mac, "cmd+shift+j");
  assert.equal(binding.when, "!terminalFocus");
});

test("configureShortcut opens the keyboard shortcuts editor filtered to generate", async () => {
  await configureShortcut();
  const call = stub.executedCommands.find(
    (c) => c.id === "workbench.action.openGlobalKeybindings",
  );
  assert.ok(call, "openGlobalKeybindings was invoked");
  assert.deepEqual(call.args, ["shiplogue.generate"]);
});
