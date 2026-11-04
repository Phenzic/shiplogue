"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { collectChatSessionPrompts } = require("../out/promptSources");

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-chat-"));
  const app = path.join(base, "Code");
  const user = path.join(app, "User");
  const hash = path.join(user, "workspaceStorage", "abc123");
  const sessions = path.join(hash, "chatSessions");
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(hash, "workspace.json"), JSON.stringify({ folder: "file:///work/project" }));
  const ts = Date.now();
  fs.writeFileSync(
    path.join(sessions, "s1.jsonl"),
    [
      JSON.stringify({
        kind: 0,
        v: {
          sessionId: "s1",
          creationDate: ts,
          requests: [
            { message: { role: "user", text: "How do I fix the login flow?" }, timestamp: ts },
            { message: { role: "assistant", text: "Try the auth guard." }, timestamp: ts },
          ],
        },
      }),
    ].join("\n"),
  );
  return { app, sessions, ts };
}

test("reads VS Code/Antigravity chat-session prompts, not assistant replies", async () => {
  const { app, ts } = fixture();
  const old = process.env.SHIPLOGUE_CHAT_ROOTS;
  process.env.SHIPLOGUE_CHAT_ROOTS = app;
  try {
    const out = await collectChatSessionPrompts(new Date(ts - 1000), new Date(ts + 1000), null);
    assert.equal(out.length, 1);
    assert.equal(out[0].text, "How do I fix the login flow?");
    assert.equal(out[0].source, "vscode");
  } finally {
    if (old === undefined) delete process.env.SHIPLOGUE_CHAT_ROOTS;
    else process.env.SHIPLOGUE_CHAT_ROOTS = old;
  }
});

test("workspace scoping rejects sessions for another folder", async () => {
  const { app, ts } = fixture();
  const old = process.env.SHIPLOGUE_CHAT_ROOTS;
  process.env.SHIPLOGUE_CHAT_ROOTS = app;
  try {
    assert.equal((await collectChatSessionPrompts(new Date(ts - 1000), new Date(ts + 1000), ["/work/project"])).length, 1);
    assert.equal((await collectChatSessionPrompts(new Date(ts - 1000), new Date(ts + 1000), ["/elsewhere"])).length, 0);
  } finally {
    if (old === undefined) delete process.env.SHIPLOGUE_CHAT_ROOTS;
    else process.env.SHIPLOGUE_CHAT_ROOTS = old;
  }
});
