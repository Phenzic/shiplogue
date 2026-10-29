"use strict";
// Command-level tests for the BYOK setup flow: prompts → SecretStorage →
// settings, with no key ever written to configuration or messages.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub } = require("../helpers");
const { startServer } = require("../helpers");

const { stub } = installVscodeStub();
const {
  setProviderKey,
  clearProviderKey,
  testProvider,
} = require("../../out/commands/providerKeys");
const { setSecretStorage } = require("../../out/model/secrets");

const KEY_NAME = "standup.provider.openai.apiKey";

beforeEach(() => {
  stub.reset();
});

function memorySecrets() {
  const values = new Map();
  const storage = {
    values,
    get: (k) => Promise.resolve(values.get(k)),
    store: (k, v) => {
      values.set(k, v);
      return Promise.resolve();
    },
    delete: (k) => {
      values.delete(k);
      return Promise.resolve();
    },
  };
  setSecretStorage(storage);
  return storage;
}

function providerItem(type, label) {
  return { label, type };
}

test("Set API Key stores the key, discovers models and switches the backend", async () => {
  const secrets = memorySecrets();
  const server = await startServer(() => ({
    body: { data: [{ id: "gpt-b" }, { id: "gpt-a" }, { id: "text-embedding-3-small" }] },
  }));
  try {
    stub.setConfig({ "standup.provider.baseUrl": server.url });
    stub.quickPickAnswers.push(providerItem("openai", "OpenAI"), "gpt-a");
    stub.inputAnswers.push("sk-live-key");

    await setProviderKey();

    assert.equal(secrets.values.get(KEY_NAME), "sk-live-key");
    assert.equal(stub.config["standup.provider.type"], "openai");
    assert.equal(stub.config["standup.provider.model"], "gpt-a");
    assert.equal(stub.config["standup.model.backend"], "provider");

    // The key is never mirrored into settings (which sync to other machines).
    assert.ok(!Object.values(stub.config).includes("sk-live-key"));

    // Non-chat OpenAI models are filtered out of the picker.
    const modelItems = stub.quickPicks.at(-1).items;
    assert.deepEqual(modelItems, ["gpt-a", "gpt-b"]);

    const messages = stub.notifications.map((n) => n.message).join("\n");
    assert.match(messages, /OpenAI/);
    assert.ok(!messages.includes("sk-live-key"));
  } finally {
    await server.close();
  }
});

test("a blank key keeps an existing one so only the model can change", async () => {
  const secrets = memorySecrets();
  await secrets.store(KEY_NAME, "sk-old");
  const server = await startServer(() => ({ body: { data: [{ id: "gpt-new" }] } }));
  try {
    stub.setConfig({ "standup.provider.baseUrl": server.url });
    stub.quickPickAnswers.push(providerItem("openai", "OpenAI"), "gpt-new");
    stub.inputAnswers.push("");

    await setProviderKey();

    assert.equal(secrets.values.get(KEY_NAME), "sk-old");
    assert.equal(stub.config["standup.provider.model"], "gpt-new");
    assert.equal(server.requests[0].headers.authorization, "Bearer sk-old");
  } finally {
    await server.close();
  }
});

test("Set API Key stops when no provider is chosen", async () => {
  const secrets = memorySecrets();
  stub.quickPickAnswers.push(undefined);
  await setProviderKey();
  assert.equal(secrets.values.size, 0);
  assert.equal(stub.config["standup.model.backend"], undefined);
});

test("Set API Key refuses an empty key for a hosted provider", async () => {
  const secrets = memorySecrets();
  stub.quickPickAnswers.push(providerItem("anthropic", "Anthropic"));
  stub.inputAnswers.push(undefined); // user pressed Escape
  await setProviderKey();
  assert.equal(secrets.values.size, 0);
});

test("when model discovery fails the user can type a model id", async () => {
  const secrets = memorySecrets();
  const server = await startServer(() => ({ status: 401, body: { error: { message: "bad" } } }));
  try {
    stub.setConfig({ "standup.provider.baseUrl": server.url });
    stub.quickPickAnswers.push(providerItem("openai", "OpenAI"));
    stub.inputAnswers.push("sk-key", "gpt-manual");

    await setProviderKey();

    assert.equal(secrets.values.get(KEY_NAME), "sk-key");
    assert.equal(stub.config["standup.provider.model"], "gpt-manual");
    assert.ok(stub.notifications.some((n) => n.warning && /Could not list models|rejected/.test(n.message)));
  } finally {
    await server.close();
  }
});

test("an OpenAI-compatible endpoint asks for a URL and allows an empty key", async () => {
  const secrets = memorySecrets();
  const server = await startServer(() => ({ body: { data: [{ id: "local-model" }] } }));
  try {
    stub.quickPickAnswers.push(
      providerItem("openai-compatible", "OpenAI-compatible"),
      "local-model",
    );
    stub.inputAnswers.push(`${server.url}/`, "");

    await setProviderKey();

    assert.equal(stub.config["standup.provider.type"], "openai-compatible");
    assert.equal(stub.config["standup.provider.baseUrl"], server.url);
    assert.equal(stub.config["standup.provider.model"], "local-model");
    assert.equal(stub.config["standup.model.backend"], "provider");
    assert.equal(secrets.values.has("standup.provider.openai-compatible.apiKey"), false);
    assert.equal(server.requests[0].url, "/models");
  } finally {
    await server.close();
  }
});

test("Clear API Key deletes the secret and resets the backend", async () => {
  const secrets = memorySecrets();
  await secrets.store(KEY_NAME, "sk-old");
  stub.setConfig({
    "standup.provider.type": "openai",
    "standup.provider.model": "gpt-a",
    "standup.model.backend": "provider",
  });
  stub.quickPickAnswers.push(providerItem("openai", "OpenAI"));

  await clearProviderKey();

  assert.equal(secrets.values.has(KEY_NAME), false);
  assert.equal(stub.config["standup.provider.type"], "none");
  assert.equal(stub.config["standup.model.backend"], "auto");
});

test("Test Provider reports success without printing the key", async () => {
  const secrets = memorySecrets();
  await secrets.store(KEY_NAME, "sk-live-key");
  const server = await startServer(() => ({
    body: { choices: [{ message: { content: "OK" } }] },
  }));
  try {
    stub.setConfig({
      "standup.provider.type": "openai",
      "standup.provider.model": "gpt-a",
      "standup.provider.baseUrl": server.url,
    });
    await testProvider();
    const message = stub.notifications.at(-1).message;
    assert.match(message, /works/);
    assert.match(message, /gpt-a/);
    assert.ok(!message.includes("sk-live-key"));
  } finally {
    await server.close();
  }
});

test("Test Provider reports a rejected key and redacts it", async () => {
  const secrets = memorySecrets();
  await secrets.store(KEY_NAME, "sk-live-key");
  const server = await startServer(() => ({
    status: 401,
    body: { error: { message: "Incorrect API key provided: sk-live-key" } },
  }));
  try {
    stub.setConfig({
      "standup.provider.type": "openai",
      "standup.provider.model": "gpt-a",
      "standup.provider.baseUrl": server.url,
    });
    await testProvider();
    const message = stub.errors.at(-1).message;
    assert.match(message, /rejected the API key/);
    assert.ok(!message.includes("sk-live-key"));
  } finally {
    await server.close();
  }
});

test("Test Provider explains when nothing is configured", async () => {
  memorySecrets();
  stub.setConfig({ "standup.provider.type": "none" });
  await testProvider();
  assert.match(stub.errors.at(-1).message, /No provider is configured/);
  assert.match(stub.errors.at(-1).message, /Set API Key/);
});
