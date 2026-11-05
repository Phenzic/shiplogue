"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub } = require("./helpers");

const { stub } = installVscodeStub();
const { activeWorkspace, workspaceForFolder } = require("../out/workspaces");

test("local workspace ids are stable and do not expose the path", () => {
  stub.folders = [
    { name: "alpha", uri: { fsPath: "/tmp/projects/alpha" } },
    { name: "beta", uri: { fsPath: "/tmp/projects/beta" } },
  ];
  const first = activeWorkspace();
  const again = activeWorkspace();
  assert.equal(first.name, "alpha");
  assert.equal(first.id, again.id);
  assert.match(first.id, /^[a-f0-9]{20}$/);
  assert.ok(!first.id.includes("alpha"));
  assert.equal(workspaceForFolder(stub.folders[1]).name, "beta");
});
