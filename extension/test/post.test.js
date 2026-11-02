"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, startServer } = require("./helpers");

const { stub } = installVscodeStub();
const { postToWebhook, splitForDiscord, effectiveTargets } = require("../out/post");
const { toSlackMrkdwn } = require("../out/format");

test("posting without a configured webhook fails fast", async () => {
  stub.reset();
  stub.setConfig({ "standupDraft.webhook.type": "none", "standupDraft.webhook.url": "" });
  await assert.rejects(postToWebhook("hi"), /No posting target configured/);

  stub.setConfig({ "standupDraft.webhook.type": "discord", "standupDraft.webhook.url": "" });
  await assert.rejects(postToWebhook("hi"), /No posting target configured/);
});

test("Discord splits long posts into ordered messages under the 2000-char limit", async () => {
  const server = await startServer(() => ({ status: 204 }));
  stub.reset();
  stub.setConfig({ "standupDraft.webhook.type": "discord", "standupDraft.webhook.url": server.url });
  try {
    // ~4500 chars of word-wrapped lines → 3 messages (2 lines fit per message).
    const line = "word ".repeat(180).trim(); // 899 chars
    const text = Array.from({ length: 5 }, (_, i) => `line${i} ${line}`).join("\n");
    const result = await postToWebhook(text);
    assert.equal(result.truncated, false);
    assert.equal(result.posted, 1, "one discord target received the messages");
    assert.equal(server.requests.length, 3);
    const bodies = server.requests.map((r) => r.body.content);
    assert.ok(bodies.every((b) => b.length <= 1990), "all messages under the limit");
    assert.ok(bodies.every((b) => /^line\d/.test(b)), "splits land on line boundaries");
    assert.ok(bodies[0].includes("line0") && bodies[2].includes("line4"), "messages in order");
  } finally {
    await server.close();
  }
});

test("Discord truncates after 3 messages and reports it", async () => {
  const server = await startServer(() => ({ status: 204 }));
  stub.reset();
  stub.setConfig({ "standupDraft.webhook.type": "discord", "standupDraft.webhook.url": server.url });
  try {
    const line = "word ".repeat(200).trim();
    const text = Array.from({ length: 12 }, (_, i) => `line${i} ${line}`).join("\n"); // ~12k chars
    const result = await postToWebhook(text);
    assert.equal(result.posted, 1);
    assert.equal(result.truncated, true);
    const bodies = server.requests.map((r) => r.body.content);
    assert.equal(bodies.length, 3);
    assert.ok(bodies.every((b) => b.length <= 1990));
    assert.match(bodies[2], /truncated — full text copied to clipboard/);
  } finally {
    await server.close();
  }
});

test("a single >1990 line is hard-sliced at word boundaries", () => {
  const parts = splitForDiscord("word ".repeat(1200).trim()); // one ~6000-char line
  assert.ok(parts.length >= 3);
  assert.ok(parts.every((p) => p.length <= 1990));
  assert.ok(parts.every((p) => p.startsWith("word")), "no mid-word splits");
});

test("toSlackMrkdwn converts bold and links, keeps bullets", () => {
  const out = toSlackMrkdwn("**Done**\n- Shipped the [login flow](https://github.com/a/b/pull/1) today");
  assert.equal(out, "*Done*\n- Shipped the <https://github.com/a/b/pull/1|login flow> today");
  assert.ok(!out.includes("**"));
});

test("Slack posts use {text} and are not truncated", async () => {
  const server = await startServer(() => ({ status: 200, body: "ok" }));
  stub.reset();
  stub.setConfig({ "standupDraft.webhook.type": "slack", "standupDraft.webhook.url": server.url });
  try {
    const text = "y".repeat(5000);
    await postToWebhook(text);
    assert.equal(server.requests[0].body.text, text);
    assert.equal(server.requests[0].body.content, undefined);
  } finally {
    await server.close();
  }
});

