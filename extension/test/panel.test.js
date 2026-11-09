"use strict";
// The panel webview (media/panel.js) and its message protocol.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, tmpDir, makeContext } = require("./helpers");
const { bootWebview } = require("./webview-harness");

const { stub } = installVscodeStub();
const { ShiploguePanel } = require("../out/shiploguePanel");
const { State } = require("../out/state");
const { setDetailGetter, setToneGetter } = require("../out/config");
const { toPlainText } = require("../out/format");
const { setDeliveryState } = require("../out/delivery");

function freshPanel(detail = "concise", callbacks = {}) {
  if (ShiploguePanel.current) ShiploguePanel.current.dispose();
  stub.reset();
  setDetailGetter(() => detail);
  setToneGetter(() => "neutral");
  stub.setConfig({ "shiplogue.detail": detail, "shiplogue.tone": "neutral" });
  const state = new State(makeContext(tmpDir()));
  const panel = ShiploguePanel.show(
    {
      onRegenerate: callbacks.onRegenerate || (() => {}),
      onCancel: callbacks.onCancel,
      onCopy: callbacks.onCopy,
      onHistoryRequest: callbacks.onHistoryRequest,
      onRestore: callbacks.onRestore,
      onSyncStored: callbacks.onSyncStored,
      onSend: callbacks.onSend,
      onFeedback: callbacks.onFeedback,
    },
    state,
  );
  const webview = stub.panels.at(-1);
  // Boot the client with webview→extension messages routed back into the panel.
  const boot = () =>
    bootWebview(webview.webview.html, {
      onPost: (m) => {
        void webview.messageHandler?.(m);
      },
    });
  return { panel, state, webview, boot };
}

const DRAFT = [
  "Hey team, here's what I worked on today:",
  "",
  "**Done**",
  "- Shipped multi-target posting with per-target failure isolation.",
  "- Fixed the portal crash in src/invented.ts",
  "",
  "**Next**",
  "- *(inferred)* Wire the agent watcher into the panel.",
  "",
  "**Blockers**",
  "- None",
].join("\n");

const VERIFIED = {
  checkedClaims: 18,
  removed: 0,
  inferred: 1,
  violations: [],
  needsReview: false,
};

const REVIEW = {
  checkedClaims: 18,
  removed: 1,
  inferred: 0,
  violations: ["path: src/invented.ts", "number: #999"],
  needsReview: true,
};

test("panel loads media assets with a strict CSP and references them by uri", () => {
  const { webview, boot } = freshPanel();
  const html = webview.webview.html;
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'nonce-[^']+'/);
  assert.match(html, /href="file:\/\/.*panel\.css"/);
  assert.match(html, /src="file:\/\/.*panel\.js"/);
  assert.equal(webview.options.localResourceRoots.length, 1);
});

test("the webview's plain-text mirror matches format.ts exactly", () => {
  const { webview, boot } = freshPanel();
  const ui = boot();
  const samples = [
    "**Done**\n- Fixed the [login flow](https://github.com/acme/demo/pull/12)",
    "## Heading\n* star bullet\n- [x](https://a.b/c?d=1)",
    toPlainText("**Next**\n- Nothing\n"),
    "- sub\n  - nested item",
  ];
  for (const s of samples) {
    assert.equal(ui.hooks.toPlainText(s), toPlainText(s), `mismatch for: ${JSON.stringify(s)}`);
  }
});

test("a draft renders the preview, counts, verdict and status line", () => {
  const { webview, boot } = freshPanel();
  const ui = boot();
  ui.sendMessage({
    kind: "draft",
    markdown: DRAFT,
    summary: { commits: 3, files: 5, github: 2 },
    modelLabel: "Ollama · gpt-oss:20b",
    verification: VERIFIED,
    generatedAt: new Date(Date.now() - 120000).toISOString(),
    stats: { durationMs: 12000, outputTokens: 1240 },
    detail: "standard",
    tone: "senior",
    target: "",
  });

  assert.match(ui.text("metaCounts"), /3 commits · 5 files · 2 GitHub items/);
  assert.match(ui.text("modelLabel"), /Ollama · gpt-oss:20b/);
  assert.equal(ui.visible("verdict"), true);
  assert.match(ui.text("verdictLabel"), /Verified/);

  // Preview renders structure (not the raw textarea).
  const preview = ui.text("preview");
  assert.match(preview, /Shipped multi-target posting/);
  assert.match(preview, /\(inferred\)/);
  assert.match(preview, /Blockers/);

  // Verification strip.
  assert.equal(ui.visible("verifyStrip"), true);
  assert.match(ui.text("verifyText"), /18 claims verified/);
  assert.match(ui.text("verifyRemovals"), /1 inferred/);

  // Status bar + selects + hidden Send (no delivery in this build).
  assert.match(ui.text("statusText"), /Ready · generated 2m ago · 12s · 1,240 tokens/);
  assert.equal(ui.els.detail.value, "standard");
  assert.equal(ui.els.tone.value, "senior");
  assert.equal(ui.visible("sendBtn"), false);
});

