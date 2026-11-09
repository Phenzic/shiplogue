import { cfg } from "./config";
import { StandupContext } from "./types";
import { enforceSublists, limitSectionBullets } from "./format";
import { parseStandupDocument, renderStandupCopy, type StandupDocument } from "./standupDocument";
import { scoreStandupDocument, type StandupQuality } from "./standupQuality";
import { getFormatSections } from "./formatProfile";
import { verifyClaims, Verification } from "./grounding";
import { BudgetReport, ContextBudgetError, trimForBudget } from "./model/budget";
import { buildPrompt as buildPromptCore, DETAIL_LEVELS } from "./core/prompt";
import { resolveBackend } from "./model/registry";
import { BackendMeta } from "./model/types";

// Re-exported for compatibility: tests and the e2e suite import OllamaError
// from here, while the implementation lives with the backend.
export { OllamaError } from "./model/ollama";

// The extension adapter supplies the current settings; core/prompt stays pure
// so the agent can build the same prompt from its own skill/CLI options.
function buildPrompt(ctx: StandupContext): string {
  return buildPromptCore(ctx, { detail: cfg().detail, tone: cfg().tone });
}

function countPrimaryBullets(text: string, label: string): number {
  const target = label.trim().toLowerCase();
  const lines = text.split("\n");
  let inPrimary = false;
  let count = 0;
  for (const line of lines) {
    const heading = line.trim().match(/^\*\*(.+?)\*\*$/);
    if (heading) {
      if (inPrimary) break;
      if (heading[1].trim().toLowerCase() === target) {
        inPrimary = true;
      }
      continue;
    }
    if (inPrimary && /^- /.test(line)) {
      count++;
    }
  }
  return count;
}


export interface GenerateResult {
  text: string;
  // Human-readable notes about deterministic post-processing (e.g. grounding
  // removals) — surfaced in the panel status line.
  warnings: string[];
  // Which engine produced the draft, so the panel can show it. Absent only if
  // the backend failed before returning text.
  backend?: BackendMeta;
  verification?: Verification;
  contextReport?: BudgetReport;
  document?: StandupDocument;
  quality?: StandupQuality;
}

