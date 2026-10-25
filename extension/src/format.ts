import { StandupContext } from "./types";

// Matches file-path-ish tokens: "src/a.ts", "README.md", ".env", "@scope/x.js".
export const PATHISH = /[\w@][\w.\/-]*\.\w{1,6}/;

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

// Deterministic post-hoc grounding: the model must not invent specifics. Any
// bullet mentioning a file path or #number that appears nowhere in the gathered
// activity is rewritten without the mention (when the bullet survives) or
// dropped — never silently kept.
export function verifyGrounding(
  draft: string,
  ctx: StandupContext,
): { cleanDraft: string; removed: string[] } {
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

  const basename = (p: string) => p.split("/").pop() ?? p;
  const pathVerifiable = (mention: string): boolean =>
    activityText.includes(mention) ||
    [...allowedPaths].some((p) => p === mention || p.endsWith(`/${mention}`) || basename(p) === basename(mention));

  // Tokens that match PATHISH but are prose, not paths.
  const STOP = new Set(["e.g", "i.e", "etc", "vs"]);
  const looksLikePath = (tok: string): boolean =>
    !STOP.has(tok) &&
    /[a-zA-Z]/.test(tok) && // skip pure version numbers like 2.0
    (tok.includes("/") || tok.startsWith(".") || /\.[a-z]{1,6}$/i.test(tok));

  const removed: string[] = [];
  const cleanLines: string[] = [];

  for (const line of draft.split("\n")) {
    // Only bullets make claims; headers/prose pass through untouched.
    if (!/^\s*- /.test(line)) {
      cleanLines.push(line);
      continue;
    }
    const stripped = line.replace(/https?:\/\/\S+/g, "").replace(/\[[^\]]*\]\([^)]*\)/g, "");
    const bad: string[] = [];
    for (const m of stripped.matchAll(new RegExp(PATHISH, "g"))) {
      const tok = m[0];
      if (looksLikePath(tok) && !pathVerifiable(tok)) {
        bad.push(tok);
      }
    }
    for (const m of stripped.matchAll(/#(\d+)/g)) {
      const n = Number(m[1]);
      if (!allowedNums.has(n) && !activityText.includes(`#${n}`)) {
        bad.push(`#${n}`);
      }
    }
    if (bad.length === 0) {
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
      cleanLines.push(rewritten);
    }
    // …otherwise the bullet is dropped entirely.
  }

  // Collapse any blank-line runs left by dropped bullets.
  const cleanDraft = cleanLines.join("\n").replace(/\n{3,}/g, "\n\n");
  return { cleanDraft, removed };
}
