"use strict";
// Gated real-model suite for the bundled local engine (R4). Placeholder until
// R4 lands: skips unless STANDUP_DRAFT_LOCAL_MODEL=1. Never downloads a model.
const { test } = require("node:test");

const LOCAL = process.env.STANDUP_DRAFT_LOCAL_MODEL === "1";

test("local model generates a structured draft", { skip: !LOCAL }, async (t) => {
  t.skip("R4 (LocalBackend) not implemented yet — this suite is scaffolding");
});
