import { StandupContext } from "./types";
import { verifyGrounding } from "./format";

export type ClaimKind = "path" | "number" | "url" | "completion";

export interface GroundingViolation {
  kind: ClaimKind;
  text: string;
}

export interface Verification {
  cleanDraft: string;
  removed: string[];
  violations: GroundingViolation[];
  checkedClaims: number;
  needsReview: boolean;
}

const COMPLETION =
  /\b(merged|shipped|released|deployed|fixed|added|completed|launched)\b/i;
const URLISH = /https?:\/\/[^\s)]+/g;

// Grounding v2 (first slice): keep the deterministic path/number gate and add
// URL + completion checks. URLs not present in the activity are removed
// deterministically. Unsupported completion verbs are not silently rewritten;
// they are surfaced as needsReview so the panel can warn before copying.
export function verifyClaims(draft: string, ctx: StandupContext): Verification {
  const base = verifyGrounding(draft, ctx);
  const activityText = [
    ...ctx.commits.map((c) => `${c.subject}\n${c.body}\n${c.files.join("\n")}`),
    ...ctx.github.map((g) => `${g.title}\n${g.url}\n#${g.number}`),
    ...ctx.cursorPrompts.map((p) => p.text),
    ...ctx.touches.map((t) => t.file),
  ].join("\n");

  const violations: GroundingViolation[] = [];
  for (const text of base.removed) {
    violations.push({ kind: text.startsWith("#") ? "number" : "path", text });
  }

  const removed = [...base.removed];
  const lines: string[] = [];
  let checkedClaims = 0;

  for (const line of base.cleanDraft.split("\n")) {
    if (!/^\s*- /.test(line)) {
      lines.push(line);
      continue;
    }
    checkedClaims++;
    let rewritten = line;
    let changed = false;

    for (const m of line.matchAll(URLISH)) {
      const url = m[0].replace(/[.,;:]+$/, "");
      if (!activityText.includes(url)) {
        violations.push({ kind: "url", text: url });
        removed.push(url);
        rewritten = rewritten.split(url).join("");
        changed = true;
      }
    }

    const isInferred = /^\s*- (?:\(inferred\)|\*\(inferred\)\*)/i.test(rewritten);
    if (!isInferred && ctx.commits.length === 0 && ctx.github.length === 0) {
      const verb = rewritten.match(COMPLETION);
      if (verb) {
        violations.push({ kind: "completion", text: verb[0] });
      }
    }

    if (!changed) {
      lines.push(line);
      continue;
    }

    const indent = line.match(/^\s*/)?.[0] ?? "";
    rewritten = indent + rewritten.trimStart().replace(/\s{2,}/g, " ").replace(/\s+([.,:)])/g, "$1").trimEnd();
    const body = rewritten.replace(/^\s*- /, "").trim();
    if (body.split(/\s+/).filter(Boolean).length >= 3) {
      lines.push(rewritten);
    }
  }

  const cleanDraft = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  return {
    cleanDraft,
    removed,
    violations,
    checkedClaims,
    needsReview: violations.some((v) => v.kind === "completion"),
  };
}
