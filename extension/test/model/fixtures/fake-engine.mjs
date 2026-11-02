// Fake in-process engine for LocalBackend (R4) unit tests. Implements the
// engine surface R4 defines — load/ready, generate, dispose — with behavior
// controlled by env var FAKE_ENGINE_MODE, and records every request so tests
// can assert prompt shape and cancellation without native binaries or a model.
//
// Modes: ok | delay | abort | empty | truncate | throw | oom
//
// Not compiled into the extension; loaded by tests only.
"use strict";

const MODE = process.env.FAKE_ENGINE_MODE || "ok";

const DRAFT = [
  "Hey team, here's what I worked on today:",
  "",
  "**Done**",
  "- Shipped the fake-engine change.",
  "",
  "**Next**",
  "- Keep going.",
  "",
  "**Blockers**",
  "- None",
].join("\n");

class FakeEngine {
  constructor() {
    this.loaded = 0;
    this.disposed = 0;
    this.requests = [];
    this.ready = false;
  }

  async ensureLoaded() {
    if (MODE === "oom") {
      const e = new Error("out of memory");
      e.code = "OOM";
      throw e;
    }
    if (MODE === "throw") {
      throw new Error("native load failed");
    }
    this.loaded++;
    this.ready = true;
  }

  isReady() {
    return this.ready;
  }

  async generate({ prompt, temperature, maxTokens, signal }) {
    this.requests.push({ prompt, temperature, maxTokens });
    if (MODE === "delay") {
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (signal?.aborted || MODE === "abort") {
      throw new DOMException("Generation aborted", "AbortError");
    }
    if (MODE === "empty") {
      return { text: "", meta: { finish: "length" } };
    }
    if (MODE === "truncate") {
      return { text: "**Done**\n- Half a thought in", meta: { finish: "length" } };
    }
    return { text: DRAFT, meta: { finish: "stop", outputTokens: 42 } };
  }

  async dispose() {
    this.ready = false;
    this.disposed++;
  }
}

module.exports = { FakeEngine, DRAFT };
