import { StandupContext } from "./types";

// Context preflight (R7): never send an over-budget prompt; always say what
// was omitted, before generation. Token estimation is deliberately crude
// (chars/3.6 + 2/line) — a real tokenizer would add a dependency and per-model
// variance; a conservative estimate plus visible trim reporting is safer.

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6) + text.split("\n").length * 2;
}

export class ContextBudgetError extends Error {
  userFacing = true;
}

export interface TextFormatOpts {
  perCommitFiles?: number;
  bodyChars?: number;
  touchCap?: number;
}

export interface PromptPlan {
  // The (possibly trimmed) context to render.
  ctx: StandupContext;
  fmt: TextFormatOpts;
  report: {
    estimated: number;
    budget: number;
    included: { commits: number; cursorPrompts: number; github: number; touches: number };
    dropped: { commits: number; cursorPrompts: number; github: number; touches: number };
    steps: string[];
  };
}

const kfmt = (n: number) => `${(n / 1000).toFixed(1)}K`;

// Plans the prompt against the backend's context window. `measure` receives
// the candidate context + format overrides and returns the full prompt text
// (template included), so the estimate covers everything that will be sent.
export function planPrompt(
  input: StandupContext,
  opts: {
    contextTokens: number;
    maxOutputTokens: number;
    // The detail level's defaults, so trim steps only ever SHRINK the prompt.
    defaults: Required<TextFormatOpts>;
    measure: (ctx: StandupContext, fmt: TextFormatOpts) => string;
  },
): PromptPlan {
  const budget = opts.contextTokens - opts.maxOutputTokens - 256;
  const initial = {
    commits: input.commits.length,
    cursorPrompts: input.cursorPrompts.length,
    github: input.github.length,
    touches: input.touches.length,
  };
  const ctx: StandupContext = {
    ...input,
    commits: [...input.commits],
    cursorPrompts: [...input.cursorPrompts],
    github: [...input.github],
    touches: [...input.touches],
  };
  const fmt: TextFormatOpts = {};
  const steps: string[] = [];
  const dropped = { commits: 0, cursorPrompts: 0, github: 0, touches: 0 };

  const estimate = () => estimateTokens(opts.measure(ctx, fmt));
  let estimated = estimate();

  const done = (): PromptPlan => ({
    ctx,
    fmt,
    report: { estimated, budget, included: { ...currentCounts() }, dropped, steps },
  });
  const currentCounts = () => ({
    commits: ctx.commits.length,
    cursorPrompts: ctx.cursorPrompts.length,
    github: ctx.github.length,
    touches: ctx.touches.length,
  });

  if (estimated <= budget) {
    return done();
  }

  // (a) Compact Cursor prompts: drop near-duplicates, keep the newest 20.
  const seen = new Set<string>();
  const deduped = ctx.cursorPrompts.filter((p) => {
    const key = p.text.toLowerCase().replace(/\s+/g, " ").slice(0, 60);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const compacted = deduped.slice(0, 20);
  if (compacted.length !== ctx.cursorPrompts.length) {
    dropped.cursorPrompts += ctx.cursorPrompts.length - compacted.length;
    ctx.cursorPrompts = compacted;
    steps.push(`compacted AI prompts to ${compacted.length}`);
    estimated = estimate();
    if (estimated <= budget) {
      return done();
    }
  }

  // (b) Drop oldest commits (commits are newest-first after capActivity).
  while (estimated > budget && ctx.commits.length > 1) {
    ctx.commits = ctx.commits.slice(0, -1);
    dropped.commits++;
    estimated = estimate();
  }
  if (dropped.commits > 0) {
    steps.push(`dropped ${dropped.commits} older commits`);
    if (estimated <= budget) {
      return done();
    }
  }

  // (c) Commit body chars: shrink 400 → 200 → 0 (never above the level default).
  for (const bodyChars of [200, 0].filter((b) => b < opts.defaults.bodyChars)) {
    if (estimated <= budget) {
      break;
    }
    fmt.bodyChars = bodyChars;
    estimated = estimate();
  }
  if (fmt.bodyChars !== undefined) {
    steps.push(fmt.bodyChars === 0 ? "omitted commit bodies" : "trimmed commit bodies");
    if (estimated <= budget) {
      return done();
    }
  }

  // (d) Files per commit: 15 → 6 → 0 (never above the level default).
  for (const perCommitFiles of [6, 0].filter((f) => f < opts.defaults.perCommitFiles)) {
    if (estimated <= budget) {
      break;
    }
    fmt.perCommitFiles = perCommitFiles;
    estimated = estimate();
  }
  if (fmt.perCommitFiles !== undefined) {
    steps.push(fmt.perCommitFiles === 0 ? "omitted per-commit file lists" : "trimmed per-commit file lists");
    if (estimated <= budget) {
      return done();
    }
  }

  // (e) Touches: 25 → 12 → 5 (never above the level default).
  for (const touchCap of [12, 5].filter((t) => t < opts.defaults.touchCap)) {
    if (estimated <= budget) {
      break;
    }
    fmt.touchCap = touchCap;
    estimated = estimate();
  }
  if (fmt.touchCap !== undefined) {
    steps.push(`capped file touches at ${fmt.touchCap}`);
    if (estimated <= budget) {
      return done();
    }
  }

  // (f) GitHub items: 30 → 15 → 0.
  for (const cap of [15, 0]) {
    if (estimated <= budget) {
      break;
    }
    const before = ctx.github.length;
    ctx.github = ctx.github.slice(0, cap);
    dropped.github += before - ctx.github.length;
    estimated = estimate();
  }
  if (dropped.github > 0) {
    steps.push(`dropped ${dropped.github} GitHub items`);
    if (estimated <= budget) {
      return done();
    }
  }

  if (estimated > budget) {
    throw new ContextBudgetError(
      `Your activity is too large for the model's context window even after trimming ` +
        `(~${kfmt(estimated)} tokens vs ${kfmt(budget)} budget). Raise standupDraft.model.contextTokens ` +
        `(or standupDraft.ollama.numCtx for Ollama), lower standupDraft.lookbackHours, or switch to the concise detail level.`,
    );
  }
  return done();
}
