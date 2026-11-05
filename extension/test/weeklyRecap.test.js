"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, makeContext, tmpDir } = require("./helpers");
installVscodeStub();
const { StandupStore, localDateKey } = require("../out/standupStore");
const { DraftHistory } = require("../out/draftHistory");
const { WeeklyRecapScheduler } = require("../out/weeklyRecap");

test("manual weekly recap writes a weekly entry to draft history", async () => {
  const context = makeContext(tmpDir());
  const history = new StandupStore(context);
  const draftHistory = new DraftHistory(context);
  history.saveGenerated("**Done**\n- Built the recap compiler", {
    workspaceId: "alpha",
    projectName: "alpha",
    sources: ["vscode"],
  });
  const scheduler = new WeeklyRecapScheduler(context, history, draftHistory, () => {});
  const entry = await scheduler.generateNow();
  assert.ok(entry);
  assert.equal(entry.kind, "weekly");
  assert.match(entry.title || "", /Weekly recap/);
  assert.match(entry.markdown, /Built the recap compiler/);
  assert.deepEqual(entry.sources, ["vscode"]);
  assert.equal(draftHistory.list().entries[0].kind, "weekly");
  scheduler.dispose();
});
