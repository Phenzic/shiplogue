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
const skills = [
  { name: "daily", path: join(here, "..", "..", "plugins", "shiplogue", "skills", "daily", "SKILL.md") },
  { name: "shiplogue-daily", path: join(here, "..", "..", "plugins", "shiplogue-antigravity", "skills", "shiplogue-daily", "SKILL.md") },
];
const { buildInstructions } = require("../dist/extension/src/core/prompt.js");

const frontmatter = (name) => `---
name: ${name}
description: Write the user's daily Shiplogue stand-up from local agent activity, using this model. No model API key is required.
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

const contentFor = (name) => `${frontmatter(name)}\n${body}`;
const check = process.argv.includes("--check");
if (check) {
  for (const skill of skills) {
    try {
      const existing = readFileSync(skill.path, "utf8");
      if (existing !== contentFor(skill.name)) {
        console.error(`Skill is stale: ${skill.path}\nRun: npm run sync:skill`);
        process.exit(1);
      }
      console.log(`Skill is in sync: ${skill.path}`);
    } catch (error) {
      console.error(`Cannot read skill: ${skill.path}\n${error.message}`);
      process.exit(1);
    }
  }
} else {
  for (const skill of skills) {
    writeFileSync(skill.path, contentFor(skill.name));
    console.log(`Wrote ${skill.path}`);
  }
}
