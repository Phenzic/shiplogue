"use strict";
// A0: the extracted core works with no vscode import, and the extension's
// prompt/activity rendering is byte-identical to the core's for the same input.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { installVscodeStub, makeGitRepo } = require("../helpers");

const { stub } = installVscodeStub();
const { buildPrompt, buildActivityText, detailDefaults } = require("../../out/core/prompt");
const { collectCommitsFromFolders } = require("../../out/core/gather/git");
const { contextToText } = require("../../out/gather");
const { setDetailGetter } = require("../../out/config");

test("no vscode import anywhere under src/core", () => {
  const coreDir = path.join(__dirname, "..", "..", "src", "core");
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : [],
    );
  for (const file of walk(coreDir)) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /from "vscode"/, `${file} imports vscode`);
  }
});

test("core git: collects commits from an explicit folder list", async () => {
  const { dir } = makeGitRepo();
  const commits = await collectCommitsFromFolders(
    [{ name: "demo", path: dir }],
    new Date(Date.now() - 24 * 3600e3),
    new Date(Date.now() + 60e3),
  );
  assert.equal(commits.length, 2);
  assert.match(commits[0].subject, /health endpoint|document the health/);
  assert.equal(commits[0].repo, "acme/demo");
});

test("core activity rendering is byte-identical to the extension path", () => {
  stub.reset();
  setDetailGetter(() => "standard");
  const now = new Date().toISOString();
  const ctx = {
    since: new Date(Date.now() - 3600e3),
    until: new Date(),
    commits: [
      { hash: "abc12345", date: now, subject: "feat(api): add health endpoint", body: "Adds /health.", repo: "acme/demo", files: ["src/health.ts"] },
    ],
    touches: [{ file: "src/health.ts", project: "demo", lang: "typescript", saves: 2, edits: 1, lastTs: now }],
    github: [{ kind: "pr", number: 41, title: "Add health", url: "https://github.com/acme/demo/pull/41", repo: "acme/demo" }],
    cursorPrompts: [{ ts: now, text: "wire the health check into deploy" }],
    truncated: { commits: 40 },
  };
  assert.equal(buildActivityText(ctx, "standard"), contextToText(ctx));
});

test("core prompt builder takes an explicit style (no settings reads)", () => {
  const ctx = { since: new Date(), until: new Date(), commits: [], touches: [], github: [], cursorPrompts: [] };
  const prompt = buildPrompt(ctx, { detail: "standard", tone: "senior", format: "yesterday-today-blockers" });
  assert.match(prompt, /\*\*Yesterday\*\*/);
  assert.match(prompt, /5-7 Done bullets/);
  assert.match(prompt, /Voice: write as a senior engineer/);
  assert.deepEqual(detailDefaults("elaborate"), { perCommitFiles: 15, bodyChars: 400, touchCap: 25 });
});
