#!/usr/bin/env node
// Recursively collect test files and hand them to node --test.
//
// Why not `node --test test/*.test.js`: that shell glob is not recursive, so
// suites added in subdirectories (test/model, test/core, test/eval) would be
// silently skipped. Directory arguments to `node --test` only recurse on newer
// Node versions, and CI still runs Node 20 — so we enumerate files ourselves.
//
// Dependency-free on purpose: this runs before any test, on every OS.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "test");
const SUFFIX = ".test.js";

function collect(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collect(full));
    } else if (entry.isFile() && entry.name.endsWith(SUFFIX)) {
      found.push(full);
    }
  }
  return found;
}

const files = collect(ROOT).sort();
if (files.length === 0) {
  console.error(`No ${SUFFIX} files found under ${ROOT}`);
  process.exit(1);
}

// Extra args (e.g. --test-concurrency=1) pass through after `npm test --`.
const extra = process.argv.slice(2);
const result = spawnSync(process.execPath, ["--test", ...extra, ...files], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
