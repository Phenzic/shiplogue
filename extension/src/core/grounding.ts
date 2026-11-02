import { StandupContext } from "./types";

// Matches file-path-ish tokens: "src/a.ts", "README.md", ".env", "@scope/x.js".
// (format.ts re-exports this for compatibility.)
export const PATHISH = /[\w@][\w.\/-]*\.\w{1,6}/;

// Grounding v2 (R6): deterministic post-hoc verification of the model's draft
// against the gathered activity. Every specific claim — file paths, #numbers,
// URLs, dates/metrics, people, and completion claims — must be backed by the
// activity. Unsupported mentions are stripped or their bullet dropped; nothing
// unverifiable is silently kept. `*(inferred)*` bullets are exempt from
// completion verification (they are visibly marked as guesses).

export type ClaimKind = "path" | "number" | "url" | "date" | "metric" | "person" | "completion";

export interface Claim {
  kind: ClaimKind;
  text: string;
  bullet: string;
}

export interface VerifyResult {
  cleanDraft: string;
  // Claims in the INPUT draft that the activity does not support.
  violations: Claim[];
  removedCount: number;
  inferredCount: number;
  checkedClaims: number;
}

const COMPLETION_VERB = /\b(merged|shipped|released|deployed|fixed|completed|launched|added)\b/i;
const DATE_TOKEN = /\b(20\d{2}(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?|Q[1-4]\s*20\d{2})\b/;
const METRIC_TOKEN = /\bv?\d+\.\d+(?:\.\d+)?\b/;
const HANDLE = /(^|\s)@([\w-]{2,})/g;
const PAIRED = /\bpaired with\s+([A-Z][A-Za-z]+)/g;

// Tech/org words that look like people or versions to the naive patterns.
const PROSE_STOP = new Set([
  "e.g", "i.e", "etc", "vs",
  "React", "Slack", "VS", "Code", "CI", "CD", "API", "GitHub", "Discord", "Teams",
]);

const WORD_STOP = new Set([
  "this", "that", "with", "from", "into", "your", "yours", "their", "them", "they", "have",
  "been", "were", "was", "are", "and", "the", "for", "to", "in", "on", "at", "by",
  "its", "as", "we", "my", "our", "us", "it", "of", "an", "a", "is", "be", "or", "not",
  "over", "under", "after", "before", "while", "when", "then", "than", "also", "just",
  "more", "most", "some", "all", "any", "each", "per", "via", "now", "today", "tomorrow",
  "updated", "update", "worked", "working", "change", "changes", "changed",
]);

function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[a-z][a-z0-9_-]{3,}/g)) {
    if (!WORD_STOP.has(m[0])) {
      out.add(m[0]);
    }
  }
  return out;
}

// A completion claim ("Shipped X") needs an anchor: a supported path/#/url in
// the same bullet, or a content word that also appears in the activity.
function hasAnchor(bullet: string, activityWords: Set<string>): boolean {
  for (const w of words(bullet)) {
    if (activityWords.has(w)) {
      return true;
    }
  }
  return false;
}

