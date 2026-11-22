// Generate the Claude Code skill from the same core prompt used by the
// extension and the MCP prompt. Run after `npm run build`.
//
//   npm run sync:skill
//   npm run check:skill   # CI/release gate: fails if the file is stale
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const skillPath = join(here, "..", "..", "plugins", "shiplogue", "skills", "daily", "SKILL.md");
const { buildInstructions } = require("../dist/extension/src/core/prompt.js");

const frontmatter = `---
name: daily
description: Write the user's daily Shiplogue stand-up from local Claude Code/Cursor/Codex activity, using this model. No model API key is required.
---
`;

const body = `<!-- Generated from extension/src/core/prompt.ts. Run npm run sync:skill after changing the shared rules. -->

# Daily Shiplogue stand-up

Use the Shiplogue MCP tools to write today's stand-up **yourself**, with the
model and subscription already running this session. Do not ask for a BYOK key,
Ollama, or a hosted model.

${buildInstructions({ detail: "standard", tone: "neutral" })}

## Guardrails

- Never invent work, filenames, PR/issue numbers, or dates.
- Activity comes from the local store; do not read or print secrets.
- Cloud sync/posting requires a Shiplogue project key. If it is not configured,
  keep the draft local and say so. Do not ask for a model key.
`;

const content = `${frontmatter}\n${body}`;
const check = process.argv.includes("--check");
if (check) {
  try {
    const existing = readFileSync(skillPath, "utf8");
    if (existing !== content) {
      console.error(`Skill is stale: ${skillPath}\nRun: npm run sync:skill`);
      process.exit(1);
    }
    console.log(`Skill is in sync: ${skillPath}`);
  } catch (error) {
    console.error(`Cannot read skill: ${skillPath}\n${error.message}`);
    process.exit(1);
  }
} else {
  writeFileSync(skillPath, content);
  console.log(`Wrote ${skillPath}`);
}
