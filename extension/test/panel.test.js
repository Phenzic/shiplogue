"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const { installVscodeStub, tmpDir, makeContext, startServer } = require("./helpers");

const { stub } = installVscodeStub();
const { StandupPanel } = require("../out/standupPanel");
const { State } = require("../out/state");
const { setDetailGetter, setToneGetter } = require("../out/config");
const { toPlainText } = require("../out/format");

function freshPanel(detail = "concise") {
  if (StandupPanel.current) StandupPanel.current.dispose();
  stub.reset();
  setDetailGetter(() => detail);
  setToneGetter(() => "neutral");
  stub.setConfig({ "standup.webhook.type": "none", "standup.webhook.url": "" });
  const state = new State(makeContext(tmpDir()));
  let regenerated = 0;
  const panel = StandupPanel.show(() => regenerated++, state);
  const webview = stub.panels.at(-1);
  return { panel, state, webview, regenerated: () => regenerated };
}

function makeEl(id, dataset = {}) {
  const classes = new Set();
  return {
    id,
    dataset,
    value: "",
    placeholder: "",
    textContent: "",
    className: "",
    style: {},
    onclick: null,
    listeners: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    addEventListener(ev, fn) {
      this.listeners[ev] = fn;
    },
  };
}

// Execute the panel's inline <script> against a tiny DOM so UI logic is tested.
function bootWebview(html) {
  const els = {
    md: makeEl("md"),
    txt: makeEl("txt"),
    status: makeEl("status"),
    meta: makeEl("meta"),
    send: makeEl("send"),
    regen: makeEl("regen"),
    cancel: makeEl("cancel"),
    copy: makeEl("copy"),
    detail: makeEl("detail"),
    tone: makeEl("tone"),
    "pane-md": makeEl("pane-md"),
    "pane-txt": makeEl("pane-txt"),
  };
  const tabs = [makeEl("tab-md", { pane: "md" }), makeEl("tab-txt", { pane: "txt" })];
  tabs[0].classList.add("active");
  els["pane-md"].classList.add("active");

  const posted = [];
  let windowListener;
  const document = {
    getElementById: (id) => els[id],
    querySelectorAll: (sel) => (sel === ".tab" ? tabs : sel === ".pane" ? [els["pane-md"], els["pane-txt"]] : []),
  };
  const sandbox = {
    document,
    acquireVsCodeApi: () => ({ postMessage: (m) => posted.push(m) }),
    window: {
      addEventListener: (ev, fn) => {
        windowListener = fn;
      },
    },
    console,
  };
  const context = vm.createContext(sandbox);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context, { filename: "standup-webview.js" });
  return {
    els,
    tabs,
    posted,
    context,
    sendMessage: (data) => windowListener({ data }),
    toPlain: (s) => vm.runInContext(`toPlainText(${JSON.stringify(s)})`, context),
  };
}

test("panel renders markdown/plain tabs, detail picker and actions", () => {
  const { webview } = freshPanel("standard");
  const html = webview.webview.html;
  assert.match(html, /id="md"/);
  assert.match(html, /id="txt"/);
  assert.match(html, /Markdown/);
  assert.match(html, /Plain text/);
  assert.match(html, /value="concise"/);
  assert.match(html, /value="standard" selected/);
  assert.match(html, /value="elaborate"/);
  assert.match(html, /id="copy"/);
  assert.match(html, /id="regen"/);
  // The inline script must at least parse as JavaScript.
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
});

test("the webview's plain-text mirror matches format.ts exactly", () => {
  const { webview } = freshPanel();
  const ui = bootWebview(webview.webview.html);
  const samples = [
    "**Done**\n- Fixed the [login flow](https://github.com/acme/demo/pull/12)",
    "## Heading\n* star bullet\n- [x](https://a.b/c?d=1)",
    toPlainText("**Next**\n- Nothing\n"),
    "plain text, no markdown at all",
  ];
  for (const s of samples) {
    assert.equal(ui.toPlain(s), toPlainText(s), `mismatch for ${JSON.stringify(s)}`);
  }
});

test("loading, draft and error messages drive the UI", () => {
  const { webview } = freshPanel();
  const ui = bootWebview(webview.webview.html);

  ui.sendMessage({ kind: "loading", label: "Writing your stand-up…" });
  assert.equal(ui.els.md.value, "");
  assert.equal(ui.els.md.placeholder, "Writing your stand-up…");
  assert.equal(ui.els.status.textContent, "Writing your stand-up…");

  const markdown = "**Done**\n- Shipped it";
  ui.sendMessage({
    kind: "draft",
    markdown,
    summary: { commits: 2, files: 3, github: 1 },
    detail: "standard",
    target: "discord",
  });
  assert.equal(ui.els.md.value, markdown);
  assert.equal(ui.els.txt.value, toPlainText(markdown));
  assert.equal(ui.els.meta.textContent, "2 commits · 3 files · 1 GitHub items");
  assert.equal(ui.els.status.textContent, "Review and edit, then copy or send.");
  assert.equal(ui.els.send.style.display, "inline-block");
  assert.equal(ui.els.send.textContent, "Send to discord");
  assert.equal(ui.els.detail.value, "standard");

  ui.sendMessage({ kind: "draft", markdown, summary: {}, detail: "concise", target: "" });
  assert.equal(ui.els.send.style.display, "none");

  ui.sendMessage({ kind: "error", message: "Couldn't reach Ollama" });
  assert.equal(ui.els.status.textContent, "Couldn't reach Ollama");
  assert.equal(ui.els.status.className, "err");
});

