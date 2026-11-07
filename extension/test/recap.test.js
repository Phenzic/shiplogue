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

test("weekly recap uses Today, keeps details, and reports the week's coverage", () => {
  const recap = buildWeeklyRecap(
    [
      {
        ...record(
          "2026-11-05",
          "alpha",
          [
            "**Yesterday**",
            "- Wrapped up auth",
            "",
            "**Today**",
            "- Shipped the billing flow:",
            "  - src/billing.ts",
            "  - src/checkout.tsx",
            "- Fixed the auth race",
            "",
            "**Next**",
            "- Add invoices",
            "",
            "**Blockers**",
            "- Waiting on legal",
          ].join("\n"),
          ["vscode"],
        ),
        summary: { commits: 4, files: 3, github: 1 },
        coverage: {
          window: { kind: "calendar-day", start: "2026-11-05", end: "2026-11-05" },
          git: { commits: 4, files: 3 },
          ide: { touchedFiles: 3 },
          github: { prs: 1, issues: 0, items: 1 },
          agents: { sessions: 1, prompts: 2, bySource: { vscode: 2 } },
          uncommitted: { files: 0 },
        },
      },
    ],
    new Date("2026-11-06T18:00:00"),
  );
  assert.ok(recap);
  assert.match(recap.markdown, /Week at a glance/);
  assert.match(recap.markdown, /4 commits/);
  assert.match(recap.markdown, /Shipped the billing flow/);
  assert.match(recap.markdown, /src\/billing\.ts/);
  assert.match(recap.markdown, /Carrying forward/);
  assert.match(recap.markdown, /Add invoices/);
  assert.match(recap.markdown, /Blocked: Waiting on legal/);
  assert.doesNotMatch(recap.markdown, /Wrapped up auth/);
});

test("weekly recap prefers structured themes and tags", () => {
  const recap = buildWeeklyRecap(
    [
      {
        ...record("2026-11-05", "alpha", "unused", ["vscode"]),
        document: {
          greeting: "Hey team",
          headline: "Shipped recap and delivery.",
          labels: { yesterday: "Yesterday", today: "Today", next: "Next", blockers: "Blockers" },
          yesterday: ["Finished old work."],
          today: [
            { title: "Weekly recap", tag: "feature", summary: "Added the recap email.", details: [], files: ["lib/email.ts"] },
            { title: "Discord delivery", tag: "fix", summary: "Fixed bot delivery.", details: [], files: ["lib/delivery.ts"] },
          ],
          next: ["Add invoices."],
          blockers: ["None"],
        },
      },
    ],
    new Date("2026-11-06T18:00:00"),
  );
  assert.ok(recap);
  assert.match(recap.markdown, /\*\*Weekly recap\*\* \[feature\]/);
  assert.match(recap.markdown, /email\.ts/);
  assert.match(recap.markdown, /Discord delivery/);
  assert.match(recap.markdown, /Add invoices/);
});
