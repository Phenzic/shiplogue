"use strict";
// Backend selection: settings + SecretStorage → concrete backend. Verifies the
// `auto` order, the explicit modes, and that nothing falls back silently.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, startServer } = require("../helpers");

const { stub } = installVscodeStub();
const { setSecretStorage } = require("../../out/model/secrets");
const {
  resolveBackend,
  loadProviderConfig,
  BackendUnavailableError,
} = require("../../out/model/registry");
const { ProviderBackend } = require("../../out/model/providerBackend");
const { OllamaBackend } = require("../../out/model/ollama");

function memorySecrets() {
  const values = new Map();
  return {
    get: (k) => Promise.resolve(values.get(k)),
    store: (k, v) => {
      values.set(k, v);
      return Promise.resolve();
    },
    delete: (k) => {
      values.delete(k);
      return Promise.resolve();
    },
    values,
  };
}

async function withSecret(type, key) {
  const store = memorySecrets();
  setSecretStorage(store);
  await store.store(`standup.provider.${type}.apiKey`, key);
  return store;
}

test("auto prefers a fully configured provider over Ollama", async () => {
  const server = await startServer(() => ({ body: { choices: [{ message: { content: "hi" } }] } }));
  try {
    await withSecret("openai", "sk-test");
    stub.setConfig({
      "standup.model.backend": "auto",
      "standup.provider.type": "openai",
      "standup.provider.model": "gpt-test",
      "standup.provider.baseUrl": server.url,
    });

    const backend = await resolveBackend();
    assert.equal(backend.kind, "provider");
    const res = await backend.generate({ prompt: "x", temperature: 0, maxTokens: 20 });
    assert.equal(res.text, "hi");
    assert.equal(res.meta.model, "gpt-test");
    assert.equal(res.meta.provider, "openai");
    assert.ok(res.meta.durationMs >= 0);
    assert.equal(server.requests[0].headers.authorization, "Bearer sk-test");
  } finally {
    await server.close();
  }
});

test("auto without a provider uses Ollama", async () => {
  setSecretStorage(memorySecrets());
  stub.setConfig({ "standup.model.backend": "auto", "standup.provider.type": "none" });
  const backend = await resolveBackend();
  assert.ok(backend instanceof OllamaBackend);
});

test("auto ignores a provider whose key is missing", async () => {
  setSecretStorage(memorySecrets());
  stub.setConfig({
    "standup.model.backend": "auto",
    "standup.provider.type": "anthropic",
    "standup.provider.model": "claude-test",
  });
  assert.equal(await loadProviderConfig(), undefined);
  assert.ok((await resolveBackend()) instanceof OllamaBackend);
});

test("provider mode without configuration fails with an actionable error", async () => {
  setSecretStorage(memorySecrets());
  stub.setConfig({ "standup.model.backend": "provider", "standup.provider.type": "none" });
  await assert.rejects(
    () => resolveBackend(),
    (e) => e instanceof BackendUnavailableError && /Set API Key/.test(e.message) && e.userFacing,
  );
});

test("provider mode without a stored key fails instead of falling back", async () => {
  setSecretStorage(memorySecrets());
  stub.setConfig({
    "standup.model.backend": "provider",
    "standup.provider.type": "openai",
    "standup.provider.model": "gpt-test",
  });
  await assert.rejects(() => resolveBackend(), BackendUnavailableError);
});

test("local mode explains that the bundled model is not in this beta", async () => {
  setSecretStorage(memorySecrets());
  stub.setConfig({ "standup.model.backend": "local" });
  await assert.rejects(
    () => resolveBackend(),
    (e) => e instanceof BackendUnavailableError && /isn't part of this beta/.test(e.message),
  );
});

test("an OpenAI-compatible endpoint works without a key when a URL is set", async () => {
  const server = await startServer(() => ({ body: { choices: [{ message: { content: "local" } }] } }));
  try {
    setSecretStorage(memorySecrets());
    stub.setConfig({
      "standup.model.backend": "provider",
      "standup.provider.type": "openai-compatible",
      "standup.provider.model": "local-model",
      "standup.provider.baseUrl": server.url,
    });
    const backend = await resolveBackend();
    assert.ok(backend instanceof ProviderBackend);
    const res = await backend.generate({ prompt: "x", temperature: 0, maxTokens: 20 });
    assert.equal(res.text, "local");
    assert.equal(server.requests[0].headers.authorization, undefined);
  } finally {
    await server.close();
  }
});

test("a compatible endpoint without a base URL is treated as unconfigured", async () => {
  setSecretStorage(memorySecrets());
  stub.setConfig({
    "standup.model.backend": "provider",
    "standup.provider.type": "openai-compatible",
    "standup.provider.model": "local-model",
    "standup.provider.baseUrl": "",
  });
  await assert.rejects(() => resolveBackend(), BackendUnavailableError);
});

test("standup.provider.maxOutputTokens caps the detail budget with Math.min", async () => {
  const server = await startServer(() => ({ body: { choices: [{ message: { content: "ok" } }] } }));
  try {
    await withSecret("openai", "sk-test");
    stub.setConfig({
      "standup.provider.type": "openai",
      "standup.provider.model": "gpt-test",
      "standup.provider.baseUrl": server.url,
      "standup.provider.maxOutputTokens": 500,
    });
    const backend = await resolveBackend();
    await backend.generate({ prompt: "x", temperature: 0, maxTokens: 1600 });
    assert.equal(server.requests[0].body.max_completion_tokens, 500);

    // Under the cap, the smaller detail budget wins.
    await backend.generate({ prompt: "x", temperature: 0, maxTokens: 200 });
    assert.equal(server.requests[1].body.max_completion_tokens, 200);
  } finally {
    await server.close();
  }
});

test("0 disables the cap and uses the detail budget", async () => {
  const server = await startServer(() => ({ body: { choices: [{ message: { content: "ok" } }] } }));
  try {
    await withSecret("openai", "sk-test");
    stub.setConfig({
      "standup.provider.type": "openai",
      "standup.provider.model": "gpt-test",
      "standup.provider.baseUrl": server.url,
      "standup.provider.maxOutputTokens": 0,
    });
    const backend = await resolveBackend();
    await backend.generate({ prompt: "x", temperature: 0, maxTokens: 1600 });
    assert.equal(server.requests[0].body.max_completion_tokens, 1600);
  } finally {
    await server.close();
  }
});
