"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  BUILTIN_FORMAT,
  getFormatSections,
  isPaidPlan,
  normalizeFormatSections,
  resetFormatSections,
  setFormatSections,
} = require("../out/formatProfile");

test("built-in format is Yesterday / Today / Next / Blockers", () => {
  resetFormatSections();
  assert.deepEqual(
    getFormatSections().map((section) => section.label),
    ["Yesterday", "Today", "Next", "Blockers"],
  );
  assert.deepEqual(
    BUILTIN_FORMAT.map((section) => section.key),
    ["yesterday", "today", "next", "blockers"],
  );
});

test("paid custom profiles preserve labels and order", () => {
  const applied = setFormatSections([
    { key: "today", label: "Accomplishments" },
    { key: "yesterday", label: "Since last time" },
    { key: "blockers", label: "Blocked by" },
    { key: "next", label: "Up next" },
  ]);
  assert.deepEqual(
    applied.map((section) => `${section.key}:${section.label}`),
    [
      "today:Accomplishments",
      "yesterday:Since last time",
      "blockers:Blocked by",
      "next:Up next",
    ],
  );
  resetFormatSections();
});

test("invalid or incomplete profiles are rejected", () => {
  assert.equal(normalizeFormatSections(undefined), undefined);
  assert.equal(normalizeFormatSections([]), undefined);
  assert.equal(
    normalizeFormatSections([{ key: "today", label: "Today" }]),
    undefined,
  );
  assert.equal(
    normalizeFormatSections([
      { key: "today", label: "A" },
      { key: "today", label: "B" },
      { key: "next", label: "C" },
      { key: "blockers", label: "D" },
    ]),
    undefined,
  );
  assert.equal(
    normalizeFormatSections([
      { key: "yesterday", label: " " },
      { key: "today", label: "B" },
      { key: "next", label: "C" },
      { key: "blockers", label: "D" },
    ]),
    undefined,
  );
});

test("only non-free plans are paid", () => {
  assert.equal(isPaidPlan("free"), false);
  assert.equal(isPaidPlan("FREE"), false);
  assert.equal(isPaidPlan(""), false);
  assert.equal(isPaidPlan("pro"), true);
  assert.equal(isPaidPlan("team"), true);
});
