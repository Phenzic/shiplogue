#!/usr/bin/env node
// One-command local verification: typecheck, full test suite, artifact sizes.
// Dependency-free; safe on every OS. Does not build the VSIX (that needs
// network for npx on a cold cache) — it reports the size of existing builds.

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function run(label, cmd, args) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed`);
    process.exit(result.status ?? 1);
  }
  console.log(`✓ ${label}`);
}

run("typecheck", "npx", ["tsc", "-p", "./", "--noEmit"]);
run("tests", process.execPath, ["scripts/run-tests.mjs"]);

const vsix = readdirSync(".").filter((f) => f.endsWith(".vsix")).sort();
if (vsix.length) {
  console.log("\nArtifacts:");
  for (const f of vsix) {
    console.log(`  ${f}  ${(statSync(join(".", f)).size / 1024).toFixed(1)} KB`);
  }
} else {
  console.log("\nNo .vsix artifacts present (run npm run package to build one).");
}
console.log("\n✓ verify complete");
