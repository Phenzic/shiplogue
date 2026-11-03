"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub } = require("./helpers");

const { stub } = installVscodeStub();
const { configureShortcut } = require("../out/commands/shortcuts");

test("configureShortcut opens the keybindings editor filtered to generate", async () => {
  let args;
  stub.commandRegistry.set("workbench.action.openGlobalKeybindings", (...a) => {
    args = a;
  });
  await configureShortcut();
  assert.deepEqual(args, ["shiplogue.generate"]);
});
