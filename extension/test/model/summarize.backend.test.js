"use strict";
// generateStandup against a BYOK provider: the same prompt/repair/grounding
// pipeline as Ollama, plus backend metadata for the panel.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, startServer } = require("../helpers");

const { stub } = installVscodeStub();
const { generateStandup } = require("../../out/summarize");
const { setDetailGetter, setToneGetter } = require("../../out/config");
const { setSecretStorage } = require("../../out/model/secrets");
const { BackendUnavailableError } = require("../../out/model/registry");

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
  };
}

async function useProvider(url, overrides = {}) {
  const store = memorySecrets();
  setSecretStorage(store);
  await store.store("shiplogue.provider.openai.apiKey", "sk-test");
  stub.setConfig({
    "shiplogue.model.backend": "provider",
    "shiplogue.provider.type": "openai",
    "shiplogue.provider.model": "gpt-test",
    "shiplogue.provider.baseUrl": url,
    "shiplogue.detail": "concise",
    ...overrides,
  });
  setDetailGetter(() => overrides["shiplogue.detail"] || "concise");
  setToneGetter(() => "neutral");
}

function baseCtx(overrides = {}) {
  return {
    since: new Date(Date.now() - 3600e3),
    until: new Date(),
    commits: [
      {
        hash: "abc12345",
        date: new Date().toISOString(),
        subject: "feat(api): add health endpoint",
        body: "Adds /health.",
        repo: "acme/demo",
        files: ["src/health.ts"],
      },
    ],
    touches: [],
    github: [],
    cursorPrompts: [],
    ...overrides,
  };
}

function draft(doneCount) {
  return [
    "Hey team, here's what I worked on today:",
    "",
    "**Done**",
    ...Array.from({ length: doneCount }, (_, i) => `- Shipped change ${i + 1}.`),
    "",
    "**Next**",
    "- Continue.",
    "",
    "**Blockers**",
    "- None",
  ].join("\n");
}

function openAiReply(text) {
  return { body: { choices: [{ message: { content: text } }] } };
}

test("generateStandup uses the configured provider and reports backend metadata", async () => {
  const server = await startServer(() => openAiReply(draft(2)));
  try {
    await useProvider(server.url);
    const res = await generateStandup(baseCtx());
    assert.equal(res.text, draft(2));
    assert.equal(res.warnings.length, 0);
    assert.equal(res.backend.kind, "provider");
    assert.equal(res.backend.provider, "openai");
    assert.equal(res.backend.model, "gpt-test");

    const prompt = server.requests[0].body.messages[0].content;
    assert.match(prompt, /ACTIVITY:/);
    assert.match(prompt, /HARD REQUIREMENTS/);
    assert.match(prompt, /add health endpoint/);
  } finally {
    await server.close();
  }
});

test("the repair pass runs through the provider backend too", async () => {
  const server = await startServer(() => {
    // First draft under-delivers; the repair returns a compliant one.
    return server.requests.length === 1 ? openAiReply(draft(1)) : openAiReply(draft(5));
  });
  try {
    await useProvider(server.url, { "shiplogue.detail": "standard" });
    const ctx = baseCtx({
      commits: Array.from({ length: 6 }, (_, i) => ({
        hash: `h${i}`,
        date: new Date().toISOString(),
        subject: `change ${i}`,
        body: "",
        repo: "acme/demo",
        files: [],
      })),
    });
    const res = await generateStandup(ctx);
    assert.equal(server.requests.length, 2);
    assert.equal(res.text, draft(5));
    assert.match(server.requests[1].body.messages[0].content, /at least 5 bullets/);
    assert.equal(res.backend.provider, "openai");
  } finally {
    await server.close();
  }
});

test("a backend selection error is user-facing and does not call the network", async () => {
  setSecretStorage(memorySecrets());
  stub.setConfig({ "shiplogue.model.backend": "provider", "shiplogue.provider.type": "none" });
  await assert.rejects(
    () => generateStandup(baseCtx()),
    (e) => e instanceof BackendUnavailableError && e.userFacing === true,
  );
});
