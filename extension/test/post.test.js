"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, startServer } = require("./helpers");

const { stub } = installVscodeStub();
const { postToWebhook, splitForDiscord } = require("../out/post");
const { toSlackMrkdwn } = require("../out/format");

test("posting without a configured webhook fails fast", async () => {
  stub.reset();
  stub.setConfig({ "shiplogue.webhook.type": "none", "shiplogue.webhook.url": "" });
  await assert.rejects(postToWebhook("hi"), /No webhook configured/);

  stub.setConfig({ "shiplogue.webhook.type": "discord", "shiplogue.webhook.url": "" });
  await assert.rejects(postToWebhook("hi"), /No webhook configured/);
});

test("Discord splits long posts into ordered messages under the 2000-char limit", async () => {
  const server = await startServer(() => ({ status: 204 }));
  stub.reset();
  stub.setConfig({ "shiplogue.webhook.type": "discord", "shiplogue.webhook.url": server.url });
  try {
    // ~4500 chars of word-wrapped lines → 3 messages (2 lines fit per message).
    const line = "word ".repeat(180).trim(); // 899 chars
    const text = Array.from({ length: 5 }, (_, i) => `line${i} ${line}`).join("\n");
    const result = await postToWebhook(text);
    assert.deepEqual(result, { posted: 3, truncated: false });
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
  stub.setConfig({ "shiplogue.webhook.type": "discord", "shiplogue.webhook.url": server.url });
  try {
    const line = "word ".repeat(200).trim();
    const text = Array.from({ length: 12 }, (_, i) => `line${i} ${line}`).join("\n"); // ~12k chars
    const result = await postToWebhook(text);
    assert.equal(result.posted, 3);
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
  stub.setConfig({ "shiplogue.webhook.type": "slack", "shiplogue.webhook.url": server.url });
  try {
    const text = "y".repeat(5000);
    await postToWebhook(text);
    assert.equal(server.requests[0].body.text, text);
    assert.equal(server.requests[0].body.content, undefined);
  } finally {
    await server.close();
  }
});

test("a non-2xx webhook response surfaces the status", async () => {
  const server = await startServer(() => ({ status: 500, body: "nope" }));
  stub.reset();
  stub.setConfig({ "shiplogue.webhook.type": "slack", "shiplogue.webhook.url": server.url });
  try {
    await assert.rejects(postToWebhook("hi"), /500/);
  } finally {
    await server.close();
  }
});
