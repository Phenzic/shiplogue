"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, makeContext, tmpDir, startServer } = require("./helpers");

const { stub } = installVscodeStub();
const { CloudClient, CLOUD_SECRET_KEY } = require("../out/cloud");
const { Analytics } = require("../out/analytics");

const KEY = `shp_live_${"t".repeat(40)}`;

function configFor(url, enabled = true) {
  return {
    "shiplogue.cloud.url": url,
    "shiplogue.cloud.enabled": true,
    "shiplogue.telemetry.enabled": enabled,
    "shiplogue.provider.type": "ollama",
    "shiplogue.model.backend": "auto",
  };
}

test("analytics is silent without explicit consent", async () => {
  const server = await startServer(() => ({ status: 202, body: { accepted: 1 } }));
  try {
    stub.setConfig(configFor(server.url, false));
    const ctx = makeContext(tmpDir());
    await ctx.secrets.store(CLOUD_SECRET_KEY, KEY);
    const analytics = new Analytics(ctx, new CloudClient(ctx));
    await analytics.track("standup.generated", { commits: 1 });
    await analytics.flush();
    assert.equal(server.requests.length, 0);
    await analytics.dispose();
  } finally {
    await server.close();
  }
});

test("analytics is silent without a connector key", async () => {
  const server = await startServer(() => ({ status: 202, body: { accepted: 1 } }));
  try {
    stub.setConfig(configFor(server.url, true));
    const ctx = makeContext(tmpDir());
    const analytics = new Analytics(ctx, new CloudClient(ctx));
    await analytics.track("standup.generated", { commits: 1 });
    await analytics.flush();
    assert.equal(server.requests.length, 0);
    await analytics.dispose();
  } finally {
    await server.close();
  }
});

test("analytics sends allowlisted metadata and a stable installation id", async () => {
  const server = await startServer((req) =>
    req.url === "/api/v1/analytics/events"
      ? { status: 202, body: { accepted: 1 } }
      : { status: 404, body: { error: "not found" } },
  );
  try {
    stub.setConfig(configFor(server.url, true));
    const ctx = makeContext(tmpDir());
    await ctx.secrets.store(CLOUD_SECRET_KEY, KEY);
    const cloud = new CloudClient(ctx);
    const first = new Analytics(ctx, cloud);
    await first.track("standup.generated", {
      commits: 3,
      files: 2,
      github: 1,
      durationMs: 1200,
      backend: "ollama",
      trigger: "manual",
    });
    await first.flush();
    await first.dispose();

    const second = new Analytics(ctx, cloud);
    await second.track("standup.copied", { format: "markdown" });
    await second.flush();
    await second.dispose();

    assert.equal(server.requests.length, 2);
    const firstRequest = server.requests[0];
    assert.equal(firstRequest.headers.authorization, `Bearer ${KEY}`);
    assert.equal(firstRequest.body.events[0].event, "standup.generated");
    assert.equal(firstRequest.body.events[0].properties.commits, 3);
    assert.equal(firstRequest.body.events[0].editor, "unknown");
    assert.ok(firstRequest.body.events[0].installationId);
    assert.equal(
      firstRequest.body.events[0].installationId,
      server.requests[1].body.events[0].installationId,
    );
    assert.equal(server.requests[1].body.events[0].properties.format, "markdown");
    assert.ok(!JSON.stringify(server.requests[0].body).includes("standup body"));
  } finally {
    await server.close();
  }
});
