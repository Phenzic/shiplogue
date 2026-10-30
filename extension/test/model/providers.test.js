"use strict";
// Adapter-level tests against real local HTTP servers: verify endpoint paths,
// auth headers, request bodies and response parsing for every BYOK provider.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, startServer } = require("../helpers");

installVscodeStub();

const {
  anthropicAdapter,
  openaiAdapter,
  googleAdapter,
  compatibleAdapter,
  ProviderError,
  redactSecrets,
} = require("../../out/core/providers");

function config(overrides = {}) {
  return { model: "test-model", apiKey: "test-key", maxOutputTokens: 100, ...overrides };
}

test("Anthropic: posts to /v1/messages with header auth and joins text blocks", async () => {
  const server = await startServer(() => ({
    body: {
      content: [
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "Hello " },
        { type: "text", text: "team" },
      ],
      usage: { input_tokens: 11, output_tokens: 7 },
    },
  }));
  try {
    const res = await anthropicAdapter.generate(
      { prompt: "write it", temperature: 0.2, maxTokens: 300 },
      config({ baseUrl: server.url }),
    );
    assert.equal(res.text, "Hello team");
    assert.deepEqual(res.usage, { inputTokens: 11, outputTokens: 7 });

    const req = server.requests[0];
    assert.equal(req.url, "/v1/messages");
    assert.equal(req.method, "POST");
    assert.equal(req.headers["x-api-key"], "test-key");
    assert.equal(req.headers["anthropic-version"], "2023-06-01");
    assert.equal(req.body.model, "test-model");
    assert.equal(req.body.max_tokens, 300);
    assert.equal(req.body.temperature, 0.2);
    assert.deepEqual(req.body.messages, [{ role: "user", content: "write it" }]);
  } finally {
    await server.close();
  }
});

test("Anthropic: listModels reads data[].id", async () => {
  const server = await startServer(() => ({
    body: { data: [{ id: "claude-a" }, { id: "claude-b" }, { nope: true }] },
  }));
  try {
    const models = await anthropicAdapter.listModels(config({ baseUrl: server.url }));
    assert.deepEqual(models, ["claude-a", "claude-b"]);
    assert.equal(server.requests[0].url, "/v1/models?limit=100");
  } finally {
    await server.close();
  }
});

test("Anthropic: a missing key fails before any request", async () => {
  await assert.rejects(
    () =>
      anthropicAdapter.generate(
        { prompt: "x", temperature: 0, maxTokens: 10 },
        config({ apiKey: undefined }),
      ),
    (e) => e instanceof ProviderError && e.code === "auth" && /No Anthropic API key/.test(e.message),
  );
});

test("OpenAI: posts to /chat/completions with Bearer auth", async () => {
  const server = await startServer(() => ({
    body: {
      choices: [{ message: { content: "  draft  " } }],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    },
  }));
  try {
    const res = await openaiAdapter.generate(
      { prompt: "write", temperature: 0.3, maxTokens: 250 },
      config({ baseUrl: server.url }),
    );
    assert.equal(res.text, "draft");
    assert.deepEqual(res.usage, { inputTokens: 3, outputTokens: 4 });

    const req = server.requests[0];
    assert.equal(req.url, "/chat/completions");
    assert.equal(req.headers.authorization, "Bearer test-key");
    assert.equal(req.body.max_completion_tokens, 250);
    assert.equal(req.body.temperature, 0.3);
  } finally {
    await server.close();
  }
});

test("OpenAI: a 400 for temperature/limits retries without those parameters", async () => {
  const server = await startServer(() => {
    if (server.requests.length === 1) {
      return {
        status: 400,
        body: { error: { message: "Unsupported value: 'temperature' does not support 0.2" } },
      };
    }
    return { body: { choices: [{ message: { content: "ok" } }] } };
  });
  try {
    const res = await openaiAdapter.generate(
      { prompt: "x", temperature: 0.2, maxTokens: 40 },
      config({ baseUrl: server.url }),
    );
    assert.equal(res.text, "ok");
    assert.equal(server.requests.length, 2);
    assert.deepEqual(Object.keys(server.requests[1].body).sort(), ["messages", "model"]);
  } finally {
    await server.close();
  }
});

test("OpenAI: accepts array-shaped message content", async () => {
  const server = await startServer(() => ({
    body: { choices: [{ message: { content: [{ text: "part1 " }, { text: "part2" }] } }] },
  }));
  try {
    const res = await openaiAdapter.generate(
      { prompt: "x", temperature: 0, maxTokens: 20 },
      config({ baseUrl: server.url }),
    );
    assert.equal(res.text, "part1 part2");
  } finally {
    await server.close();
  }
});

