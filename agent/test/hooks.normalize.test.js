const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeHook } = require("../dist/agent/src/hooks/normalize");

test("Claude UserPromptSubmit becomes a user prompt event", () => {
  const [draft] = normalizeHook("claude", {
    session_id: "s1",
    cwd: "/tmp/project",
    hook_event_name: "UserPromptSubmit",
    prompt: "Add a health check",
    prompt_id: "p1",
  });
  assert.equal(draft.source, "claude-code");
  assert.equal(draft.kind, "prompt");
  assert.equal(draft.actor, "user");
  assert.equal(draft.text, "Add a health check");
  assert.equal(draft.sessionId, "s1");
  assert.equal(draft.sourceEventId, "p1");
  assert.equal(draft.workspaceRoot, "/tmp/project");
});

test("Claude PreToolUse captures tool name and shell command without file content", () => {
  const [draft] = normalizeHook("claude", {
    session_id: "s1",
    cwd: "/tmp/project",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "t1",
    tool_input: { command: "npm test", content: "secret file content" },
  });
  assert.equal(draft.kind, "tool_call");
  assert.equal(draft.command, "npm test");
  assert.equal(draft.meta.tool, "Bash");
  assert.equal(draft.text, undefined);
});

test("Claude SessionStart/End and Stop map to lifecycle/response events", () => {
  const start = normalizeHook("claude", {
    hook_event_name: "SessionStart",
    session_id: "s1",
    cwd: "/tmp/project",
  })[0];
  assert.equal(start.kind, "session_start");
  const stop = normalizeHook("claude", {
    hook_event_name: "Stop",
    session_id: "s1",
    cwd: "/tmp/project",
    last_assistant_message: "All done",
  })[0];
  assert.equal(stop.kind, "response");
  assert.equal(stop.text, "All done");
  const end = normalizeHook("claude", {
    hook_event_name: "SessionEnd",
    session_id: "s1",
    cwd: "/tmp/project",
    reason: "completed",
  })[0];
  assert.equal(end.kind, "session_end");
  assert.equal(end.text, "completed");
});

test("Cursor afterFileEdit records relative file and diff stats", () => {
  const [draft] = normalizeHook(
    "cursor",
    {
      file_path: "/tmp/project/src/a.ts",
      edits: [{ old_string: "a\nb", new_string: "a\nb\nc" }],
    },
    { eventHint: "afterFileEdit", cwd: "/tmp/project" },
  );
  assert.equal(draft.source, "cursor");
  assert.equal(draft.kind, "file_edit");
  assert.equal(draft.file, "src/a.ts");
  assert.deepEqual(draft.diff, { added: 3, removed: 2 });
});

test("Cursor afterShellExecution captures the command and output", () => {
  const [draft] = normalizeHook(
    "cursor",
    { command: "npm test", output: "ok", duration: 42 },
    { eventHint: "afterShellExecution", cwd: "/tmp/project" },
  );
  assert.equal(draft.kind, "shell");
  assert.equal(draft.command, "npm test");
  assert.equal(draft.text, "ok");
  assert.equal(draft.meta.duration_ms, 42);
});

test("Cursor beforeSubmitPrompt works with an event hint", () => {
  const [draft] = normalizeHook(
    "cursor",
    { prompt: "Refactor auth", session_id: "c1", cwd: "/tmp/project" },
    { eventHint: "beforeSubmitPrompt", cwd: "/tmp/project" },
  );
  assert.equal(draft.kind, "prompt");
  assert.equal(draft.text, "Refactor auth");
});

test("Codex UserPromptSubmit and apply_patch produce expected events", () => {
  const [prompt] = normalizeHook("codex", {
    session_id: "x1",
    cwd: "/tmp/project",
    hook_event_name: "UserPromptSubmit",
    prompt: "Ship the parser",
  });
  assert.equal(prompt.source, "codex");
  assert.equal(prompt.kind, "prompt");

  const files = normalizeHook("codex", {
    session_id: "x1",
    cwd: "/tmp/project",
    hook_event_name: "PostToolUse",
    tool_name: "apply_patch",
    tool_use_id: "t1",
    tool_input: {
      patch: "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n+more\n*** End Patch",
    },
  });
  assert.equal(files.length, 1);
  assert.equal(files[0].kind, "file_edit");
  assert.equal(files[0].file, "src/a.ts");
  assert.deepEqual(files[0].diff, { added: 2, removed: 1 });
});

test("Codex notify agent-turn-complete becomes prompt + response", () => {
  const drafts = normalizeHook("codex", {
    type: "agent-turn-complete",
    "thread-id": "th1",
    "input-messages": ["Rename foo to bar"],
    "last-assistant-message": "Renamed it.",
    cwd: "/tmp/project",
  });
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].kind, "prompt");
  assert.equal(drafts[1].kind, "response");
  assert.equal(drafts[1].text, "Renamed it.");
});

test("unknown hook events are ignored rather than throwing", () => {
  assert.deepEqual(normalizeHook("claude", { hook_event_name: "SomethingNew" }), []);
});
