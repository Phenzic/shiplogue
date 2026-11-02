import { StandupContext } from "./types";

import { PATHISH } from "./grounding";
export { PATHISH };

// Builds a References block with REAL links, deterministically — the model
// never sees raw URLs, so it can't mangle or hallucinate them.
export function buildReferences(ctx: StandupContext): string {
  if (ctx.github.length === 0) {
    return "";
  }
  const prs = ctx.github.filter((g) => g.kind === "pr");
  const issues = ctx.github.filter((g) => g.kind === "issue");
  const lines: string[] = ["", "**References**"];
  for (const p of prs) {
    lines.push(`- Merged PR [#${p.number}](${p.url}) — ${p.title}`);
  }
  for (const i of issues) {
    lines.push(`- Closed issue [#${i.number}](${i.url}) — ${i.title}`);
  }
  return lines.join("\n");
}

// Deterministic formatting the model half-obeys when asked: any top-level
// bullet ending in an inline run of 3+ file paths ("...: a.md, b.md, c.md")
// is rewritten with the paths as indented sub-bullets, one per line.
export function enforceSublists(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      // "(inferred)" markers (required from the model for guessed Next items)
      // become italics so users can see what the model inferred vs. knows.
      const inferred = line.match(/^(\s*- )\(inferred\)\s+(.*)$/i);
      if (inferred) {
        return `${inferred[1]}*(inferred)* ${inferred[2]}`;
      }
      const m = line.match(/^- (.+?):\s*(.+?)\.?\s*$/);
      if (!m) {
        return line;
      }
      const parts = m[2].split(/,\s*(?:and\s+)?/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 3 || !parts.every((p) => PATHISH.test(p) && !p.includes(" "))) {
        return line;
      }
      return [`- ${m[1]}:`, ...parts.map((p) => `  - ${p}`)].join("\n");
    })
    .join("\n");
}

// Convert a markdown stand-up into readable plain text: unwrap links to
// "text (url)", drop bold/italic markers and heading hashes, normalize bullets.
export function toPlainText(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)") // [text](url) -> text (url)
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** -> bold
    .replace(/\*([^*\n]+)\*/g, "$1") // *italic* -> italic
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // # heading -> heading
    .replace(/^\s*[-*]\s+/gm, "• ") // - item / * item -> • item
    .trim();
}

// Convert Markdown to Slack mrkdwn: bold keeps single stars, links become
// <url|text>, bullets stay as-is.
export function toSlackMrkdwn(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
    .replace(/\*\*([^*]+)\*\*/g, "*$1*");
}

// Untrusted-activity hygiene: commit messages, issue titles and AI prompts are
// user/tool-controlled text that ends up inside an LLM prompt. Strip control
// chars, cap runaway lines, and neutralize lines that look like prompt
// injection ("ignore all previous instructions…") by visibly marking them.
export function sanitizeUntrusted(s: string): string {
  return s
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .split("\n")
    .map((line) => {
      let l = line.length > 500 ? `${line.slice(0, 500)}…` : line;
      if (/^\s*(ignore|disregard|forget)\b.*\b(instruction|prompt|rule)/i.test(l)) {
        l = `[filtered] ${l}`;
      }
      return l;
    })
    .join("\n");
}

// Deterministic post-hoc grounding moved to `grounding.ts` (v2, R6) — this
// re-export keeps existing imports working.
export { verifyGrounding } from "./grounding";
