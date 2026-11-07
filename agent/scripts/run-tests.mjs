// Recursive, dependency-free test discovery for the agent package.
// Node's built-in runner accepts explicit files; this keeps nested suites
// (events/, hooks/, mcp/) running without a glob dependency.
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve("test");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(root).sort();
if (files.length === 0) {
  console.error("No test files found under test/");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...files],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
