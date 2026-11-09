const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Client, InMemoryTransport } = require("@modelcontextprotocol/client");

const { createServer } = require("../dist/agent/src/mcp/server");
const { EventStore } = require("../dist/agent/src/events/store");
const { eventsDir } = require("../dist/agent/src/config");
const { latestDraftDate } = require("../dist/agent/src/drafts/store");

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-mcp-"));
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
  run(["commit", "-q", "-m", "feat: add mcp coverage"]);
  return dir;
}

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-mcp-home-"));
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

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "shiplogue-test", version: "1.0.0" });
  const server = createServer("0.3.0-dev.1");
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, server };
}

const MARKDOWN = [
  "Hey team, here's what I worked on today:",
  "",
  "Added the MCP coverage path.",
  "",
  "**Yesterday**",
  "- Finished the previous task",
  "**Today**",
  "",
  "### MCP coverage [feature]",
  "Added a tested MCP path.",
  "  - a.ts",
  "**Next**",
  "- None",
  "**Blockers**",
  "- None",
].join("\n");

test("MCP server lists the agent-native tool set and saves a draft", async () => {
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
      text: "Add MCP coverage",
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

    const { client } = await connect();
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        "get_activity",
        "get_agent_status",
        "render_standup",
        "revise_standup",
        "save_standup",
      ],
    );

    const activity = await client.callTool({
      name: "get_activity",
      arguments: { repoPath: repo, includeIdePrompts: false, includeGitHub: false },
    });
    assert.match(activity.content[0].text, /Shiplogue activity/);
    assert.match(activity.content[0].text, /Add MCP coverage/);

    const saved = await client.callTool({
      name: "save_standup",
      arguments: { markdown: MARKDOWN, repoPath: repo, source: "claude-code" },
    });
    assert.match(saved.content[0].text, /Saved Shiplogue draft/);
    assert.ok(latestDraftDate());

    const rendered = await client.callTool({
      name: "render_standup",
      arguments: {},
    });
    assert.match(rendered.content[0].text, /MCP coverage/);

    const status = await client.callTool({
      name: "get_agent_status",
      arguments: {},
    });
    const parsed = JSON.parse(status.content[0].text);
    assert.equal(parsed.agent, "0.3.0-dev.1");
    assert.ok(parsed.paths.events);

    await client.close();
  });
});
