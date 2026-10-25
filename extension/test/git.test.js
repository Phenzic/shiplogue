"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const { installVscodeStub, tmpDir, makeGitRepo } = require("./helpers");

const { stub } = installVscodeStub();
const { collectCommits, repoSlug } = require("../out/git");

test("collectCommits parses hash, subject, body, files and repo slug", async () => {
  const { dir } = makeGitRepo();
  stub.reset();
  stub.setFolders([{ fsPath: dir, name: "demo" }]);

  const now = Date.now();
  const commits = await collectCommits(new Date(now - 3600e3), new Date(now + 60e3));
  assert.equal(commits.length, 2);

  const first = commits.find((c) => c.subject.includes("add health endpoint"));
  assert.ok(first, "expected the health commit");
  assert.equal(first.repo, "acme/demo");
  assert.equal(first.hash.length, 8);
  assert.match(first.body, /Adds \/health with a 200 response/);
  assert.match(first.body, /Used by the deploy probe/);
  assert.deepEqual(first.files, ["a.ts"]);

  const second = commits.find((c) => c.subject.includes("docs"));
  assert.deepEqual(second.files.sort(), ["a.ts", "b.md"]);
});

test("collectCommits honours the time window", async () => {
  const { dir } = makeGitRepo();
  stub.reset();
  stub.setFolders([{ fsPath: dir, name: "demo" }]);

  const now = Date.now();
  assert.equal((await collectCommits(new Date(now + 3600e3), new Date(now + 7200e3))).length, 0);
  assert.equal((await collectCommits(new Date(now - 7200e3), new Date(now - 3600e3))).length, 0);
});

test("collectCommits filters to the local git author", async () => {
  const { dir, run } = makeGitRepo();
  run(
    ["commit", "-q", "--allow-empty", "-m", "feat: someone else's work"],
    { email: "other@example.com", name: "Other" },
  );
  stub.reset();
  stub.setFolders([{ fsPath: dir, name: "demo" }]);

  const now = Date.now();
  const mine = await collectCommits(new Date(now - 3600e3), new Date(now + 60e3));
  assert.equal(mine.length, 2);
  assert.ok(mine.every((c) => !c.subject.includes("someone else")));
});

test("non-git workspace folders are skipped", async () => {
  const plain = tmpDir("standup-plain-");
  stub.reset();
  stub.setFolders([{ fsPath: plain, name: "plain" }]);
  const now = Date.now();
  assert.deepEqual(await collectCommits(new Date(now - 3600e3), new Date(now + 60e3)), []);
});

test("repoSlug handles ssh, https and non-GitHub remotes", async () => {
  const { dir, run } = makeGitRepo();
  assert.equal(await repoSlug(dir), "acme/demo");

  run(["remote", "set-url", "origin", "https://github.com/acme/demo.git"]);
  assert.equal(await repoSlug(dir), "acme/demo");

  run(["remote", "set-url", "origin", "https://gitlab.com/acme/demo.git"]);
  assert.equal(await repoSlug(dir), null);

  const plain = tmpDir("standup-plain-");
  assert.equal(await repoSlug(plain), null);
});