test("copying respects the active tab; editing plain text survives markdown sync", () => {
  const { webview } = freshPanel();
  const ui = bootWebview(webview.webview.html);
  const markdown = "**Done**\n- Shipped it";
  ui.sendMessage({ kind: "draft", markdown, summary: {}, detail: "concise", target: "" });

  ui.els.copy.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.posted.at(-1))), { kind: "copy", text: markdown, label: "markdown" });

  ui.tabs[1].onclick();
  assert.equal(ui.els["pane-txt"].classList.contains("active"), true);
  assert.equal(ui.els["pane-md"].classList.contains("active"), false);

  ui.els.txt.value = "my hand-edited update";
  ui.els.txt.listeners.input();
  ui.els.md.value = "**Done**\n- changed later";
  ui.els.md.listeners.input();
  assert.equal(ui.els.txt.value, "my hand-edited update", "manual plain-text edits are not clobbered");

  ui.els.copy.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.posted.at(-1))), { kind: "copy", text: "my hand-edited update", label: "plain text" });

  ui.els.send.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.posted.at(-1))), {
    kind: "send",
    text: "my hand-edited update",
    markdown: "**Done**\n- changed later",
  });

  ui.els.regen.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.posted.at(-1))), { kind: "regenerate" });

  ui.els.detail.value = "elaborate";
  ui.els.detail.onchange({ target: { value: "elaborate" } });
  assert.deepEqual(JSON.parse(JSON.stringify(ui.posted.at(-1))), { kind: "setDetail", detail: "elaborate" });
});

test("panel messages: copy writes the clipboard and notifies", async () => {
  const { webview } = freshPanel();
  await webview.messageHandler({ kind: "copy", text: "hello", label: "markdown" });
  assert.equal(stub.clipboard, "hello");
  assert.match(stub.notifications.at(-1).message, /Copied markdown/);
});

test("panel messages: setDetail persists globally and regenerates", async () => {
  const { webview, state, regenerated } = freshPanel();
  await webview.messageHandler({ kind: "setDetail", detail: "elaborate" });
  assert.equal(state.getDetail(), "elaborate");
  assert.deepEqual(stub.configUpdates.at(-1), {
    key: "standup.detail",
    value: "elaborate",
    target: 1,
  });
  assert.equal(regenerated(), 1);
});

test("panel messages: send posts the active text to the webhook", async () => {
  const server = await startServer(() => ({ status: 204 }));
  const { webview } = freshPanel();
  stub.setConfig({ "standup.webhook.type": "slack", "standup.webhook.url": server.url });
  try {
    await webview.messageHandler({ kind: "send", text: "stand-up body" });
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].body.text, "stand-up body");
    assert.match(stub.notifications.at(-1).message, /Stand-up posted/);
  } finally {
    await server.close();
  }
});

test("panel messages: a failed send shows the error instead of throwing", async () => {
  const server = await startServer(() => ({ status: 500, body: "nope" }));
  const { webview } = freshPanel();
  stub.setConfig({ "standup.webhook.type": "slack", "standup.webhook.url": server.url });
  try {
    await webview.messageHandler({ kind: "send", text: "body" });
    assert.match(stub.errors.at(-1).message, /Post failed: .*500/);
  } finally {
    await server.close();
  }
});

test("showing the panel twice reuses the same webview", () => {
  const { panel } = freshPanel();
  const state = new State(makeContext(tmpDir()));
  const again = StandupPanel.show(() => {}, state);
  assert.equal(again, panel);
  assert.equal(stub.panels.length, 1);
  assert.equal(stub.panels[0].visible, true);
});

test("a draft with grounding warnings shows them in the status line", () => {
  const { webview } = freshPanel();
  const ui = bootWebview(webview.webview.html);
  ui.sendMessage({
    kind: "draft",
    markdown: "**Done**\n- Shipped it",
    summary: { commits: 1, files: 0, github: 0 },
    warnings: ["⚠ Removed 2 unverifiable mention(s): src/invented.ts, #999"],
    detail: "concise",
    target: "",
  });
  assert.match(ui.els.status.textContent, /Removed 2 unverifiable mention\(s\)/);
  assert.match(ui.els.status.textContent, /src\/invented\.ts/);
});

test("summary notes render in the meta line", () => {
  const { webview } = freshPanel();
  const ui = bootWebview(webview.webview.html);
  ui.sendMessage({
    kind: "draft",
    markdown: "**Done**\n- Shipped it",
    summary: { commits: 25, files: 3, github: 0, notes: ["showing 25 of 40 commits (most recent)"] },
    detail: "concise",
    target: "",
  });
  assert.match(ui.els.meta.textContent, /25 commits · 3 files/);
  assert.match(ui.els.meta.textContent, /showing 25 of 40 commits \(most recent\)/);
});

