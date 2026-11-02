import { cfg } from "./config";
import { StandupContext } from "./types";
import { ContextTextOpts } from "./gather";
import { planPrompt, PromptPlan } from "./model/budget";
import { enforceSublists } from "./format";
import { verify } from "./grounding";
import {
  DETAIL_LEVELS,
  MIN_BULLETS,
  buildPrompt as buildCorePrompt,
  countDoneBullets,
  detailDefaults,
} from "./core/prompt";
import { resolveBackend } from "./model/registry";
import { BackendMeta } from "./model/types";

// Re-exported for compatibility: tests and the e2e suite import OllamaError
// from here, while the implementation lives with the backend.
export { OllamaError } from "./model/ollama";

// Prompt machinery (DETAIL_LEVELS, TONES, template, builder) lives in
// src/core/prompt.ts — the extension passes cfg() values in as an explicit
// style object so the agent/MCP share the identical prompt.

function buildPrompt(ctx: Parameters<typeof buildCorePrompt>[0], fmt: ContextTextOpts = {}): string {
  const c = cfg();
  return buildCorePrompt(ctx, { detail: c.detail, tone: c.tone, format: c.format }, fmt);
}

export interface Verification {
  checkedClaims: number;
  removed: number;
  inferred: number;
  // "kind: text" for every claim the activity did not support (post-repair).
  violations: string[];
  // True when even the repair pass left unsupported claims — the panel flags
  // the draft instead of presenting it as verified.
  needsReview: boolean;
}

export interface GenerateResult {
  text: string;
  // Human-readable notes about deterministic post-processing (e.g. grounding
  // removals) — surfaced in the panel status line.
  warnings: string[];
  verification: Verification;
  // Context preflight outcome (R7) — present when trimming happened.
  budget?: { estimated: number; budget: number; steps: string[] };
  // Which engine produced the draft, so the panel can show it. Absent only if
  // the backend failed before returning text.
  backend?: BackendMeta;
}

// Preflight (R7): pick the backend context window, trim the activity to fit,
// and build the final prompt. Throws ContextBudgetError before any backend
// call when even the fully trimmed prompt cannot fit.
export function planStandupPrompt(
  ctx: StandupContext,
  backendKind: string,
): { prompt: string; plan: PromptPlan; level: { rules: string[]; predict: number; temperature: number } } {
  const c = cfg();
  const level = DETAIL_LEVELS[c.detail] ?? DETAIL_LEVELS.concise;
  const maxOut = c.ollamaNumPredict > 0 ? c.ollamaNumPredict : level.predict;
  const contextTokens = backendKind === "ollama" ? c.ollamaNumCtx : c.modelContextTokens;
  const plan = planPrompt(ctx, {
    contextTokens,
    maxOutputTokens: maxOut,
    defaults: detailDefaults(c.detail),
    measure: (cc, fmt) => buildPrompt(cc, fmt),
  });
  return { prompt: buildPrompt(plan.ctx, plan.fmt), plan, level };
}

export async function generateStandup(
  ctx: StandupContext,
  signal?: AbortSignal,
  onPlan?: (report: PromptPlan["report"]) => void,
): Promise<GenerateResult> {
  const c = cfg();

  // Resolve once per run: a backend switch mid-generation would produce a
  // draft whose label doesn't match its source.
  const backend = await resolveBackend();

  // Preflight: trim the activity to the backend's context window before any
  // tokens are spent; refuses (ContextBudgetError) when it cannot fit.
  const { prompt, plan, level } = planStandupPrompt(ctx, backend.kind);
  onPlan?.(plan.report);

  const first = await backend.generate({
    prompt,
    temperature: level.temperature,
    maxTokens: level.predict,
    signal,
  });
  let text = first.text;
  let meta = first.meta;

  // One self-repair pass: models often under-split into 2-3 bullets no matter
  // what the rules say. Only retry when the activity actually has enough
  // distinct items to honestly support the minimum — never force padding.
  const min = MIN_BULLETS[c.detail] ?? 0;
  const distinctItems =
    ctx.commits.length + ctx.github.length + (ctx.touches.length > 0 ? 1 : 0);
  if (min > 0 && countDoneBullets(text) < min && distinctItems >= min) {
    const repair = [
      prompt,
      "",
      "Your previous draft:",
      text,
      "",
      `That draft has only ${countDoneBullets(text)} bullets in the first section; the requirement is at least ${min}.`,
      `Rewrite the stand-up, splitting themes apart (per file-group, per fix, per branch, per page-set) until the first section has at least ${min} bullets.`,
      "Do NOT invent work — split real work instead. Keep the same template.",
      "Output only the stand-up, nothing else.",
    ].join("\n");
    try {
      const repaired = await backend.generate({
        prompt: repair,
        temperature: level.temperature,
        maxTokens: level.predict,
        signal,
      });
      text = repaired.text;
      meta = repaired.meta;
    } catch (e: any) {
      // A cancelled repair must not silently fall back to the first draft.
      if (e?.name === "AbortError" || signal?.aborted) {
        throw e;
      }
      /* keep the first draft if the repair call fails */
    }
  }

  // Grounding v2: deterministic strip of unsupported claims; if any were found
  // and the activity could have supported real content, one repair pass asks
  // for a natural rewrite. Still-unsupported claims after the repair are
  // flagged needsReview — never silently shipped as clean.
  let result = verify(enforceSublists(text), ctx);
  if (result.violations.length > 0 && distinctItems > 0) {
    const repair = [
      prompt,
      "",
      "Your previous draft:",
      result.cleanDraft,
      "",
      "These claims are not supported by the ACTIVITY (they were stripped):",
      ...[...new Set(result.violations.map((v) => `${v.kind}: ${v.text}`))].map((v) => `- ${v}`),
      "",
      "Rewrite the stand-up using ONLY supported facts. Keep the same template.",
      "Output only the stand-up, nothing else.",
    ].join("\n");
    try {
      const repaired = await backend.generate({
        prompt: repair,
        temperature: level.temperature,
        maxTokens: level.predict,
        signal,
      });
      const rev = verify(enforceSublists(repaired.text), ctx);
      // Take the repair if it is at least as clean as the first pass.
      if (rev.violations.length <= result.violations.length) {
        result = rev;
      }
    } catch (e: any) {
      if (e?.name === "AbortError" || signal?.aborted) {
        throw e;
      }
      /* keep the deterministically cleaned draft if the repair call fails */
    }
  }

  const removedMentions = [...new Set(result.violations.filter((v) => v.kind !== "completion").map((v) => v.text))];
  const warnings: string[] = [];
  if (result.removedCount > 0) {
    warnings.push(`⚠ Removed ${result.removedCount} unverifiable mention(s): ${removedMentions.join(", ")}`);
  }
  const verification: Verification = {
    checkedClaims: result.checkedClaims,
    removed: result.removedCount,
    inferred: result.inferredCount,
    violations: [...new Set(result.violations.map((v) => `${v.kind}: ${v.text}`))],
    needsReview: result.violations.length > 0,
  };
  return {
    text: result.cleanDraft,
    warnings,
    verification,
    ...(plan.report.steps.length ? { budget: { estimated: plan.report.estimated, budget: plan.report.budget, steps: plan.report.steps } } : {}),
    backend: meta,
  };
}
