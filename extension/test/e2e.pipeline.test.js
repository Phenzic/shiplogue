"use strict";
// Full pipeline against the real local model, with one isolating tweak: the
// proxy raises Ollama's num_predict because the only installed model here is a
// reasoning model whose "thinking" tokens otherwise consume the extension's
// 400/900/1600-token budget before `response` starts (see the e2e.ollama tests).
// Skipped unless SHIPLOGUE_E2E=1.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { installVscodeStub } = require("./helpers");

const { stub } = installVscodeStub();
const { generateStandup } = require("../out/summarize");
const { setDetailGetter } = require("../out/config");

const E2E = process.env.SHIPLOGUE_E2E === "1";
const OLLAMA = process.env.SHIPLOGUE_OLLAMA_URL || "http://localhost:11434";
const FORCE_MODEL = process.env.SHIPLOGUE_OLLAMA_MODEL || "";
const BUDGET = Number(process.env.SHIPLOGUE_E2E_NUM_PREDICT || 4096);

function startProxy(target) {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        /* ignore */
      }
      body.options = { ...(body.options || {}), num_predict: Math.max(BUDGET, body.options?.num_predict || 0) };
      seen.push(body);
      try {
        const upstream = await fetch(`${target}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const text = await upstream.text();
        res.writeHead(upstream.status, { "Content-Type": "application/json" });
        res.end(text);
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        seen,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function ctx() {
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
        body: "Adds POST /auth/reset and email delivery.\nUpdates the login page copy.",
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

for (const level of ["concise", "standard", "elaborate"]) {
  test(`real model + real prompt: usable ${level} draft`, { skip: !E2E }, async (t) => {
    const installed = await models();
    if (installed.length === 0) {
      t.skip("Ollama not reachable or no models installed");
      return;
    }
    const model = FORCE_MODEL || installed[0];
    const proxy = await startProxy(OLLAMA);
    t.after(() => proxy.close());
    stub.reset();
    stub.setConfig({ "shiplogue.ollama.url": proxy.url, "shiplogue.ollama.model": model });
    setDetailGetter(() => level);

    const started = Date.now();
    const { text: out } = await generateStandup(ctx());
    const elapsed = Date.now() - started;
    const bullets = countDoneBullets(out);
    t.diagnostic(`${level} | ${model} | ${elapsed}ms | ${bullets} Done bullets | ${out.length} chars`);
    t.diagnostic(`--- ${level} output ---\n${out}\n--- end ${level} ---`);

    assert.ok(out.trim().length > 40);
    assert.match(out, /\*\*(Done|Yesterday)\*\*/);
    assert.match(out, /\*\*(Next|Today)\*\*/);
    assert.match(out, /\*\*Blockers\*\*/);
    assert.doesNotMatch(out, /<(one accomplishment|when a bullet|path\/one|blockers, or)/);
    assert.doesNotMatch(out, /^- (feat|fix|chore|docs|refactor|perf|test)(\(|:)/im);
    if (level === "standard") assert.ok(bullets >= 3, `standard produced ${bullets} bullets`);
    if (level === "elaborate") assert.ok(bullets >= 4, `elaborate produced ${bullets} bullets`);
  });
}
