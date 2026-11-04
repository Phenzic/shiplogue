"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, makeContext, tmpDir, startServer } = require("./helpers");

const { stub } = installVscodeStub();
const { CloudClient, CLOUD_SECRET_KEY, normalizeCloudUrl } = require("../out/cloud");

const KEY = `shp_live_${"a".repeat(40)}`;
const ME = {
  workspace: { id: "w1", name: "Demo workspace", plan: "free", syncActivity: true },
  connector: { id: "c1", name: "VS Code", scopes: ["standups:write"] },
};

function configFor(url) {
  return {
    "shiplogue.cloud.url": url,
    "shiplogue.cloud.enabled": true,
    "shiplogue.cloud.estimatedMinutesSaved": 12,
  };
}

test("normalizeCloudUrl normalizes and rejects invalid URLs", () => {
  assert.equal(normalizeCloudUrl("https://shiplogue.dev/"), "https://shiplogue.dev");
  assert.equal(normalizeCloudUrl("http://localhost:3000///"), "http://localhost:3000");
  assert.throws(() => normalizeCloudUrl("ftp://shiplogue.dev"), /http/);
  assert.throws(() => normalizeCloudUrl("not a url"), /not valid/);
});

test("connect validates a key and stores it only in SecretStorage", async () => {
  const server = await startServer((req) =>
    req.url === "/api/v1/me" ? { body: ME } : { status: 404, body: { error: "not found" } },
  );
  try {
    stub.setConfig(configFor(server.url));
    const ctx = makeContext(tmpDir());
    const client = new CloudClient(ctx);
    const me = await client.connect(KEY);

    assert.equal(me.workspace.name, "Demo workspace");
    assert.equal(ctx.__secrets.get(CLOUD_SECRET_KEY), KEY);
    assert.equal(server.requests[0].headers.authorization, `Bearer ${KEY}`);
    assert.equal(server.requests[0].url, "/api/v1/me");
  } finally {
    await server.close();
  }
});

test("connect does not store a bad or rejected key", async () => {
  const server = await startServer(() => ({
    status: 401,
    body: { error: "Invalid or revoked connector key" },
  }));
  try {
    stub.setConfig(configFor(server.url));
    const ctx = makeContext(tmpDir());
    const client = new CloudClient(ctx);

    await assert.rejects(() => client.connect(KEY), /Invalid or revoked/);
    assert.equal(ctx.__secrets.get(CLOUD_SECRET_KEY), undefined);
    await assert.rejects(() => client.connect("not-a-key"), /shp_live_/);
  } finally {
    await server.close();
  }
});

test("syncStandup posts one draft with auth and the configured time estimate", async () => {
  const server = await startServer((req) => {
    if (req.url === "/api/v1/standups") return { status: 201, body: { standup: { id: "s1" } } };
    return { status: 404, body: { error: "not found" } };
  });
  try {
    stub.setConfig(configFor(server.url));
    const ctx = makeContext(tmpDir());
    await ctx.secrets.store(CLOUD_SECRET_KEY, KEY);
    const client = new CloudClient(ctx);

    const markdown = "# Done\n\n- Shipped the connector";
    const result = await client.syncStandup({ markdown, modelLabel: "Ollama · test" });
    assert.deepEqual(result, { status: "synced", standupId: "s1" });

    const rec = server.requests.find((request) => request.url === "/api/v1/standups");
    assert.ok(rec, "expected a standup request");
    assert.equal(rec.method, "POST");
    assert.equal(rec.headers.authorization, `Bearer ${KEY}`);
    assert.equal(rec.body.bodyMarkdown, markdown);
    assert.equal(rec.body.status, "draft");
    assert.equal(rec.body.timeSavedMinutes, 12);
    assert.equal(rec.body.model, "Ollama · test");
    assert.match(rec.body.standupDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(rec.body.title, `Standup for ${rec.body.standupDate}`);
  } finally {
    await server.close();
  }
});

test("syncStandup is a no-op when no key or cloud sync is disabled", async () => {
  stub.setConfig(configFor("https://shiplogue.dev"));
  const ctx = makeContext(tmpDir());
  const client = new CloudClient(ctx);

  const noKey = await client.syncStandup({ markdown: "# Done" });
  assert.deepEqual(noKey, { status: "skipped", reason: "no-key" });

  await ctx.secrets.store(CLOUD_SECRET_KEY, KEY);
  stub.setConfig({ ...configFor("https://shiplogue.dev"), "shiplogue.cloud.enabled": false });
  const disabled = await client.syncStandup({ markdown: "# Done" });
  assert.deepEqual(disabled, { status: "skipped", reason: "disabled" });
});
