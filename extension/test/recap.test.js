"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./helpers").installVscodeStub();
const { buildWeeklyRecap } = require("../out/recap");

function record(date, projectName, markdown, sources) {
  return {
    id: `${date}:${projectName}`,
    date,
    projectName,
    sources,
    markdown,
    status: "generated",
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
  };
}

test("weekly recap compiles stored daily drafts and unions sources", () => {
  const recap = buildWeeklyRecap(
    [
      record("2026-11-03", "alpha", "**Done**\n- Added the billing page\n- Fixed the auth race", ["vscode"]),
      record("2026-11-04", "beta", "**Done**\n- Removed the legacy endpoint", ["cursor", "antigravity"]),
    ],
    new Date("2026-11-06T18:00:00"),
  );
  assert.ok(recap);
  assert.match(recap.markdown, /What I shipped/);
  assert.match(recap.markdown, /Added the billing page/);
  assert.match(recap.markdown, /Removed the legacy endpoint/);
  assert.deepEqual(recap.projects, ["alpha", "beta"]);
  assert.deepEqual(recap.sources.sort(), ["antigravity", "cursor", "vscode"]);
  assert.match(recap.title, /2026-11-03/);
});

test("weekly recap is empty when there are no stored daily drafts", () => {
  assert.equal(buildWeeklyRecap([], new Date("2026-11-06T18:00:00")), undefined);
});
