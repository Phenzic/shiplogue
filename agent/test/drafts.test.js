const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  finalizeDraft,
  saveDraft,
  loadDraft,
  listDrafts,
  reviseSection,
} = require("../dist/agent/src/drafts/store");

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-draft-"));
  const prev = process.env.SHIPLOGUE_HOME;
  process.env.SHIPLOGUE_HOME = home;
  try {
    return fn(home);
  } finally {
    if (prev === undefined) delete process.env.SHIPLOGUE_HOME;
    else process.env.SHIPLOGUE_HOME = prev;
  }
}

function ctx() {
  return {
    since: new Date("2026-11-07T00:00:00.000Z"),
    until: new Date("2026-11-07T23:59:59.000Z"),
    commits: [
      {
        hash: "abc12345",
        date: "2026-11-07T10:00:00.000Z",
        subject: "feat: add health endpoint",
        body: "",
        repo: "acme/demo",
        files: ["src/a.ts"],
      },
    ],
    touches: [],
    github: [],
    cursorPrompts: [],
  };
}

const MARKDOWN = [
  "Hey team, here's what I worked on today:",
  "",
  "Shipped a health endpoint and verified it.",
  "",
  "**Yesterday**",
  "- Wrapped up the auth flow",
  "**Today**",
  "",
  "### Health endpoint [feature]",
  "Added a health endpoint with coverage.",
  "  - src/a.ts",
  "**Next**",
  "- None",
  "**Blockers**",
  "- None",
].join("\n");

test("finalizeDraft grounds, renders and scores an agent-authored draft", () => {
  const result = finalizeDraft(MARKDOWN, ctx());
  assert.ok(result.markdown.includes("Health endpoint"));
  assert.ok(result.plainText.includes("Health endpoint"));
  assert.ok(result.document);
  assert.equal(typeof result.quality.score, "number");
  assert.deepEqual(result.verification.removed, []);
});

test("finalizeDraft removes an invented file path", () => {
  const result = finalizeDraft(
    MARKDOWN.replace("src/a.ts", "src/invented.ts"),
    ctx(),
  );
  assert.ok(!result.markdown.includes("src/invented.ts"));
  assert.ok(result.warnings.some((warning) => warning.includes("Removed")));
});

test("saveDraft increments revisions and loads the latest draft", () => {
  withHome(() => {
    const first = saveDraft(MARKDOWN, { date: "2026-11-07", source: "claude-code" });
    assert.equal(first.revision, 1);
    const second = saveDraft(`${MARKDOWN}\n\nUpdated.`, {
      date: "2026-11-07",
      source: "claude-code",
    });
    assert.equal(second.revision, 2);
    const loaded = loadDraft("2026-11-07");
    assert.equal(loaded.revision, 2);
    assert.ok(loaded.markdown.trimEnd().endsWith("Updated."));
    assert.equal(listDrafts()[0].date, "2026-11-07");
  });
});

test("reviseSection replaces and appends blockers", () => {
  const replaced = reviseSection(MARKDOWN, "blockers", "- Waiting on review");
  assert.ok(replaced.includes("**Blockers**\n- Waiting on review"));
  const appended = reviseSection(MARKDOWN, "next", "- Add metrics", "append");
  assert.ok(appended.includes("- None"));
  assert.ok(appended.includes("- Add metrics"));
});