test("needs-review drafts are flagged and unverified claims are highlighted inline", () => {
  const { webview, boot } = freshPanel();
  const ui = boot();
  ui.sendMessage({
    kind: "draft",
    markdown: DRAFT,
    summary: { commits: 1, files: 1, github: 0 },
    verification: REVIEW,
    target: "",
  });
  assert.equal(ui.els.verdict.classList.contains("bad"), true);
  assert.match(ui.text("verdictLabel"), /Needs review/);
  assert.equal(ui.els.verifyStrip.classList.contains("bad"), true);
  assert.match(ui.text("verifyText"), /2 claims to check/);
  const marks = [];
  (function walk(node) {
    if (node.className === "unverified") marks.push(node.textContent);
    (node.children || []).forEach(walk);
  })(ui.els.preview);
  assert.ok(marks.includes("src/invented.ts"), `expected an inline mark, got ${JSON.stringify(marks)}`);
});

test("busy state: loading disables controls, hides thumbs, and draft resets", () => {
  const { webview, boot } = freshPanel();
  const ui = boot();

  ui.sendMessage({ kind: "loading", label: "Gathering commits…" });
  assert.equal(ui.els.regenBtn.disabled, true);
  assert.equal(ui.els.detail.disabled, true);
  assert.equal(ui.els.tone.disabled, true);
  assert.equal(ui.visible("cancelBtn"), true);
  assert.equal(ui.visible("thumbs"), false);
  assert.match(ui.text("statusText"), /Gathering commits/);

  ui.sendMessage({ kind: "draft", markdown: DRAFT, summary: {}, detail: "concise", tone: "neutral" });
  assert.equal(ui.els.regenBtn.disabled, false);
  assert.equal(ui.visible("cancelBtn"), false);
  assert.equal(ui.visible("thumbs"), true);
});

test("tabs and modes switch views", () => {
  const { webview, boot } = freshPanel();
  const ui = boot();
  assert.equal(ui.visible("viewDraft"), true);
  assert.equal(ui.visible("viewHistory"), false);

  ui.click("tabHistory");
  assert.equal(ui.visible("viewHistory"), true);
  assert.equal(ui.visible("viewDraft"), false);

  ui.click("tabDraft");
  assert.equal(ui.visible("viewDraft"), true);

  ui.click("segMarkdown");
  assert.equal(ui.visible("paneMd"), true);
  assert.equal(ui.visible("panePreview"), false);
  ui.click("segPlain");
  assert.equal(ui.visible("paneTxt"), true);
  ui.click("segPreview");
  assert.equal(ui.visible("panePreview"), true);
});

test("opening history asks the extension for a page; a page renders grouped rows", () => {
  const asked = [];
  const { webview, boot } = freshPanel("concise", {
    onHistoryRequest: (opts) => asked.push(opts),
  });
  const ui = boot();
  ui.click("tabHistory");
  assert.deepEqual(asked, [{}]);

  const now = Date.now();
  ui.sendMessage({
    kind: "historyPage",
    canSend: true,
    entries: [
      {
        id: "a",
        ts: new Date(now - 60000).toISOString(),
        markdown: "**Done**\n- Shipped the thing",
        detail: "standard",
        tone: "senior",
        modelLabel: "Ollama · gpt-oss:20b",
        sentTo: ["slack"],
        needsReview: false,
        copied: false,
        verification: VERIFIED,
      },
      {
        id: "b",
        ts: new Date(now - 86400000).toISOString(),
        markdown: "**Done**\n- Older draft",
        detail: "concise",
        tone: "neutral",
        sentTo: [],
        needsReview: true,
        copied: false,
      },
    ],
    cursor: "b",
  });

  assert.match(ui.text("histList"), /Today/);
  assert.match(ui.text("histList"), /Yesterday/);
  assert.match(ui.text("histList"), /Sent/);
  assert.match(ui.text("histList"), /Needs review/);
  assert.equal(ui.visible("histMore"), true);
  assert.match(ui.text("histTitle"), /·/);
  assert.match(ui.text("histDraft"), /Shipped the thing/);
  assert.match(ui.text("histSent"), /Sent to slack/);
});

