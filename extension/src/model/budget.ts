import { StandupContext } from "../types";

// Conservative prompt size estimate. We intentionally avoid a tokenizer
// dependency: chars/3.6 + 2 per line overestimates English/code prompts, which
// is the safe direction for a hard preflight gate.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6) + text.split("\n").length * 2;
}

export class ContextBudgetError extends Error {
  constructor(
    public estimated: number,
    public budget: number,
  ) {
    super(
      `Activity is too large for the configured context (${estimated} > ${budget} tokens even after trimming). Raise shiplogue.model.contextTokens, lower the lookback, or use a shorter detail level.`,
    );
    this.name = "ContextBudgetError";
  }
}

export interface BudgetReport {
  estimated: number;
  budget: number;
  dropped: { commits: number; prompts: number; github: number; touches: number };
}

export interface PlannedPrompt {
  prompt: string;
  report: BudgetReport;
}

function copy(ctx: StandupContext): StandupContext {
  return {
    ...ctx,
    commits: ctx.commits.map((c) => ({ ...c, files: [...c.files] })),
    cursorPrompts: [...ctx.cursorPrompts],
    github: [...ctx.github],
    touches: [...ctx.touches],
  };
}

// Trim in priority order (newest prompts, oldest commits, bodies, files,
// touches, GitHub items) until the estimated prompt fits the budget or the
// minimum is reached. `build` is injected so this module stays independent of
// summarize/prompt construction.
export function trimForBudget(
  source: StandupContext,
  build: (ctx: StandupContext) => string,
  budget: number,
): PlannedPrompt {
  const ctx = copy(source);
  const original = { commits: ctx.commits.length, prompts: ctx.cursorPrompts.length, github: ctx.github.length, touches: ctx.touches.length };
  let prompt = build(ctx);

  const finish = (): PlannedPrompt => ({
    prompt,
    report: {
      estimated: estimateTokens(prompt),
      budget,
      dropped: {
        commits: original.commits - ctx.commits.length,
        prompts: original.prompts - ctx.cursorPrompts.length,
        github: original.github - ctx.github.length,
        touches: original.touches - ctx.touches.length,
      },
    },
  });

  if (budget <= 0 || estimateTokens(prompt) <= budget) {
    return finish();
  }

  const rebuild = () => {
    prompt = build(ctx);
    return estimateTokens(prompt) <= budget;
  };

  // 1. Prompts: newest first, drop the oldest half repeatedly.
  while (ctx.cursorPrompts.length > 0 && !rebuild()) {
    ctx.cursorPrompts = ctx.cursorPrompts.slice(0, Math.floor(ctx.cursorPrompts.length / 2));
  }
  // 2. Oldest commits first.
  while (ctx.commits.length > 1 && !rebuild()) {
    ctx.commits = ctx.commits.slice(0, Math.ceil(ctx.commits.length / 2));
  }
  // 3. Commit bodies, then files.
  for (const limit of [200, 0]) {
    if (rebuild()) return finish();
    ctx.commits = ctx.commits.map((c) => ({ ...c, body: c.body.slice(0, limit) }));
  }
  for (const limit of [6, 0]) {
    if (rebuild()) return finish();
    ctx.commits = ctx.commits.map((c) => ({ ...c, files: c.files.slice(0, limit) }));
  }
  // 4. Touches, then GitHub items.
  for (const limit of [12, 5, 0]) {
    if (rebuild()) return finish();
    ctx.touches = ctx.touches.slice(0, limit);
  }
  for (const limit of [15, 0]) {
    if (rebuild()) return finish();
    ctx.github = ctx.github.slice(0, limit);
  }

  if (!rebuild()) {
    throw new ContextBudgetError(estimateTokens(prompt), budget);
  }
  return finish();
}