export function verify(draft: string, ctx: StandupContext): VerifyResult {
  // Everything the model is allowed to reference, as one searchable blob…
  const activityText = [
    ...ctx.commits.map((c) => `${c.subject}\n${c.body}\n${c.files.join("\n")}`),
    ...ctx.github.map((g) => `${g.title}\n${g.url}\n#${g.number}`),
    ...ctx.cursorPrompts.map((p) => p.text),
    ...ctx.touches.map((t) => t.file),
  ].join("\n");
  // …plus path sets for basename/suffix matches (the model may shorten paths).
  const allowedPaths = new Set<string>([
    ...ctx.commits.flatMap((c) => c.files),
    ...ctx.touches.map((t) => t.file),
  ]);
  const allowedNums = new Set<number>(ctx.github.map((g) => g.number));
  const activityWords = words(activityText);

  const basename = (p: string) => p.split("/").pop() ?? p;
  const pathVerifiable = (mention: string): boolean =>
    activityText.includes(mention) ||
    [...allowedPaths].some(
      (p) => p === mention || p.endsWith(`/${mention}`) || basename(p) === basename(mention),
    );

  const looksLikePath = (tok: string): boolean =>
    !PROSE_STOP.has(tok) &&
    /[a-zA-Z]/.test(tok) && // skip pure version numbers like 2.0
    (tok.includes("/") || tok.startsWith(".") || /\.[a-z]{1,6}$/i.test(tok));

  const violations: Claim[] = [];
  const removed: string[] = [];
  let checkedClaims = 0;
  let inferredCount = 0;
  const cleanLines: string[] = [];

  for (const line of draft.split("\n")) {
    // Only bullets make claims; headers/prose pass through untouched.
    if (!/^\s*- /.test(line)) {
      cleanLines.push(line);
      continue;
    }
    const inferred = /\*\(inferred\)\*/i.test(line);
    if (inferred) {
      inferredCount++;
    }

    // Strip markdown links after capturing their URLs for the url rule.
    const linkUrls = [...line.matchAll(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
    const bareUrls = [
      ...line.replace(/\[[^\]]*\]\([^)]*\)/g, "").matchAll(/https?:\/\/[^\s)]+/g),
    ].map((m) => m[0]);
    const stripped = line
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\[[^\]]*\]\([^)]*\)/g, "");

    const bad: string[] = [];

    for (const url of [...linkUrls, ...bareUrls]) {
      checkedClaims++;
      if (!activityText.includes(url)) {
        violations.push({ kind: "url", text: url, bullet: line });
        bad.push(url);
      }
    }
    for (const m of stripped.matchAll(new RegExp(PATHISH, "g"))) {
      const tok = m[0];
      if (!looksLikePath(tok)) {
        continue;
      }
      checkedClaims++;
      if (!pathVerifiable(tok)) {
        violations.push({ kind: "path", text: tok, bullet: line });
        bad.push(tok);
      }
    }
    for (const m of stripped.matchAll(/#(\d+)/g)) {
      const n = Number(m[1]);
      checkedClaims++;
      if (!allowedNums.has(n) && !activityText.includes(`#${n}`)) {
        violations.push({ kind: "number", text: `#${n}`, bullet: line });
        bad.push(`#${n}`);
      }
    }

    const isCompletion = COMPLETION_VERB.test(stripped);
    if (isCompletion && !inferred) {
      // Dates/metrics are only suspicious inside completion/deploy claims.
      for (const m of stripped.matchAll(new RegExp(DATE_TOKEN, "g"))) {
        checkedClaims++;
        if (!activityText.includes(m[0])) {
          violations.push({ kind: "date", text: m[0], bullet: line });
          bad.push(m[0]);
        }
      }
      for (const m of stripped.matchAll(new RegExp(METRIC_TOKEN, "g"))) {
        checkedClaims++;
        if (!activityText.includes(m[0])) {
          violations.push({ kind: "metric", text: m[0], bullet: line });
          bad.push(m[0]);
        }
      }
    }

    if (!inferred) {
      for (const m of line.matchAll(HANDLE)) {
        checkedClaims++;
        if (!activityText.includes(`@${m[2]}`)) {
          violations.push({ kind: "person", text: `@${m[2]}`, bullet: line });
          bad.push(`@${m[2]}`);
        }
      }
      for (const m of line.matchAll(PAIRED)) {
        if (PROSE_STOP.has(m[1])) {
          continue;
        }
        checkedClaims++;
        if (!activityText.includes(m[1])) {
          violations.push({ kind: "person", text: m[1], bullet: line });
          bad.push(`paired with ${m[1]}`);
        }
      }
    }

    if (bad.length === 0) {
      if (isCompletion && !inferred) {
        checkedClaims++;
        if (!hasAnchor(stripped, activityWords)) {
          // A completion claim with no tie to the activity at all: drop the
          // bullet (nothing salvageable) rather than rewrite prose blindly.
          violations.push({ kind: "completion", text: stripped.replace(/^\s*- /, ""), bullet: line });
          continue;
        }
      }
      cleanLines.push(line);
      continue;
    }

    removed.push(...bad);
    // Try to save the bullet: drop the invented mentions and tidy up.
    let rewritten = line;
    for (const b of bad) {
      rewritten = rewritten.split(b).join("");
    }
    rewritten = rewritten
      .replace(/\[\s*([^\]]*?)\s*\]\(\s*\)/g, "$1") // [text]() -> text
      .replace(/\(\s*,/g, "(")
      .replace(/,\s*\)/g, ")")
      .replace(/\(\s*\)/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.,:)])/g, "$1")
      .replace(/\s+(in|to|from|with|and|the|a|an|of|for|about|on|at|into|via)\s*$/i, "")
      .replace(/[ ,;(]$/, "")
      .trimEnd();
    const body = rewritten.replace(/^\s*- /, "").trim();
    if (body.split(/\s+/).filter(Boolean).length >= 3) {
      // The surviving text must still be anchored if it claims completion.
      if (isCompletion && !inferred && !hasAnchor(rewritten, activityWords)) {
        violations.push({ kind: "completion", text: body, bullet: line });
        continue;
      }
      cleanLines.push(rewritten);
    } else if (isCompletion && !inferred) {
      violations.push({ kind: "completion", text: body, bullet: line });
    }
    // …otherwise the bullet is dropped entirely.
  }

  // Collapse any blank-line runs left by dropped bullets.
  const cleanDraft = cleanLines.join("\n").replace(/\n{3,}/g, "\n\n");
  return {
    cleanDraft,
    violations,
    removedCount: removed.length,
    inferredCount,
    checkedClaims,
  };
}

// Backward-compatible v1 surface (format.ts re-exports this shape).
export function verifyGrounding(
  draft: string,
  ctx: StandupContext,
): { cleanDraft: string; removed: string[] } {
  const r = verify(draft, ctx);
  return { cleanDraft: r.cleanDraft, removed: r.violations.filter((v) => v.kind !== "completion").map((v) => v.text) };
}