test("OpenAI: listModels returns ids", async () => {
  const server = await startServer(() => ({ body: { data: [{ id: "gpt-a" }, { id: "gpt-b" }] } }));
  try {
    assert.deepEqual(await openaiAdapter.listModels(config({ baseUrl: server.url })), [
      "gpt-a",
      "gpt-b",
    ]);
  } finally {
    await server.close();
  }
});

test("Google: uses header auth and strips a models/ prefix from the path", async () => {
  const server = await startServer(() => ({
    body: {
      candidates: [{ content: { parts: [{ text: "gem " }, { text: "ini" }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 },
    },
  }));
  try {
    const res = await googleAdapter.generate(
      { prompt: "write", temperature: 0.25, maxTokens: 512 },
      config({ baseUrl: server.url, model: "models/gemini-test" }),
    );
    assert.equal(res.text, "gem ini");
    assert.deepEqual(res.usage, { inputTokens: 5, outputTokens: 6 });

    const req = server.requests[0];
    assert.equal(req.url, "/models/gemini-test:generateContent");
    assert.equal(req.headers["x-goog-api-key"], "test-key");
    assert.equal(req.body.generationConfig.maxOutputTokens, 512);
    assert.deepEqual(req.body.contents, [{ role: "user", parts: [{ text: "write" }] }]);
  } finally {
    await server.close();
  }
});

test("Google: listModels keeps only generateContent models", async () => {
  const server = await startServer(() => ({
    body: {
      models: [
        { name: "models/gemini-chat", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding", supportedGenerationMethods: ["embedContent"] },
        { name: "models/gemini-raw", supportedGenerationMethods: ["generateContent"] },
      ],
    },
  }));
  try {
    assert.deepEqual(await googleAdapter.listModels(config({ baseUrl: server.url })), [
      "gemini-chat",
      "gemini-raw",
    ]);
    assert.equal(server.requests[0].url, "/models?pageSize=1000");
  } finally {
    await server.close();
  }
});

test("OpenAI-compatible: needs a base URL and tolerates a pasted full endpoint", async () => {
  await assert.rejects(
    () =>
      compatibleAdapter.generate(
        { prompt: "x", temperature: 0, maxTokens: 10 },
        config({ baseUrl: undefined }),
      ),
    (e) => e instanceof ProviderError && /No base URL/.test(e.message),
  );

  const server = await startServer(() => ({ body: { choices: [{ message: { content: "ok" } }] } }));
  try {
    const res = await compatibleAdapter.generate(
      { prompt: "x", temperature: 0, maxTokens: 10 },
      config({ baseUrl: `${server.url}/chat/completions/`, apiKey: undefined }),
    );
    assert.equal(res.text, "ok");
    assert.equal(server.requests[0].url, "/chat/completions");
    assert.equal(server.requests[0].headers.authorization, undefined);
    assert.equal(server.requests[0].body.model, "test-model");
  } finally {
    await server.close();
  }
});

test("OpenAI-compatible: a reasoning-only reply retries with a bigger budget and thinking off", async () => {
  const server = await startServer(() => {
    if (server.requests.length === 1) {
      return {
        body: {
          choices: [
            { message: { content: null, reasoning: "Let me think…" }, finish_reason: "length" },
          ],
          usage: { prompt_tokens: 900, completion_tokens: 400 },
        },
      };
    }
    return {
      body: {
        choices: [{ message: { content: "  draft  " }, finish_reason: "stop" }],
        usage: { prompt_tokens: 900, completion_tokens: 120 },
      },
    };
  });
  try {
    const res = await compatibleAdapter.generate(
      { prompt: "x", temperature: 0.4, maxTokens: 400 },
      config({ baseUrl: server.url }),
    );
    assert.equal(res.text, "draft");
    assert.deepEqual(res.usage, { inputTokens: 900, outputTokens: 120 });

    // First request is unchanged (no thinking control).
    assert.equal(server.requests[0].body.max_tokens, 400);
    assert.equal(server.requests[0].body.reasoning_effort, undefined);

    // The retry raises the budget (4x, floored at 4096) and disables thinking.
    assert.equal(server.requests.length, 2);
    assert.equal(server.requests[1].body.max_tokens, 4096);
    assert.equal(server.requests[1].body.reasoning_effort, "none");
    assert.equal(server.requests[1].body.temperature, 0.4);
  } finally {
    await server.close();
  }
});

test("OpenAI-compatible: falls back to a budget-only retry when reasoning_effort is rejected", async () => {
  const server = await startServer(() => {
    if (server.requests.length === 1) {
      return {
        body: {
          choices: [
            { message: { content: null, reasoning_content: "thinking" }, finish_reason: "length" },
          ],
        },
      };
    }
    if (server.requests.length === 2) {
      return {
        status: 400,
        body: { error: { message: "Unrecognized request argument supplied: reasoning_effort" } },
      };
    }
    return { body: { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] } };
  });
  try {
    const res = await compatibleAdapter.generate(
      { prompt: "x", temperature: 0, maxTokens: 900 },
      config({ baseUrl: server.url }),
    );
    assert.equal(res.text, "ok");
    assert.equal(server.requests.length, 3);
    assert.equal(server.requests[1].body.reasoning_effort, "none");
    assert.equal(server.requests[2].body.max_tokens, 4096);
    assert.equal(server.requests[2].body.reasoning_effort, undefined);
  } finally {
    await server.close();
  }
});

test("OpenAI-compatible: a still-empty reasoning retry reports budget, finish_reason and CoT tokens", async () => {
  const server = await startServer(() => ({
    body: {
      choices: [
        { message: { content: null, reasoning_content: "Let me think…" }, finish_reason: "length" },
      ],
      usage: { completion_tokens_details: { reasoning_tokens: 4096 } },
    },
  }));
  try {
    await assert.rejects(
      () =>
        compatibleAdapter.generate(
          { prompt: "x", temperature: 0, maxTokens: 400 },
          config({ baseUrl: server.url }),
        ),
      (e) => {
        assert.ok(e instanceof ProviderError);
        assert.equal(e.code, "bad_response");
        assert.match(e.message, /spent its whole output budget on reasoning/);
        assert.match(e.message, /finish_reason: length/);
        assert.match(e.message, /reasoning tokens: 4096/);
        assert.ok(e.userFacing);
        return true;
      },
    );
    // It tried twice (original + recovery) before giving up.
    assert.equal(server.requests.length, 2);
  } finally {
    await server.close();
  }
});

test("OpenAI-compatible: a plain empty response is not retried", async () => {
  const server = await startServer(() => ({
    body: { choices: [{ message: { content: "" }, finish_reason: "stop" }] },
  }));
  try {
    await assert.rejects(
      () =>
        compatibleAdapter.generate(
          { prompt: "x", temperature: 0, maxTokens: 400 },
          config({ baseUrl: server.url }),
        ),
      (e) => {
        assert.ok(e instanceof ProviderError);
        assert.match(e.message, /returned an empty response/);
        assert.match(e.message, /finish_reason: stop/);
        return true;
      },
    );
    assert.equal(server.requests.length, 1);
  } finally {
    await server.close();
  }
});

test("HTTP errors map to actionable, key-free messages", async () => {
  const cases = [
    { status: 401, body: { error: { message: "bad key sk-secretsecret123" } }, code: "auth" },
    { status: 403, body: { error: { message: "forbidden" } }, code: "auth" },
    { status: 402, body: { error: { message: "no credit" } }, code: "quota" },
    { status: 429, body: { error: { message: "slow down" } }, code: "rate_limit" },
    { status: 500, body: { error: { message: "boom" } }, code: "unavailable" },
    { status: 400, body: { error: { message: "context length exceeded" } }, code: "context_length" },
  ];
  for (const c of cases) {
    const server = await startServer(() => ({ status: c.status, body: c.body }));
    try {
      await assert.rejects(
        () =>
          openaiAdapter.generate(
            { prompt: "x", temperature: 0, maxTokens: 10 },
            config({ baseUrl: server.url }),
          ),
        (e) => {
          assert.ok(e instanceof ProviderError, `status ${c.status} should throw ProviderError`);
          assert.equal(e.code, c.code, `status ${c.status}`);
          assert.ok(e.userFacing);
          assert.ok(!e.message.includes("secretsecret"), "key must be redacted");
          return true;
        },
      );
    } finally {
      await server.close();
    }
  }
});

test("an unreachable endpoint produces a connection message, not a raw fetch error", async () => {
  await assert.rejects(
    () =>
      openaiAdapter.generate(
        { prompt: "x", temperature: 0, maxTokens: 10 },
        config({ baseUrl: "http://127.0.0.1:1" }),
      ),
    (e) => e instanceof ProviderError && e.code === "unavailable" && /Couldn't reach/.test(e.message),
  );
});

test("caller cancellation propagates instead of looking like a provider failure", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      openaiAdapter.generate(
        { prompt: "x", temperature: 0, maxTokens: 10, signal: controller.signal },
        config({ baseUrl: "http://127.0.0.1:1" }),
      ),
    (e) => !(e instanceof ProviderError) && e.name === "AbortError",
  );
});

test("redactSecrets strips key-shaped tokens from arbitrary text", () => {
  const text = redactSecrets(
    'key sk-abcdefgh12345 header Bearer abc.def-ghi and x-api-key: "zzz"',
  );
  assert.ok(!text.includes("sk-abcdefgh12345"));
  assert.ok(!text.includes("abc.def-ghi"));
  assert.ok(!text.includes("zzz"));
});
