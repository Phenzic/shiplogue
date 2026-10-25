"use strict";
// Real-model checks. Skipped unless STANDUP_E2E=1 (they call a local Ollama and
// can take minutes). Run with: STANDUP_E2E=1 npm run test:e2e
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub } = require("./helpers");

const { stub } = installVscodeStub();
const { generateStandup, OllamaError } = require("../out/summarize");
const { setDetailGetter } = require("../out/config");

const E2E = process.env.STANDUP_E2E === "1";
const OLLAMA = process.env.STANDUP_OLLAMA_URL || "http://localhost:11434";
const FORCE_MODEL = process.env.STANDUP_OLLAMA_MODEL || "";

function ctx(overrides = {}) {
  const now = new Date();
  const iso = now.toISOString();
  return {
    since: new Date(now.getTime() - 24 * 3600e3),
    until: now,
    commits: [
      {
        hash: "a1b2c3d4",
        date: iso,
        subject: "feat(api): add password reset flow",
        body: "Adds POST /auth/reset and email delivery. Updates the login page copy.",
        repo: "acme/web",
        files: ["src/auth/reset.ts", "src/auth/email.ts", "src/pages/login.tsx"],
      },
      {
        hash: "e5f6a7b8",
        date: iso,
        subject: "fix: stop duplicate standup reminders",
        body: "Guard the daily timer with a date marker so it fires once per day.",
        repo: "acme/web",
        files: ["src/reminder.ts", "src/state.ts"],
      },
      {
        hash: "c9d0e1f2",
        date: iso,
        subject: "docs: document the activity window settings",
        body: "Explains lookbackHours and scope in the README.",
        repo: "acme/docs",
        files: ["README.md", "settings.md"],
      },
    ],
    github: [
      { kind: "pr", number: 41, title: "Add password reset", url: "https://github.com/acme/web/pull/41", repo: "acme/web" },
      { kind: "issue", number: 39, title: "Reminder fires twice", url: "https://github.com/acme/web/issues/39", repo: "acme/web" },
    ],
    cursorPrompts: [
      { ts: iso, text: "wire the reset email into the existing mailer" },
      { ts: iso, text: "why does the reminder fire twice after a snooze?" },
    ],
    touches: [
      { file: "src/auth/reset.ts", project: "web", lang: "typescript", saves: 6, edits: 3, lastTs: iso },
      { file: "src/auth/email.ts", project: "web", lang: "typescript", saves: 4, edits: 2, lastTs: iso },
      { file: "src/pages/login.tsx", project: "web", lang: "typescriptreact", saves: 3, edits: 1, lastTs: iso },
      { file: "src/reminder.ts", project: "web", lang: "typescript", saves: 2, edits: 0, lastTs: iso },
      { file: "README.md", project: "docs", lang: "markdown", saves: 2, edits: 0, lastTs: iso },
    ],
    ...overrides,
  };
}

async function models() {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

function countDoneBullets(text) {
  const lines = text.split("\n");
  let inDone = false;
  let count = 0;
  for (const line of lines) {
    if (/^\*\*/.test(line.trim())) {
      if (inDone) break;
      inDone = true;
      continue;
    }
    if (inDone && /^- /.test(line)) count++;
  }
  return count;
}

test("out-of-the-box default model is checked with actionable guidance", { skip: !E2E }, async () => {
  const installed = await models();
  if (installed.some((m) => m.startsWith("llama3.2"))) {
    return; // default is present; nothing to report
  }
  stub.reset();
  stub.setConfig({ "standup.ollama.url": OLLAMA, "standup.ollama.model": "llama3.2" });
  await assert.rejects(
    generateStandup(ctx()),
    (e) => e instanceof OllamaError && /Model "llama3.2" not found/.test(e.message) && /ollama pull llama3\.2/.test(e.message),
    "with the default settings and llama3.2 missing, the user should get a clear pull instruction",
  );
});

for (const level of ["concise", "standard", "elaborate"]) {
  test(`real model produces a usable ${level} stand-up`, { skip: !E2E }, async (t) => {
    const installed = await models();
    if (installed.length === 0) {
      t.skip("Ollama not reachable or no models installed");
      return;
    }
    const model = FORCE_MODEL || (installed.some((m) => m.startsWith("llama3.2")) ? "llama3.2" : installed[0]);
    stub.reset();
    stub.setConfig({ "standup.ollama.url": OLLAMA, "standup.ollama.model": model });
    setDetailGetter(() => level);

    const started = Date.now();
    const { text: out } = await generateStandup(ctx());
    const elapsed = Date.now() - started;
    t.diagnostic(`${level} on ${model}: ${elapsed}ms, ${out.length} chars, ${countDoneBullets(out)} Done bullets`);

    assert.ok(out.trim().length > 40, "non-trivial output");
    assert.match(out, /\*\*(Done|Yesterday)\*\*/);
    assert.match(out, /\*\*(Next|Today)\*\*/);
    assert.match(out, /\*\*Blockers\*\*/);
    assert.doesNotMatch(out, /<(one accomplishment|when a bullet|path\/one|blockers, or)/, "no template placeholders");
    assert.doesNotMatch(out, /^- (feat|fix|chore|docs|refactor|perf|test)(\(|:)/im, "no conventional-commit prefixes");

    const bullets = countDoneBullets(out);
    assert.ok(bullets >= 1, "at least one Done bullet");
    if (level === "standard") t.diagnostic(`standard asked for 5-7, got ${bullets}`);
    if (level === "elaborate") {
      const named = ["reset.ts", "email.ts", "login.tsx", "reminder.ts", "state.ts", "README.md"].filter((f) =>
        out.includes(f),
      );
      t.diagnostic(`elaborate named ${named.length}/6 files: ${named.join(", ")}`);
      assert.ok(named.length >= 3, `elaborate should name the changed files (got ${named.length}/6)`);
    }
    if (level === "concise") {
      assert.ok(bullets <= 5, `concise should stay short (got ${bullets})`);
    }
  });
}

test("yesterday/today format switches the section headings", { skip: !E2E }, async (t) => {
  const installed = await models();
  if (installed.length === 0) {
    t.skip("Ollama not reachable");
    return;
  }
  const model = FORCE_MODEL || (installed.some((m) => m.startsWith("llama3.2")) ? "llama3.2" : installed[0]);
  stub.reset();
  stub.setConfig({
    "standup.ollama.url": OLLAMA,
    "standup.ollama.model": model,
    "standup.format": "yesterday-today-blockers",
  });
  setDetailGetter(() => "concise");
  const { text: out } = await generateStandup(ctx());
  assert.match(out, /\*\*Yesterday\*\*/);
  assert.match(out, /\*\*Today\*\*/);
  assert.match(out, /\*\*Blockers\*\*/);
});
