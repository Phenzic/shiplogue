"use strict";
// The per-draft history log used by the panel's History tab.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub, tmpDir, makeContext } = require("./helpers");

const { stub } = installVscodeStub();
const { DraftHistory } = require("../out/draftHistory");

function make(overrides = {}) {
  stub.reset();
  stub.setConfig({ "shiplogue.history.retentionDays": 7, "shiplogue.history.maxEntries": 50, ...overrides });
  const ctx = makeContext(tmpDir());
  return { ctx, dh: new DraftHistory(ctx) };
}

function entry(n, overrides = {}) {
  return {
    ts: new Date(Date.now() - n * 60000).toISOString(),
    markdown: `**Done**\n- Draft ${n}`,
    detail: "concise",
    tone: "neutral",
    ...overrides,
  };
}

test("add + list returns newest first with a stable cursor", () => {
  const { dh } = make();
  const a = dh.add(entry(2, { markdown: "**Done**\n- oldest" }));
  const b = dh.add(entry(1, { markdown: "**Done**\n- middle" }));
  const c = dh.add(entry(0, { markdown: "**Done**\n- newest" }));

  const page = dh.list({ limit: 2 });
  assert.deepEqual(page.entries.map((e) => e.id), [c.id, b.id]);
  assert.equal(page.cursor, b.id);
  assert.equal(page.total, 3);

  const next = dh.list({ cursor: page.cursor, limit: 2 });
  assert.deepEqual(next.entries.map((e) => e.id), [a.id]);
  assert.equal(next.cursor, undefined);
});

test("search matches the draft text and model label", () => {
  const { dh } = make();
  dh.add(entry(1, { markdown: "**Done**\n- Shipped the deploy pipeline", modelLabel: "Ollama · m" }));
  dh.add(entry(2, { markdown: "**Done**\n- Wrote docs" }));
  assert.equal(dh.list({ query: "deploy" }).total, 1);
  assert.equal(dh.list({ query: "OLLAMA" }).total, 1);
  assert.equal(dh.list({ query: "nothing here" }).total, 0);
});

test("markSent accumulates targets once and markCopied flags the entry", () => {
  const { dh } = make();
  const e = dh.add(entry(1));
  assert.deepEqual(dh.get(e.id).sentTo, []);
  dh.markSent(e.id, ["slack"]);
  dh.markSent(e.id, ["slack", "teams"]);
  assert.deepEqual(dh.get(e.id).sentTo.sort(), ["slack", "teams"]);
  dh.markCopied(e.id);
  assert.equal(dh.get(e.id).copied, true);
  dh.markSent("missing", ["slack"]); // no throw
});

test("needsReview is derived from verification when saving", () => {
  const { dh } = make();
  const e = dh.add(
    entry(1, {
      verification: {
        checkedClaims: 3,
        removed: 1,
        inferred: 0,
        violations: ["path: src/x.ts"],
        needsReview: true,
      },
    }),
  );
  assert.equal(dh.get(e.id).needsReview, true);
});

test("retention prunes old drafts; maxEntries caps the log", () => {
  const { dh } = make({ "shiplogue.history.maxEntries": 50 });
  dh.add(entry(9, { ts: new Date(Date.now() - 30 * 86400000).toISOString() }));
  dh.add(entry(0));
  dh.add(entry(1));
  assert.equal(dh.count(), 3);

  assert.equal(dh.prune(), 1, "the 30-day-old draft is pruned");
  assert.equal(dh.count(), 2);

  const capped = make({ "shiplogue.history.maxEntries": 2 });
  for (let i = 0; i < 5; i++) capped.dh.add(entry(i));
  assert.equal(capped.dh.count(), 2, "the log never exceeds maxEntries");
});

test("a corrupt history file degrades to empty without throwing", () => {
  const { ctx } = make();
  const fs = require("fs");
  const path = require("path");
  fs.writeFileSync(path.join(ctx.globalStorageUri.fsPath, "history.json"), "{not json");
  const dh = new DraftHistory(ctx);
  assert.equal(dh.count(), 0);
  assert.doesNotThrow(() => dh.add(entry(1)));
});

test("history survives a reload (persisted to global storage)", () => {
  const { ctx, dh } = make();
  dh.add(entry(1, { markdown: "**Done**\n- persisted" }));
  const again = new DraftHistory(ctx);
  assert.equal(again.count(), 1);
  assert.match(again.list().entries[0].markdown, /persisted/);
});
