"use strict";
// End-to-end (in-process) test of the real activation path: activate() wires the
// tracker, remeinder and commands; `standup.generate` gathers git + tracked
// activity + GitHub, calls Ollama, and pushes a draft to the panel.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { installVscodeStub, tmpDir, makeContext, startServer, interceptGithub, ghResponse, makeGitRepo, ymd } = require("./helpers");

const { stub, commands } = installVscodeStub();
const ext = require("../out/extension");
const { activate, deactivate } = ext;
const { StandupPanel } = require("../out/standupPanel");

const DRAFT = [
  "Hey team, here's what I worked on today:",
  "",
  "**Done**",
  "- Shipped the health endpoint and updated its docs.",
  "",
  "**Next**",
  "- Wire the endpoint into the deploy probe.",
  "",
  "**Blockers**",
  "- None",
].join("\n");

const settle = () => new Promise((r) => setImmediate(r));

// Poll until a condition holds — used to catch a generation mid-flight.
async function waitFor(cond, ms = 5000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function baseConfig(overrides) {
  return {
    "standup.lookbackHours": 24,
    "standup.ollama.model": "test-model",
    "standup.github.repos": ["acme/demo"],
    "standup.github.token": "",
    "standup.github.useBuiltInAuth": false,
    "standup.cursor.enabled": false,
    "standup.reminder.enabled": false,
    "standup.reminder.time": "23:59",
    "standup.track.enabled": true,
    "standup.webhook.type": "none",
    "standup.scope": "workspace",
    "standup.format": "done-next-blockers",
    "standup.detail": "concise",
    ...overrides,
  };
}

async function cleanup() {
  try {
    deactivate();
  } catch {
    /* not active */
  }
  if (StandupPanel.current) StandupPanel.current.dispose();
  for (const p of stub.panels) if (!p.disposed) p.dispose();
  // Wait out the fire-and-forget Ollama health check so a late warning can't
  // leak past the next test's stub.reset().
  if (ext.healthCheckDone) await ext.healthCheckDone;
}

async function withActivation(t, { repoDir, storage, config, setupDone = true, lastReminder, inputAnswers = [], warningAnswers = [], quickPickAnswers = [] }) {
  stub.reset();
  stub.setFolders([{ fsPath: repoDir, name: "demo" }]);
  stub.setConfig(config);
  stub.inputAnswers.push(...inputAnswers);
  stub.warningAnswers.push(...warningAnswers);
  stub.quickPickAnswers.push(...quickPickAnswers);
  const ctx = makeContext(storage);
  if (setupDone) await ctx.globalState.update("setupDone", true);
  if (lastReminder) await ctx.globalState.update("lastReminderYmd", lastReminder);
  activate(ctx);
  t.after(() => cleanup());
  return ctx;
}


test("happy path: save → commit + GitHub + Ollama → draft panel with references", async (t) => {
  const { dir } = makeGitRepo();
  const storage = tmpDir();
  const ollama = await startServer(() => ({ body: { response: DRAFT } }));
  const ghCalls = [];
  const restoreGithub = interceptGithub((url) => {
    ghCalls.push(decodeURIComponent(url));
    if (url.endsWith("/user")) return ghResponse({ login: "alice" });
    if (decodeURIComponent(url).includes("is:pr")) {
      return ghResponse({
        items: [
          { number: 12, title: "Add health endpoint", html_url: "https://github.com/acme/demo/pull/12", closed_at: "2026-05-10T10:00:00Z", pull_request: {} },
        ],
      });
    }
    return ghResponse({
      items: [
        { number: 7, title: "Crash on launch", html_url: "https://github.com/acme/demo/issues/7", closed_at: "2026-05-10T11:00:00Z" },
      ],
    });
  });
  t.after(async () => {
    restoreGithub();
    await ollama.close();
  });

  await withActivation(t, {
    repoDir: dir,
    storage,
    config: baseConfig({ "standup.ollama.url": ollama.url, "standup.github.token": "gh-token" }),
    lastReminder: ymd(),
  });

  // The extension registered all four commands.
  assert.deepEqual(
    [...stub.commandRegistry.keys()].sort(),
    ["standup.connectGitHub", "standup.generate", "standup.setReminderTime", "standup.showActivity"],
  );
  // Tracking is live: a save in this window is recorded.
  assert.equal(stub.listenerCount(), 2);
  stub.emitSave(stub.makeDoc(path.join(dir, "a.ts"), { languageId: "typescript" }));

  await commands.executeCommand("standup.generate");

  const panel = stub.panels.at(-1);
  assert.ok(panel, "a webview panel was opened");
  const loading = panel.messages.filter((m) => m.kind === "loading");
  assert.deepEqual(
    loading.map((m) => m.label),
    ["Gathering commits…", "Gathering GitHub activity…", "Writing your stand-up with the local model…"],
  );

  const draft = panel.messages.find((m) => m.kind === "draft");
  assert.ok(draft, `expected a draft, got: ${JSON.stringify(panel.messages)}`);
  assert.match(draft.markdown, /\*\*Done\*\*/);
  assert.match(draft.markdown, /\*\*Next\*\*/);
  assert.match(draft.markdown, /\*\*Blockers\*\*/);
  assert.match(draft.markdown, /Merged PR \[#12\]\(https:\/\/github\.com\/acme\/demo\/pull\/12\)/);
  assert.match(draft.markdown, /Closed issue \[#7\]\(https:\/\/github\.com\/acme\/demo\/issues\/7\)/);
  assert.deepEqual(draft.summary, { commits: 2, files: 1, github: 2 });
  assert.equal(draft.detail, "concise");
  assert.equal(draft.target, "");

  // What the model actually received. (The activation-time health check also
  // hits the mock server with GET /api/tags — filter to generate calls.)
  const genReqs = ollama.requests.filter((r) => r.url === "/api/generate");
  assert.equal(genReqs.length, 1);
  const prompt = genReqs[0].body.prompt;
  assert.match(prompt, /feat\(api\): add health endpoint/);
  assert.match(prompt, /docs: document the health endpoint/);
  assert.match(prompt, /a\.ts/, "tracked file touch is in the prompt");
  assert.match(prompt, /merged PR #12: Add health endpoint/);
  assert.match(prompt, /ACTIVITY:/);
  assert.match(prompt, /Output only the stand-up/);
  assert.doesNotMatch(prompt, /AI prompts I gave/, "cursor collection disabled");
  assert.equal(genReqs[0].body.model, "test-model");

  // GitHub was queried for the workspace repo.
  assert.ok(ghCalls.some((c) => c.includes("repo:acme/demo")));

  // The debug view shows the same raw activity.
  await commands.executeCommand("standup.showActivity");
  const doc = stub.documents.at(-1).getText();
  assert.match(doc, /# Standup activity \(last 24h\)/);
  assert.match(doc, /feat\(api\): add health endpoint/);
  assert.match(doc, /## Files worked on/);
  assert.match(doc, /a\.ts/);
});

test("no activity: an actionable error instead of an empty stand-up", async (t) => {
  const storage = tmpDir();
  const empty = tmpDir("standup-empty-");
  const ollama = await startServer(() => ({ body: { response: DRAFT } }));
  t.after(() => ollama.close());

  await withActivation(t, {
    repoDir: empty,
    storage,
    config: baseConfig({ "standup.ollama.url": ollama.url }),
    lastReminder: ymd(),
  });

  await commands.executeCommand("standup.generate");
  const err = stub.panels.at(-1).messages.find((m) => m.kind === "error");
  assert.ok(err);
  assert.match(err.message, /No activity found in the last 24h/);
  assert.equal(
    ollama.requests.filter((r) => r.url === "/api/generate").length,
    0,
    "the model is not called without activity",
  );
});

test("Ollama down: the panel explains how to fix it, without crashing activation", async (t) => {
  const dir = tmpDir("standup-plain-");
  const storage = tmpDir();
  await withActivation(t, {
    repoDir: dir,
    storage,
    config: baseConfig({ "standup.ollama.url": "http://127.0.0.1:1" }),
    lastReminder: ymd(),
  });
  stub.emitSave(stub.makeDoc(path.join(dir, "notes.ts")));

  await commands.executeCommand("standup.generate");
  const err = stub.panels.at(-1).messages.find((m) => m.kind === "error");
  assert.ok(err);
  assert.match(err.message, /Couldn't reach Ollama at http:\/\/127\.0\.0\.1:1/);
});

test("first run asks for a reminder time once and stores it globally", async (t) => {
  const dir = tmpDir("standup-plain-");
  const storage = tmpDir();
  await withActivation(t, {
    repoDir: dir,
    storage,
    config: baseConfig({ "standup.reminder.enabled": true }),
    setupDone: false,
    inputAnswers: ["09:30"],
  });
  await settle();
  await settle();

  assert.equal(stub.inputBoxes.length, 1);
  assert.match(stub.inputBoxes[0].prompt, /nudge you to send your stand-up/);
  assert.equal(stub.configUpdates.at(-1).key, "standup.reminder.time");
  assert.equal(stub.configUpdates.at(-1).value, "09:30");

  // Second activation must not ask again.
  cleanup();
  stub.reset();
  stub.setFolders([{ fsPath: dir, name: "demo" }]);
  stub.setConfig(baseConfig({ "standup.reminder.enabled": true }));
  const ctx2 = makeContext(storage);
  activate(ctx2);
  await settle();
  await settle();
  assert.equal(stub.inputBoxes.length, 0);
  cleanup();
});

test("track.enabled=false installs no listeners and records nothing", async (t) => {
  const dir = tmpDir("standup-plain-");
  const storage = tmpDir();
  await withActivation(t, {
    repoDir: dir,
    storage,
    config: baseConfig({ "standup.track.enabled": false }),
    lastReminder: ymd(),
  });
  assert.equal(stub.listenerCount(), 0);
  stub.emitSave(stub.makeDoc(path.join(dir, "ignored.ts")));
  deactivate();

  const { Store } = require("../out/store");
  const events = new Store(makeContext(storage)).readRange(new Date(Date.now() - 3600e3), new Date(Date.now() + 60e3));
  assert.deepEqual(events, []);
});

test("health check: unreachable Ollama warns, and 'How to install' opens ollama.com", async (t) => {
  const dir = tmpDir("standup-plain-");
  const storage = tmpDir();
  await withActivation(t, {
    repoDir: dir,
    storage,
    config: baseConfig({ "standup.ollama.url": "http://127.0.0.1:1" }),
    lastReminder: ymd(),
    warningAnswers: ["How to install"],
  });
  await ext.healthCheckDone;
  const warn = stub.notifications.find((n) => n.warning);
  assert.ok(warn, "expected an unreachable-Ollama warning");
  assert.match(warn.message, /Ollama isn't running/);
  assert.deepEqual(warn.items, ["How to install", "Dismiss"]);
  assert.deepEqual(stub.openedUrls, ["https://ollama.com"]);
});

test("health check: a missing model offers 'Pull now' in a terminal", async (t) => {
  const dir = tmpDir("standup-plain-");
  const storage = tmpDir();
  const tags = await startServer((req) =>
    req.url === "/api/tags"
      ? { body: { models: [{ name: "other-model:latest" }] } }
      : { body: { response: DRAFT } },
  );
  t.after(() => tags.close());
  await withActivation(t, {
    repoDir: dir,
    storage,
    config: baseConfig({ "standup.ollama.url": tags.url, "standup.ollama.model": "missing-model" }),
    lastReminder: ymd(),
    warningAnswers: ["Pull now"],
  });
  await ext.healthCheckDone;
  assert.equal(stub.terminals.length, 1);
  assert.equal(stub.terminals[0].sent[0], "ollama pull missing-model");
  assert.equal(stub.terminals[0].shown, true);
});

test("health check: 'Pick another model' writes standup.ollama.model globally", async (t) => {
  const dir = tmpDir("standup-plain-");
  const storage = tmpDir();
  const tags = await startServer((req) =>
    req.url === "/api/tags"
      ? { body: { models: [{ name: "other-model:latest" }, { name: "llama3.2:latest" }] } }
      : { body: { response: DRAFT } },
  );
  t.after(() => tags.close());
  await withActivation(t, {
    repoDir: dir,
    storage,
    config: baseConfig({ "standup.ollama.url": tags.url, "standup.ollama.model": "missing-model" }),
    lastReminder: ymd(),
    warningAnswers: ["Pick another model"],
    quickPickAnswers: ["other-model:latest"],
  });
  await ext.healthCheckDone;
  const upd = stub.configUpdates.find((u) => u.key === "standup.ollama.model");
  assert.ok(upd, "expected standup.ollama.model to be written");
  assert.equal(upd.value, "other-model:latest");
  assert.equal(upd.target, 1, "ConfigurationTarget.Global");
  assert.deepEqual(stub.quickPicks[0].items, ["other-model:latest", "llama3.2:latest"]);
});

test("health check: no warning when the configured model is installed (:latest tolerated)", async (t) => {
  const dir = tmpDir("standup-plain-");
  const storage = tmpDir();
  const tags = await startServer((req) =>
    req.url === "/api/tags"
      ? { body: { models: [{ name: "test-model:latest" }] } }
      : { body: { response: DRAFT } },
  );
  t.after(() => tags.close());
  await withActivation(t, {
    repoDir: dir,
    storage,
    config: baseConfig({ "standup.ollama.url": tags.url, "standup.ollama.model": "test-model" }),
    lastReminder: ymd(),
  });
  await ext.healthCheckDone;
  assert.ok(tags.requests.some((r) => r.url === "/api/tags"), "the health check actually ran");
  assert.equal(stub.notifications.filter((n) => n.warning).length, 0);
});

test("deactivate flushes buffered activity so a quick session is not lost", async (t) => {
  const dir = tmpDir("standup-plain-");
  const storage = tmpDir();
  await withActivation(t, {
    repoDir: dir,
    storage,
    config: baseConfig(),
    lastReminder: ymd(),
  });
  stub.emitSave(stub.makeDoc(path.join(dir, "remember-me.ts")));
  deactivate(); // before the 3s debounce would fire

  const { Store } = require("../out/store");
  const events = new Store(makeContext(storage)).readRange(new Date(Date.now() - 3600e3), new Date(Date.now() + 60e3));
  assert.deepEqual(events.map((e) => e.file), ["remember-me.ts"]);
});

test("regenerating mid-flight aborts the old run; only the newer draft reaches the panel", async (t) => {
  const { dir } = makeGitRepo();
  const storage = tmpDir();
  const OLD = DRAFT.replace("Shipped the health endpoint", "OLD RUN should never appear");
  const NEW = DRAFT.replace("Shipped the health endpoint", "NEW RUN draft");
  let calls = 0;
  const ollama = await startServer(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, calls === 1 ? 3000 : 50));
    return { body: { response: calls === 1 ? OLD : NEW } };
  });
  t.after(() => ollama.close());

  await withActivation(t, {
    repoDir: dir,
    storage,
    config: baseConfig({ "standup.ollama.url": ollama.url }),
    lastReminder: ymd(),
  });

  const first = commands.executeCommand("standup.generate");
  await waitFor(() => ollama.requests.filter((r) => r.url === "/api/generate").length === 1);
  const second = commands.executeCommand("standup.generate"); // supersedes the first
  await Promise.all([first, second]);

  const panel = stub.panels.at(-1);
  const drafts = panel.messages.filter((m) => m.kind === "draft");
  assert.equal(drafts.length, 1, "exactly one draft — the stale run was dropped");
  assert.match(drafts[0].markdown, /NEW RUN draft/);
  assert.equal(panel.messages.filter((m) => m.kind === "cancelled").length, 0, "no 'Cancelled.' flash for the superseded run");
});

test("cancel stops generation promptly and shows 'Cancelled.'", async (t) => {
  const { dir } = makeGitRepo();
  const storage = tmpDir();
  const ollama = await startServer(async () => {
    await new Promise((r) => setTimeout(r, 5000));
    return { body: { response: DRAFT } };
  });
  t.after(() => ollama.close());

  await withActivation(t, {
    repoDir: dir,
    storage,
    config: baseConfig({ "standup.ollama.url": ollama.url }),
    lastReminder: ymd(),
  });

  const started = Date.now();
  const run = commands.executeCommand("standup.generate");
  await waitFor(() => ollama.requests.filter((r) => r.url === "/api/generate").length === 1);
  await stub.panels.at(-1).messageHandler({ kind: "cancel" });
  await run;
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `cancel should return control promptly, took ${elapsed}ms`);

  const panel = stub.panels.at(-1);
  const cancelled = panel.messages.find((m) => m.kind === "cancelled");
  assert.ok(cancelled, "expected a cancelled status, got: " + JSON.stringify(panel.messages));
  assert.equal(cancelled.message, "Cancelled.");
  assert.equal(panel.messages.filter((m) => m.kind === "draft").length, 0, "no draft after cancel");
});

test("a generation that exceeds standup.generate.timeoutSeconds aborts with guidance", async (t) => {
  const { dir } = makeGitRepo();
  const storage = tmpDir();
  const ollama = await startServer(async () => {
    await new Promise((r) => setTimeout(r, 5000));
    return { body: { response: DRAFT } };
  });
  t.after(() => ollama.close());

  await withActivation(t, {
    repoDir: dir,
    storage,
    config: baseConfig({
      "standup.ollama.url": ollama.url,
      "standup.generate.timeoutSeconds": 1,
    }),
    lastReminder: ymd(),
  });

  await commands.executeCommand("standup.generate");
  const cancelled = stub.panels.at(-1).messages.find((m) => m.kind === "cancelled");
  assert.ok(cancelled, "expected a timed-out cancellation");
  assert.match(cancelled.message, /timed out after 1s/);
  assert.match(cancelled.message, /standup\.generate\.timeoutSeconds/);
});
