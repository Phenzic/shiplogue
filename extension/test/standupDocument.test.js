"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./helpers").installVscodeStub();

const { parseStandupDocument, renderStandupDocument } = require("../out/standupDocument");
const { scoreStandupDocument } = require("../out/standupQuality");

const SAMPLE = [
  "Hey team, here's what I worked on today:",
  "",
  "Shipped the weekly recap and made delivery reliable.",
  "",
  "**Yesterday**",
  "- Finished the connector cleanup.",
  "",
  "**Today**",
  "",
  "### Weekly recap email [feature]",
  "Added an opt-in weekly recap email for Pro workspaces.",
  "  - lib/email.ts",
  "  - app/settings/recap/page.tsx",
  "",
  "### Discord delivery [fix]",
  "Fixed Discord posting to use the bot token.",
  "  - lib/delivery.ts",
  "",
  "**Next**",
  "- Add invoices.",
  "",
  "**Blockers**",
  "- None",
].join("\n");

test("parses the theme-first format into a structured document", () => {
  const doc = parseStandupDocument(SAMPLE);
  assert.ok(doc);
  assert.equal(doc.headline, "Shipped the weekly recap and made delivery reliable.");
  assert.equal(doc.yesterday.length, 1);
  assert.equal(doc.today.length, 2);
  assert.equal(doc.today[0].tag, "feature");
  assert.deepEqual(doc.today[0].files, ["lib/email.ts", "app/settings/recap/page.tsx"]);
  assert.equal(doc.today[1].summary, "Fixed Discord posting to use the bot token.");
});

test("renders the clean story without file paths", () => {
  const doc = parseStandupDocument(SAMPLE);
  const md = renderStandupDocument(doc);
  assert.match(md, /### Weekly recap email \[feature\]/);
  assert.doesNotMatch(md, /lib\/email\.ts/);
  assert.match(md, /\*\*Yesterday\*\*/);
});

test("old flat drafts do not become structured documents", () => {
  assert.equal(parseStandupDocument("**Done**\n- Fixed a thing"), undefined);
});

test("quality score prefers ranked, tagged themes and rejects duplication", () => {
  const doc = parseStandupDocument(SAMPLE);
  const good = scoreStandupDocument(doc);
  assert.equal(good.score, 100);

  const weak = JSON.parse(JSON.stringify(doc));
  weak.today = [weak.today[0]];
  weak.yesterday = [weak.today[0].summary];
  const bad = scoreStandupDocument(weak);
  assert.ok(bad.score < 90);
  assert.ok(bad.issues.some((issue) => /workstream/.test(issue)));
  assert.ok(bad.issues.some((issue) => /repeat/.test(issue)));
});