test("a non-2xx webhook response surfaces the status without throwing", async () => {
  const server = await startServer(() => ({ status: 500, body: "nope" }));
  stub.reset();
  stub.setConfig({ "standupDraft.webhook.type": "slack", "standupDraft.webhook.url": server.url });
  try {
    const result = await postToWebhook("hi");
    assert.equal(result.posted, 0);
    assert.equal(result.results[0].ok, false);
    assert.match(result.results[0].error, /500/);
  } finally {
    await server.close();
  }
});

test("posts to all enabled targets and reports per-target results", async () => {
  const slack = await startServer(() => ({ status: 200, body: "ok" }));
  const discord = await startServer(() => ({ status: 204 }));
  const teams = await startServer(() => ({ status: 200, body: "1" }));
  stub.reset();
  stub.setConfig({
    "standupDraft.posting.targets": [
      { type: "slack", url: slack.url, enabled: true },
      { type: "discord", url: discord.url, enabled: true },
      { type: "teams", url: teams.url, enabled: true },
    ],
  });
  try {
    const result = await postToWebhook("**Done**\n- Shipped the thing");
    assert.equal(result.posted, 3);
    assert.deepEqual(result.results.map((r) => [r.type, r.ok]), [
      ["slack", true],
      ["discord", true],
      ["teams", true],
    ]);
    // Slack got mrkdwn (single stars).
    assert.match(slack.requests[0].body.text, /\*Done\*/);
    // Discord got {content}.
    assert.equal(discord.requests[0].body.content, "**Done**\n- Shipped the thing");
    // Teams got an Adaptive Card (Workflows format, not the retired connector).
    const card = teams.requests[0].body;
    assert.equal(card.type, "message");
    assert.equal(card.attachments[0].contentType, "application/vnd.microsoft.card.adaptive");
    assert.equal(card.attachments[0].content.type, "AdaptiveCard");
    assert.equal(card.attachments[0].content.version, "1.4");
    assert.equal(card.attachments[0].content.body[0].type, "TextBlock");
    assert.equal(card.attachments[0].content.body[0].wrap, true);
    assert.match(card.attachments[0].content.body[0].text, /Shipped the thing/);
  } finally {
    await slack.close();
    await discord.close();
    await teams.close();
  }
});

test("a failing target never blocks the others, and errors carry no URL/secret", async () => {
  const good = await startServer(() => ({ status: 204 }));
  const bad = await startServer(() => ({ status: 500, body: "secret-xyz" }));
  stub.reset();
  stub.setConfig({
    "standupDraft.posting.targets": [
      { type: "discord", url: bad.url, enabled: true },
      { type: "slack", url: good.url, enabled: true },
    ],
  });
  try {
    const result = await postToWebhook("hello");
    assert.equal(result.posted, 1);
    assert.equal(good.requests.length, 1, "the healthy target still posted");
    const failed = result.results.find((r) => !r.ok);
    assert.equal(failed.type, "discord");
    assert.match(failed.error, /500/);
    assert.ok(!failed.error.includes(bad.url), "no webhook URL in the error");
    assert.ok(!failed.error.includes("secret-xyz"), "no response body in the error");
  } finally {
    await good.close();
    await bad.close();
  }
});

test("disabled and malformed targets are skipped; legacy pair is the fallback", async () => {
  stub.reset();
  stub.setConfig({
    "standupDraft.posting.targets": [
      { type: "slack", url: "", enabled: true },
      { type: "discord", url: "http://x", enabled: false },
      { type: "carrier-pigeon", url: "http://y", enabled: true },
    ],
    "standupDraft.webhook.type": "discord",
    "standupDraft.webhook.url": "http://legacy",
  });
  const legacy = effectiveTargets();
  assert.equal(legacy.length, 1, "all-invalid list falls back to the legacy pair");
  assert.equal(legacy[0].type, "discord");
  assert.equal(legacy[0].url, "http://legacy");

  stub.setConfig({
    "standupDraft.posting.targets": [{ type: "teams", url: "http://t", enabled: true }],
  });
  const targets = effectiveTargets();
  assert.deepEqual(targets, [{ type: "teams", url: "http://t", enabled: true }], "targets win over legacy");
});