export async function generateStandup(
  ctx: StandupContext,
  signal?: AbortSignal,
  options: { section?: string } = {},
): Promise<GenerateResult> {
  const c = cfg();
  const level = DETAIL_LEVELS[c.detail] ?? DETAIL_LEVELS.concise;
  const budget = c.modelContextTokens > 0 ? c.modelContextTokens - level.predict - 256 : 0;
  if (c.modelContextTokens > 0 && budget <= 0) {
    throw new ContextBudgetError(0, budget);
  }
  const planned = budget > 0 ? trimForBudget(ctx, buildPrompt, budget) : undefined;
  const prompt = planned?.prompt ?? buildPrompt(ctx);

  // Resolve once per run: a backend switch mid-generation would produce a
  // draft whose label doesn't match its source.
  const backend = await resolveBackend();
  const first = await backend.generate({
    prompt,
    temperature: level.temperature,
    maxTokens: level.predict,
    signal,
  });
  let text = first.text;
  let meta = first.meta;

  let formatted = enforceSublists(text);
  let verification = verifyClaims(formatted, ctx);
  let document = parseStandupDocument(verification.cleanDraft);
  let quality: StandupQuality = document
    ? scoreStandupDocument(document, ctx)
    : {
        score: 0,
        issues: ["Use the required theme format: ### Theme title [tag] under Today."],
      };

  // One editorial repair pass, driven by the exact failures. If the model
  // cannot produce the richer format, keep the old flat formatter as fallback.
  if (document && quality.score < 90) {
    const repairPrompt = [
      prompt,
      "",
      "Your previous draft:",
      verification.cleanDraft,
      "",
      "Fix these editorial problems:",
      ...quality.issues.map((issue) => `- ${issue}`),
      "Keep the same Yesterday / Today / Next / Blockers structure. Return only the stand-up.",
    ].join("\n");
    try {
      const repaired = await backend.generate({
        prompt: repairPrompt,
        temperature: level.temperature,
        maxTokens: level.predict,
        signal,
      });
      const candidateText = enforceSublists(repaired.text);
      const candidateVerification = verifyClaims(candidateText, ctx);
      const candidateDoc = parseStandupDocument(candidateVerification.cleanDraft);
      const candidateQuality = candidateDoc
        ? scoreStandupDocument(candidateDoc, ctx)
        : undefined;
      if (candidateDoc && candidateQuality && (!document || candidateQuality.score >= quality.score)) {
        text = repaired.text;
        meta = repaired.meta;
        formatted = candidateText;
        verification = candidateVerification;
        document = candidateDoc;
        quality = candidateQuality;
      }
    } catch (e: any) {
      if (e?.name === "AbortError" || signal?.aborted) {
        throw e;
      }
      /* keep the first draft if the repair call fails */
    }
  }

  // R6 repair pass: only when unsupported completion/person/date claims remain.
  // Paths/numbers/URLs are already removed deterministically above.
  if (verification.needsReview) {
    const unsupported = verification.violations
      .filter((v) => v.kind === "completion" || v.kind === "person" || v.kind === "date")
      .map((v) => v.text);
    const repairPrompt = [
      prompt,
      "",
      "Your previous draft:",
      verification.cleanDraft,
      "",
      `These claims are not supported by the activity: ${[...new Set(unsupported)].join(", ")}.`,
      "Rewrite the stand-up using ONLY facts supported by the activity. Remove or soften those claims; do not invent replacements. Keep the same template.",
      "Output only the stand-up, nothing else.",
    ].join("\n");
    try {
      const repaired = await backend.generate({
        prompt: repairPrompt,
        temperature: level.temperature,
        maxTokens: level.predict,
        signal,
      });
      verification = verifyClaims(enforceSublists(repaired.text), ctx);
      text = repaired.text;
      meta = repaired.meta;
    } catch (e: any) {
      if (e?.name === "AbortError" || signal?.aborted) {
        throw e;
      }
      /* keep the first draft if the repair call fails */
    }
  }

  const warnings =
    verification.removed.length > 0
      ? [`⚠ Removed ${verification.removed.length} unverifiable mention(s): ${[...new Set(verification.removed)].join(", ")}`]
      : [];
  const unsupported = verification.violations.filter((v) => v.kind === "completion").length;
  if (verification.needsReview && unsupported > 0) {
    warnings.push(`⚠ ${unsupported} completion claim(s) need review before sending`);
  }
  if (planned && planned.report.dropped.commits + planned.report.dropped.prompts + planned.report.dropped.github + planned.report.dropped.touches > 0) {
    warnings.push(
      `Context trimmed to ${planned.report.estimated}/${planned.report.budget} tokens: dropped ${planned.report.dropped.commits} commits, ${planned.report.dropped.prompts} prompts, ${planned.report.dropped.github} GitHub items, ${planned.report.dropped.touches} files.`,
    );
  }
  // Grounding may have rewritten the draft; reparse the cleaned text before
  // choosing the canonical output.
  document = parseStandupDocument(verification.cleanDraft) ?? document;
  quality = document ? scoreStandupDocument(document, ctx) : quality;
  const yesterdayLabel =
    getFormatSections().find((section) => section.key === "yesterday")?.label ?? "Yesterday";
  const finalText = document
    ? renderStandupCopy(document, options.section)
    : limitSectionBullets(verification.cleanDraft, [yesterdayLabel], 4);
  return {
    text: finalText,
    warnings,
    backend: meta,
    verification,
    contextReport: planned?.report,
    ...(document ? { document } : {}),
    ...(quality ? { quality } : {}),
  };
}
