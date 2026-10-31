"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, tmpDir, makeGitRepo, interceptGithub, ghResponse } = require("./helpers");

const { stub } = installVscodeStub();
const { collectGitHub, githubToken } = require("../out/github");

const SINCE = new Date("2026-05-10T12:00:00.000Z");

function prItem(number, title) {
  return {
    number,
    title,
    html_url: `https://github.com/acme/demo/pull/${number}`,
    closed_at: "2026-05-10T10:00:00Z",
    pull_request: {},
  };
}
function issueItem(number, title) {
  return {
    number,
    title,
    html_url: `https://github.com/acme/demo/issues/${number}`,
    closed_at: "2026-05-10T11:00:00Z",
  };
}

test("collectGitHub builds merged-PR and closed-issue searches and maps results", async () => {
  stub.reset();
  stub.setConfig({ "shiplogue.github.repos": ["acme/demo"], "shiplogue.github.token": "" });
  stub.setFolders([]);

  const calls = [];
  const restore = interceptGithub((url) => {
    calls.push(decodeURIComponent(url));
    if (url.endsWith("/user")) return ghResponse({ login: "alice" });
    if (decodeURIComponent(url).includes("is:pr")) return ghResponse({ items: [prItem(12, "Add health")] });
    return ghResponse({ items: [issueItem(7, "Crash on launch")] });
  });
  try {
    const items = await collectGitHub("tok", ["acme/demo"], SINCE);
    assert.equal(items.length, 2);
    const pr = items.find((i) => i.kind === "pr");
    const issue = items.find((i) => i.kind === "issue");
    assert.equal(pr.number, 12);
    assert.equal(pr.url, "https://github.com/acme/demo/pull/12");
    assert.equal(issue.number, 7);

    assert.equal(calls.length, 3, "one /user + two searches");
    const prQuery = calls.find((c) => c.includes("is:pr"));
    const issueQuery = calls.find((c) => c.includes("is:issue"));
    assert.match(prQuery, /repo:acme\/demo is:pr is:merged author:alice merged:>=2026-05-10/);
    assert.match(issueQuery, /repo:acme\/demo is:issue is:closed assignee:alice closed:>=2026-05-10/);
  } finally {
    restore();
  }
});

test("empty configured repos auto-detects owner/name from the workspace origin", async () => {
  const { dir } = makeGitRepo();
  stub.reset();
  stub.setConfig({ "shiplogue.github.repos": [], "shiplogue.github.token": "" });
  stub.setFolders([{ fsPath: dir, name: "demo" }]);

  const calls = [];
  const restore = interceptGithub((url) => {
    calls.push(decodeURIComponent(url));
    if (url.endsWith("/user")) return ghResponse({ login: "alice" });
    return ghResponse({ items: [] });
  });
  try {
    await collectGitHub("tok", [], SINCE);
    assert.equal(calls.filter((c) => c.includes("search/issues")).length, 2);
    assert.ok(calls.some((c) => c.includes("repo:acme/demo")));
  } finally {
    restore();
  }
});

test("no token means no network calls and no items", async () => {
  stub.reset();
  const calls = [];
  const restore = interceptGithub((url) => {
    calls.push(url);
    return ghResponse({});
  });
  try {
    assert.deepEqual(await collectGitHub("", ["acme/demo"], SINCE), []);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("GitHub failures degrade to an empty list instead of breaking the stand-up", async () => {
  stub.reset();
  stub.setConfig({ "shiplogue.github.repos": ["acme/demo"] });
  stub.setFolders([]);
  const restore = interceptGithub(() => ghResponse({ message: "boom" }, 500));
  const origError = console.error;
  console.error = () => {};
  try {
    const items = await collectGitHub("tok", ["acme/demo"], SINCE);
    assert.deepEqual(items, []);
  } finally {
    console.error = origError;
    restore();
  }
});

test("githubToken prefers an explicit PAT", async () => {
  stub.reset();
  stub.setConfig({ "shiplogue.github.token": "pat-123", "shiplogue.github.useBuiltInAuth": true });
  stub.sessions.github = "editor-token";
  assert.equal(await githubToken(false), "pat-123");
  assert.equal(stub.authCalls.length, 0, "built-in auth not consulted when a PAT is set");
});

test("githubToken uses the editor's built-in session silently", async () => {
  stub.reset();
  stub.setConfig({ "shiplogue.github.token": "", "shiplogue.github.useBuiltInAuth": true });
  stub.sessions.github = "editor-token";
  assert.equal(await githubToken(false), "editor-token");
  assert.equal(stub.authCalls[0].options.silent, true);
  assert.equal(stub.authCalls[0].options.createIfNone, false);
});

test("githubToken returns empty when sign-in is cancelled or disabled", async () => {
  stub.reset();
  stub.setConfig({ "shiplogue.github.token": "", "shiplogue.github.useBuiltInAuth": true });
  assert.equal(await githubToken(true), "");
  assert.equal(stub.authCalls[0].options.createIfNone, true);

  stub.reset();
  stub.setConfig({ "shiplogue.github.token": "", "shiplogue.github.useBuiltInAuth": false });
  assert.equal(await githubToken(false), "");
  assert.equal(stub.authCalls.length, 0);
});
