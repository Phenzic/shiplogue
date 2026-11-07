const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { installHooks, configFile } = require("../dist/agent/src/hooks/install");

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shiplogue-hooks-"));
}

function command(agent) {
  return `/usr/bin/node /tmp/cli.js hook ${agent} --event test`;
}

test("Claude install preserves user hooks, is idempotent, and uninstalls cleanly", () => {
  const home = tmpHome();
  const file = configFile("claude", home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "echo user-hook" }] },
        ],
      },
    }),
  );

  const first = installHooks("claude", { home, command: command("claude") });
  assert.equal(first.changed, true);
  assert.ok(first.backup);
  const installed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(installed.hooks.SessionStart.length, 2);
  assert.ok(
    installed.hooks.UserPromptSubmit[0].hooks[0].command.includes("hook claude"),
  );
  assert.ok(
    installed.hooks.SessionStart.some((group) =>
      group.hooks.some((handler) => handler.command === "echo user-hook"),
    ),
  );

  const second = installHooks("claude", { home, command: command("claude") });
  assert.equal(second.changed, false);

  const removed = installHooks("claude", {
    home,
    command: command("claude"),
    uninstall: true,
  });
  assert.equal(removed.changed, true);
  const final = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(final.hooks.SessionStart, [
    { hooks: [{ type: "command", command: "echo user-hook" }] },
  ]);
  assert.equal(final.hooks?.UserPromptSubmit, undefined);
});

test("Cursor install writes version 1 hook entries", () => {
  const home = tmpHome();
  const file = configFile("cursor", home);
  const result = installHooks("cursor", { home, command: command("cursor") });
  assert.equal(result.changed, true);
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(config.version, 1);
  assert.ok(Array.isArray(config.hooks.afterFileEdit));
  assert.ok(config.hooks.afterFileEdit[0].command.includes("hook cursor"));
  assert.ok(config.hooks.beforeSubmitPrompt);
});

test("Codex install writes hooks.json and uninstall removes only ours", () => {
  const home = tmpHome();
  const file = configFile("codex", home);
  installHooks("codex", { home, command: command("codex") });
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(config.hooks.UserPromptSubmit);
  installHooks("codex", {
    home,
    command: command("codex"),
    uninstall: true,
  });
  const final = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(final.hooks?.UserPromptSubmit, undefined);
});

test("dry-run reports changes without writing", () => {
  const home = tmpHome();
  const file = configFile("claude", home);
  const result = installHooks("claude", {
    home,
    command: command("claude"),
    dryRun: true,
  });
  assert.equal(result.changed, true);
  assert.equal(fs.existsSync(file), false);
});
