const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { EventStore } = require("../dist/agent/src/events/store");
const { eventsDir } = require("../dist/agent/src/config");
const { gatherActivity } = require("../dist/agent/src/activity");

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-activity-"));
  const run = (args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Dev",
        GIT_AUTHOR_EMAIL: "dev@example.com",
        GIT_COMMITTER_NAME: "Dev",
        GIT_COMMITTER_EMAIL: "dev@example.com",
      },
    });
  run(["init", "-q"]);
  run(["config", "user.email", "dev@example.com"]);
  run(["config", "user.name", "Dev"]);
  fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
  run(["add", "a.ts"]);
  run(["commit", "-q", "-m", "feat: add activity source"]);
  return dir;
}

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-activity-home-"));
  const prev = process.env.SHIPLOGUE_HOME;
  const prevIde = process.env.SHIPLOGUE_IDE_PROMPTS;
  process.env.SHIPLOGUE_HOME = home;
  process.env.SHIPLOGUE_IDE_PROMPTS = "0";
  try {
    return await fn(home);
  } finally {
    if (prev === undefined) delete process.env.SHIPLOGUE_HOME;
    else process.env.SHIPLOGUE_HOME = prev;
    if (prevIde === undefined) delete process.env.SHIPLOGUE_IDE_PROMPTS;
    else process.env.SHIPLOGUE_IDE_PROMPTS = prevIde;
  }
}

test("gatherActivity merges agent events with git activity and stats", async () => {
  const repo = tmpRepo();
  await withHome(async () => {
    const store = new EventStore(eventsDir());
    store.append({
      ts: new Date().toISOString(),
      source: "claude-code",
      sessionId: "s1",
      workspaceRoot: repo,
      kind: "prompt",
      actor: "user",
      text: "Add a health endpoint",
      meta: { input_tokens: 10, output_tokens: 5 },
    });
    store.append({
      ts: new Date().toISOString(),
      source: "claude-code",
      sessionId: "s1",
      workspaceRoot: repo,
      kind: "file_edit",
      actor: "agent",
      file: "a.ts",
    });

    const result = await gatherActivity({
      repoPath: repo,
      lookbackHours: 24,
      includeGitHub: false,
      includeIdePrompts: false,
    });
    assert.equal(result.stats.events, 2);
    assert.equal(result.stats.prompts, 1);
    assert.equal(result.stats.fileEdits, 1);
    assert.equal(result.stats.filesTouched, 1);
    assert.equal(result.stats.commits, 1);
    assert.equal(result.stats.tokens.input, 10);
    assert.equal(result.stats.tokens.output, 5);
    assert.equal(result.context.cursorPrompts[0].text, "Add a health endpoint");
    assert.equal(result.context.commits[0].subject, "feat: add activity source");
    assert.equal(result.context.agentSessions[0].source, "claude-code");
  });
});
