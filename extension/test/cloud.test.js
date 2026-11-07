"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, makeContext, tmpDir, startServer } = require("./helpers");

const { stub } = installVscodeStub();
const { CloudClient, CLOUD_SECRET_KEY, normalizeCloudUrl } = require("../out/cloud");
const { getFormatSections, resetFormatSections } = require("../out/formatProfile");

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

test("paid cloud profiles apply custom labels/order; free plans ignore them", async () => {
  const sections = [
    { key: "today", label: "Accomplishments" },
    { key: "yesterday", label: "Since last time" },
    { key: "next", label: "Up next" },
    { key: "blockers", label: "Blocked by" },
  ];
  let reply = {
    ...ME,
    workspace: { ...ME.workspace, plan: "pro", format: { sections } },
  };
  const server = await startServer((req) =>
    req.url === "/api/v1/me" ? { body: reply } : { status: 404, body: { error: "not found" } },
  );
  try {
    stub.setConfig(configFor(server.url));

    const paidCtx = makeContext(tmpDir());
    const paid = new CloudClient(paidCtx);
    await paid.connect(KEY);
    assert.deepEqual(
      getFormatSections().map((section) => section.label),
      ["Accomplishments", "Since last time", "Up next", "Blocked by"],
    );

    // A fresh client restores the cached paid profile while offline.
    new CloudClient(paidCtx);
    assert.equal(getFormatSections()[0].label, "Accomplishments");

    reply = {
      ...ME,
      workspace: { ...ME.workspace, plan: "free", format: { sections } },
    };
    const free = new CloudClient(makeContext(tmpDir()));
    await free.connect(KEY);
    assert.deepEqual(
      getFormatSections().map((section) => section.label),
      ["Yesterday", "Today", "Next", "Blockers"],
    );
  } finally {
    resetFormatSections();
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

    const markdown = "# Today\n\n### Connector [feature]\nShipped the connector.";
    const document = {
      greeting: "Hey team",
      headline: "Shipped the connector.",
      labels: { yesterday: "Yesterday", today: "Today", next: "Next", blockers: "Blockers" },
      yesterday: ["Finished the old work."],
      today: [{ title: "Connector", tag: "feature", summary: "Shipped the connector.", details: [], files: ["src/connector.ts"] }],
      next: ["Ship more."],
      blockers: ["None"],
    };
    const result = await client.syncStandup({ markdown, modelLabel: "Ollama · test", document });
    assert.deepEqual(result, { status: "synced", standupId: "s1" });

    const rec = server.requests.find((request) => request.url === "/api/v1/standups");
    assert.ok(rec, "expected a standup request");
    assert.equal(rec.method, "POST");
    assert.equal(rec.headers.authorization, `Bearer ${KEY}`);
    assert.equal(rec.body.bodyMarkdown, markdown);
    assert.equal(rec.body.status, "draft");
    assert.equal(rec.body.timeSavedMinutes, 12);
    assert.equal(rec.body.model, "Ollama · test");
    assert.equal(rec.body.headline, "Shipped the connector.");
    assert.equal(rec.body.themes[0].title, "Connector");
    assert.deepEqual(rec.body.themes[0].files, ["connector.ts"]);
    assert.deepEqual(rec.body.yesterday, ["Finished the old work."]);
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

// ---- Cloud-side sending (Pro) -------------------------------------------

test("sendStandup asks the cloud to post and returns the targets (paid plan)", async () => {
  const server = await startServer((req) => {
    if (req.url === "/api/v1/me") {
      return { body: { ...ME, workspace: { ...ME.workspace, plan: "pro" } } };
    }
    if (req.url === "/api/v1/standups/s1/send") {
      return { body: { standup: { id: "s1" }, sent: { targets: ["slack", "discord"] } } };
    }
    return { status: 404, body: { error: "not found" } };
  });
  try {
    stub.setConfig(configFor(server.url));
    const ctx = makeContext(tmpDir());
    await ctx.secrets.store(CLOUD_SECRET_KEY, KEY);
    const client = new CloudClient(ctx);
    const result = await client.sendStandup("s1");
    assert.deepEqual(result, { status: "sent", standupId: "s1", targets: ["slack", "discord"] });
    const sendReq = server.requests.find((r) => r.url === "/api/v1/standups/s1/send");
    assert.equal(sendReq.method, "POST");
    assert.ok(sendReq.headers["idempotency-key"]);
  } finally {
    await server.close();
  }
});

test("sendStandup refuses on a free plan without calling /send", async () => {
  const server = await startServer((req) =>
    req.url === "/api/v1/me" ? { body: ME } : { status: 404, body: { error: "not found" } },
  );
  try {
    stub.setConfig(configFor(server.url));
    const ctx = makeContext(tmpDir());
    await ctx.secrets.store(CLOUD_SECRET_KEY, KEY);
    const client = new CloudClient(ctx);
    const result = await client.sendStandup("s1");
    assert.deepEqual(result, { status: "skipped", reason: "not-pro" });
    assert.ok(!server.requests.some((r) => r.url.includes("/send")));
  } finally {
    await server.close();
  }
});

test("sendStandup reports failures with the cloud's message", async () => {
  const server = await startServer((req) => {
    if (req.url === "/api/v1/me") {
      return { body: { ...ME, workspace: { ...ME.workspace, plan: "pro" } } };
    }
    return { status: 402, body: { error: "Posting add-on required" } };
  });
  try {
    stub.setConfig(configFor(server.url));
    const ctx = makeContext(tmpDir());
    await ctx.secrets.store(CLOUD_SECRET_KEY, KEY);
    const client = new CloudClient(ctx);
    const result = await client.sendStandup("s1");
    assert.deepEqual(result, { status: "skipped", reason: "not-pro" });
  } finally {
    await server.close();
  }
});

test("sendStandup returns queued when the cloud accepts a delivery job", async () => {
  const server = await startServer((req) => {
    if (req.url === "/api/v1/me") {
      return { body: { ...ME, workspace: { ...ME.workspace, plan: "pro" } } };
    }
    if (req.url === "/api/v1/standups/s1/send") {
      return {
        status: 202,
        body: {
          standup: { id: "s1" },
          delivery: {
            id: "d1",
            status: "queued",
            targets: [{ target: "slack", status: "queued" }],
            sentAt: null,
          },
        },
      };
    }
    if (req.url === "/api/v1/deliveries/d1") {
      return {
        body: {
          delivery: {
            id: "d1",
            status: "sent",
            targets: [{ target: "slack", status: "sent" }],
            sentAt: "2026-11-05T18:00:00.000Z",
          },
        },
      };
    }
    return { status: 404, body: { error: "not found" } };
  });
  try {
    stub.setConfig(configFor(server.url));
    const ctx = makeContext(tmpDir());
    await ctx.secrets.store(CLOUD_SECRET_KEY, KEY);
    const client = new CloudClient(ctx);
    const result = await client.sendStandup("s1");
    assert.equal(result.status, "queued");
    assert.equal(result.deliveryId, "d1");
    const final = await client.waitForDelivery("d1", 3000);
    assert.equal(final.status, "sent");
  } finally {
    await server.close();
  }
});

test("sendStandup without a key is skipped and never touches the network", async () => {
  stub.reset();
  const ctx = makeContext(tmpDir());
  const client = new CloudClient(ctx);
  const result = await client.sendStandup("s1");
  assert.deepEqual(result, { status: "skipped", reason: "no-key" });
});