test("history actions route to the extension (restore / sync / more / search)", async () => {
  const events = [];
  const { webview, boot } = freshPanel("concise", {
    onHistoryRequest: (opts) => events.push(["history", opts]),
    onRestore: (id) => events.push(["restore", id]),
    onSyncStored: (id) => events.push(["syncStored", id]),
  });
  const ui = boot();
  ui.click("tabHistory");
  ui.sendMessage({
    kind: "historyPage",
    canSend: true,
    entries: [
      {
        id: "a",
        ts: new Date().toISOString(),
        markdown: "**Done**\n- x",
        detail: "concise",
        tone: "neutral",
        sentTo: [],
        needsReview: false,
        copied: false,
      },
    ],
  });
  ui.click("histRestore");
  ui.click("histSend");
  ui.input("histSearch", "deploy");
  await new Promise((r) => setTimeout(r, 300));
  ui.click("histMore");
  assert.deepEqual(events[0], ["history", {}]); // opening the tab asks for page 1
  assert.deepEqual(events[1], ["restore", "a"]);
  assert.deepEqual(events[2], ["syncStored", "a"]);
  assert.deepEqual(events[3], ["history", { query: "deploy" }]);
  assert.deepEqual(events[4], ["history", {}]); // "load more" with no cursor → page 1
});

test("copy reports the format and the draft id it came from", async () => {
  const copied = [];
  const { webview, boot } = freshPanel("concise", {
    onCopy: (format, text, id) => copied.push([format, text, id]),
  });
  const ui = boot();
  ui.sendMessage({
    kind: "draft",
    markdown: DRAFT,
    summary: {},
    draftId: "draft-123",
    detail: "concise",
    tone: "neutral",
    target: "",
  });
  ui.click("copyBtn");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(copied.length, 1);
  assert.equal(copied[0][0], "markdown");
  assert.equal(copied[0][1], DRAFT);
  assert.equal(copied[0][2], "draft-123");

  ui.click("segPlain");
  ui.click("copyBtn");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(copied[1][0], "plain");
  assert.match(copied[1][1], /• Shipped multi-target posting/);
});

test("panel messages: regenerate, cancel, detail, tone, settings and feedback", async () => {
  const calls = { regen: 0, cancel: 0, feedback: [] };
  const { webview, boot } = freshPanel("concise", {
    onRegenerate: () => calls.regen++,
    onCancel: () => calls.cancel++,
    onFeedback: (value, backend) => calls.feedback.push([value, backend]),
  });
  const ui = boot();
  ui.click("regenBtn");
  ui.click("cancelBtn");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.regen, 1);
  assert.equal(calls.cancel, 1);

  await webview.messageHandler({ kind: "setDetail", detail: "elaborate" });
  await webview.messageHandler({ kind: "setTone", tone: "senior" });
  const upd = stub.configUpdates.filter(
    (u) => u.key === "shiplogue.detail" || u.key === "shiplogue.tone",
  );
  assert.deepEqual(upd.map((u) => u.value), ["elaborate", "senior"]);
  assert.equal(calls.regen, 1, "changing detail/tone must not regenerate");

  await webview.messageHandler({ kind: "feedback", value: "down", backend: "Ollama" });
  assert.deepEqual(calls.feedback, [["down", "Ollama"]]);

  await webview.messageHandler({ kind: "openSettings" });
  assert.deepEqual(stub.executedCommands.at(-1), {
    id: "workbench.action.openSettings",
    args: "shiplogue",
  });
});

test("thumbs are hidden until a draft exists and post the backend label", () => {
  const { webview, boot } = freshPanel();
  const ui = boot();
  assert.equal(ui.visible("thumbs"), false);
  ui.sendMessage({ kind: "draft", markdown: DRAFT, summary: {}, modelLabel: "Ollama · m", target: "" });
  assert.equal(ui.visible("thumbs"), true);
  ui.click("thumbUp");
  assert.deepEqual(ui.posted.at(-1), { kind: "feedback", value: "up", backend: "Ollama · m" });
});

test("showing the panel twice reuses the same webview", () => {
  const { panel } = freshPanel();
  const state = new State(makeContext(tmpDir()));
  const again = ShiploguePanel.show({ onRegenerate: () => {} }, state);
  assert.equal(again, panel);
  assert.equal(stub.panels.length, 1);
  assert.equal(stub.panels[0].visible, true);
});