test("busy state: loading disables Regenerate/Detail and shows Cancel; draft/error/cancelled reset", () => {
  const { webview } = freshPanel();
  const ui = bootWebview(webview.webview.html);

  ui.sendMessage({ kind: "loading", label: "Writing your stand-up…" });
  assert.equal(ui.els.regen.disabled, true);
  assert.equal(ui.els.detail.disabled, true);
  assert.equal(ui.els.tone.disabled, true);
  assert.equal(ui.els.cancel.style.display, "inline-block");

  ui.els.cancel.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.posted.at(-1))), { kind: "cancel" });

  ui.sendMessage({ kind: "draft", markdown: "**Done**\n- x", summary: {}, detail: "concise", target: "" });
  assert.equal(ui.els.regen.disabled, false);
  assert.equal(ui.els.detail.disabled, false);
  assert.equal(ui.els.tone.disabled, false);
  assert.equal(ui.els.cancel.style.display, "none");

  ui.sendMessage({ kind: "loading", label: "again" });
  ui.sendMessage({ kind: "cancelled", message: "Cancelled." });
  assert.equal(ui.els.regen.disabled, false);
  assert.equal(ui.els.cancel.style.display, "none");
  assert.equal(ui.els.status.textContent, "Cancelled.");

  ui.sendMessage({ kind: "loading", label: "again" });
  ui.sendMessage({ kind: "error", message: "boom" });
  assert.equal(ui.els.regen.disabled, false);
  assert.equal(ui.els.cancel.style.display, "none");
});

test("panel messages: cancel invokes the onCancel callback", async () => {
  if (StandupPanel.current) StandupPanel.current.dispose();
  stub.reset();
  setDetailGetter(() => "concise");
  stub.setConfig({ "standup.webhook.type": "none" });
  const state = new State(makeContext(tmpDir()));
  let cancelled = 0;
  StandupPanel.show(() => {}, state, () => cancelled++);
  await stub.panels.at(-1).messageHandler({ kind: "cancel" });
  assert.equal(cancelled, 1);
});

test("slack send posts the converted Markdown tab even when plain text is active", async () => {
  const server = await startServer(() => ({ status: 200, body: "ok" }));
  const { webview } = freshPanel();
  stub.setConfig({ "standup.webhook.type": "slack", "standup.webhook.url": server.url });
  try {
    await webview.messageHandler({
      kind: "send",
      text: "plain tab text (active)",
      markdown: "**Done**\n- Shipped the [login flow](https://github.com/a/b/pull/1)",
    });
    const sent = server.requests[0].body.text;
    assert.match(sent, /\*Done\*/);
    assert.ok(!sent.includes("**"), "no Markdown double-stars sent to Slack");
    assert.match(sent, /<https:\/\/github\.com\/a\/b\/pull\/1\|login flow>/);
    assert.ok(!sent.includes("plain tab text"), "the active plain-text tab is ignored for Slack");
  } finally {
    await server.close();
  }
});

test("discord truncation copies the full text to the clipboard and says so", async () => {
  const server = await startServer(() => ({ status: 204 }));
  const { webview } = freshPanel();
  stub.setConfig({ "standup.webhook.type": "discord", "standup.webhook.url": server.url });
  try {
    const line = "word ".repeat(200).trim();
    const long = Array.from({ length: 12 }, (_, i) => `line${i} ${line}`).join("\n");
    await webview.messageHandler({ kind: "send", text: long });
    assert.equal(server.requests.length, 3);
    assert.equal(stub.clipboard, long, "full text copied");
    assert.match(stub.notifications.at(-1).message, /truncated; full text copied to clipboard/);
  } finally {
    await server.close();
  }
});

test("panel messages: setTone persists globally and regenerates", async () => {
  const { webview, state, regenerated } = freshPanel();
  await webview.messageHandler({ kind: "setTone", tone: "senior" });
  assert.equal(state.getTone(), "senior");
  assert.deepEqual(stub.configUpdates.at(-1), {
    key: "standup.tone",
    value: "senior",
    target: 1,
  });
  assert.equal(regenerated(), 1);
});

test("the tone select renders, syncs from init/draft and posts setTone", () => {
  const { webview } = freshPanel();
  const ui = bootWebview(webview.webview.html);
  assert.match(webview.webview.html, /id="tone"/);
  assert.match(webview.webview.html, /value="senior"/);

  ui.sendMessage({ kind: "init", detail: "concise", tone: "mid" });
  assert.equal(ui.els.tone.value, "mid");
  ui.sendMessage({ kind: "draft", markdown: "**Done**\n- x", summary: {}, detail: "concise", tone: "senior", target: "" });
  assert.equal(ui.els.tone.value, "senior");

  ui.els.tone.value = "junior";
  ui.els.tone.onchange({ target: { value: "junior" } });
  assert.deepEqual(JSON.parse(JSON.stringify(ui.posted.at(-1))), { kind: "setTone", tone: "junior" });
});