test("showHistoryView before the webview is ready flushes once it reports ready", async () => {
  const { panel, webview } = freshPanel();
  panel.showHistoryView();
  assert.equal(webview.messages.filter((m) => m.kind === "openHistory").length, 0);

  await webview.messageHandler({ kind: "ready" });
  assert.equal(webview.messages.filter((m) => m.kind === "openHistory").length, 1);
  // init is re-sent on ready so the selects match settings.
  assert.ok(webview.messages.some((m) => m.kind === "init"));
});

test("Sync is only offered when cloud delivery exists", () => {
  const { webview, boot } = freshPanel();
  const ui = boot();
  ui.click("tabHistory");
  ui.sendMessage({
    kind: "historyPage",
    canSend: false,
    entries: [
      {
        id: "a",
        ts: new Date().toISOString(),
        markdown: "**Done**\n- x",
        detail: "concise",
        tone: "neutral",
        sentTo: ["slack"],
        needsReview: false,
        copied: false,
      },
    ],
  });
  assert.equal(ui.visible("histSend"), false, "posting is not part of this build");
  ui.sendMessage({
    kind: "historyPage",
    canSend: true,
    entries: [
      {
        id: "b",
        ts: new Date().toISOString(),
        markdown: "**Done**\n- y",
        detail: "concise",
        tone: "neutral",
        sentTo: [],
        needsReview: false,
        copied: false,
      },
    ],
  });
  assert.equal(ui.visible("histSend"), true, "shown when a delivery target exists");
});

test("Send is shown only with cloud delivery and routes to the extension", () => {
  const sent = [];
  setDeliveryState({ available: true, label: "Send via Shiplogue Cloud" });
  try {
    const { webview, boot } = freshPanel("concise", {
      onSend: (id, markdown) => sent.push([id, markdown]),
    });
    const ui = boot();
    ui.sendMessage({
      kind: "draft",
      markdown: DRAFT,
      summary: {},
      draftId: "d1",
      sendLabel: "Send via Shiplogue Cloud",
      detail: "concise",
      tone: "neutral",
      target: "targets",
    });
    assert.equal(ui.visible("sendBtn"), true);
    assert.equal(ui.text("sendLabel"), "Send via Shiplogue Cloud");
    ui.click("sendBtn");
    return new Promise((r) => setTimeout(r, 0)).then(() => {
      assert.deepEqual(sent, [["d1", DRAFT]]);
    });
  } finally {
    setDeliveryState({ available: false, label: "" });
  }
});

test("a delivery update appears live in an open panel", () => {
  const { webview, boot } = freshPanel();
  const ui = boot();
  ui.sendMessage({
    kind: "draft",
    markdown: DRAFT,
    summary: {},
    detail: "concise",
    tone: "neutral",
    target: "",
  });
  assert.equal(ui.visible("sendBtn"), false);
  ui.sendMessage({ kind: "delivery", available: true, label: "Send via Shiplogue Cloud" });
  assert.equal(ui.visible("sendBtn"), true);
  assert.equal(ui.text("sendLabel"), "Send via Shiplogue Cloud");
});

test("structured drafts render the headline, tags, and theme details", () => {
  const { webview, boot } = freshPanel();
  const ui = boot();
  ui.sendMessage({
    kind: "draft",
    markdown: "**Today**\n### Weekly recap [feature]\nAdded a recap.",
    summary: {},
    detail: "concise",
    tone: "neutral",
    document: {
      greeting: "Hey team",
      headline: "Shipped the weekly recap and delivery.",
      labels: { yesterday: "Yesterday", today: "Today", next: "Next", blockers: "Blockers" },
      yesterday: ["Finished the connector work."],
      today: [
        {
          title: "Weekly recap",
          tag: "feature",
          summary: "Added an opt-in recap email.",
          details: ["Shows the last seven days."],
          files: ["lib/email.ts"],
        },
      ],
      next: ["Add invoices."],
      blockers: ["None"],
    },
  });
  assert.match(ui.text("preview"), /Shipped the weekly recap and delivery/);
  assert.match(ui.text("preview"), /Added an opt-in recap email/);
  assert.doesNotMatch(ui.text("preview"), /Weekly recap/);
  assert.match(ui.text("preview"), /feature/);
  assert.match(ui.text("preview"), /email\.ts/);
  assert.doesNotMatch(ui.text("preview"), /lib\/email\.ts/);
});
