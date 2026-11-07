// MCP tool implementations. The primary flow is agent-authored: the host model
// calls get_activity, writes the stand-up, then calls save_standup. No model
// provider or API key is needed for that path.
import * as fs from "fs";
import {
  buildReferences,
  contextToText,
  DETAIL_LEVELS,
  enforceSublists,
  getFormatSections,
  limitSectionBullets,
  parseStandupDocument,
  renderStandupDocument,
  scoreStandupDocument,
  toPlainText,
  verifyClaims,
  toneInstruction,
  type DetailLevel,
  type Tone,
} from "../core";
import { configFile } from "../hooks/install";
import type { HookAgent } from "../hooks/normalize";
import { gatherActivity, type ActivityStats } from "../activity";
import { currentAgentStatus } from "../status";
import {
  finalizeDraft,
  latestDraftDate,
  loadDraft,
  reviseSection,
  saveDraft,
} from "../drafts/store";
import { dayKey } from "../events/store";

export interface GetActivityInput {
  lookbackHours?: number;
  repoPath?: string;
  includeGitHub?: boolean;
  includeIdePrompts?: boolean;
  detail?: DetailLevel;
}

export interface SaveStandupInput {
  markdown: string;
  date?: string;
  source?: string;
  lookbackHours?: number;
  repoPath?: string;
}

export interface RenderStandupInput {
  markdown?: string;
  date?: string;
}

export interface ReviseStandupInput {
  markdown?: string;
  section: "yesterday" | "today" | "next" | "blockers";
  text: string;
  mode?: "replace" | "append";
  date?: string;
}

function sanitizeDate(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function statsText(stats: ActivityStats): string {
  return [
    `workspace: ${stats.workspaceRoot}`,
    `window: ${stats.since} → ${stats.until}`,
    `events: ${stats.events} · sessions: ${stats.sessions} · prompts: ${stats.prompts} · responses: ${stats.responses}`,
    `tools: ${stats.toolCalls} · shells: ${stats.shells} · file edits: ${stats.fileEdits} · file reads: ${stats.fileReads}`,
    `files touched: ${stats.filesTouched} · commits: ${stats.commits} (${stats.commitFiles} files) · uncommitted: ${stats.uncommittedFiles}`,
    `diff: +${stats.diff.additions} / -${stats.diff.deletions}`,
    `github: ${stats.github.prs} PRs · ${stats.github.issues} issues`,
    `tokens: ${stats.tokens.input} in / ${stats.tokens.output} out / ${stats.tokens.total} total` +
      (stats.tokens.costUsd ? ` · est. $${stats.tokens.costUsd.toFixed(4)}` : ""),
    `sources: ${
      Object.entries(stats.bySource)
        .map(([source, count]) => `${source}=${count}`)
        .join(", ") || "none"
    }`,
  ].join("\n");
}

export async function getActivity(input: GetActivityInput = {}) {
  const detail = input.detail ?? "standard";
  const result = await gatherActivity({
    lookbackHours: input.lookbackHours,
    repoPath: input.repoPath,
    includeGitHub: input.includeGitHub,
    includeIdePrompts: input.includeIdePrompts,
  });
  const text = [
    "# Shiplogue activity",
    "",
    contextToText(result.context, detail),
    "",
    "## Agent activity stats",
    statsText(result.stats),
    "",
    "## How to use this",
    "Write the stand-up in your own voice using the shiplogue-daily prompt/skill.",
    "Use only the activity above. Then call save_standup with the finished Markdown.",
    "A Shiplogue Cloud project key is only needed for cloud sync/posting, not for this local draft.",
  ].join("\n");
  return { text, stats: result.stats, context: result.context };
}

export async function saveStandup(input: SaveStandupInput) {
  if (!input.markdown || !input.markdown.trim()) {
    throw new Error("save_standup requires markdown");
  }
  const result = await gatherActivity({
    lookbackHours: input.lookbackHours,
    repoPath: input.repoPath,
    includeGitHub: true,
  });
  const final = finalizeDraft(input.markdown, result.context);
  const date = sanitizeDate(input.date) ?? dayKey(new Date());
  const draft = saveDraft(final.markdown, {
    date,
    source: input.source ?? "agent",
    warnings: final.warnings,
    quality: final.quality,
    plainText: final.plainText,
  });
  const text = [
    `Saved Shiplogue draft for ${date} (revision ${draft.revision}); ${final.quality.score}/100 editorial score.`,
    draft.markdown,
    ...(final.warnings.length ? ["", ...final.warnings] : []),
    ...(final.quality.issues.length ? ["", "Editorial suggestions:", ...final.quality.issues.map((issue) => `- ${issue}`)] : []),
    "",
    "Cloud sync/posting is disabled until a Shiplogue project key is configured.",
  ].join("\n");
  return {
    text,
    draft,
    final,
    stats: result.stats satisfies ActivityStats,
  };
}

export function renderStandup(input: RenderStandupInput = {}) {
  const date = sanitizeDate(input.date);
  if (input.markdown) {
    const formatted = enforceSublists(input.markdown);
    const document = parseStandupDocument(formatted);
    const markdown = document ? renderStandupDocument(document) : formatted;
    return {
      markdown,
      plainText: toPlainText(markdown),
      path: undefined as string | undefined,
      revision: undefined as number | undefined,
    };
  }
  const draft = loadDraft(date);
  if (!draft) {
    throw new Error("No local draft found. Run shiplogue standup or save_standup first.");
  }
  return {
    markdown: draft.markdown,
    plainText: draft.plainText,
    path: `${draft.date}.md`,
    revision: draft.revision,
  };
}

export async function reviseStandup(input: ReviseStandupInput) {
  const base = input.markdown ?? loadDraft(sanitizeDate(input.date))?.markdown;
  if (!base) {
    throw new Error("revise_standup requires markdown or an existing draft");
  }
  const revised = reviseSection(
    base,
    input.section,
    input.text,
    input.mode ?? "replace",
  );
  return saveStandup({ markdown: revised, date: input.date, source: "agent-revision" });
}

export function getAgentStatus() {
  return currentAgentStatus();
}

export function dailyPromptInstructions(detail: DetailLevel = "standard", tone: Tone = "neutral"): string {
  const sections = getFormatSections().map((section) => section.label).join(" / ");
  const detailRules = DETAIL_LEVELS[detail]?.rules ?? [];
  return [
    "You are writing the user's own developer daily stand-up.",
    "",
    "1. Call get_activity to read their local activity for the lookback window.",
    "2. Write the stand-up yourself, using only that activity. Do not invent work, files, or numbers.",
    "3. Keep the fixed sections: " + sections + ".",
    "4. Each Today item is a workstream: '### <title> [feature]', one outcome sentence, then optional indented detail/files.",
    "5. Allowed tags: feature, fix, debug, security, docs, refactor, test, performance, chore.",
    "6. Put file paths only in indented detail, max 3 per workstream and 8 total.",
    "7. Never claim a deployment, merge, or completion the activity does not prove.",
    "8. If Next has no evidence, write '- None'. If there are no blockers, write '- None'.",
    "9. Start inferred Next bullets with '(inferred)'.",
    "10. Call save_standup with the finished Markdown. The user should not have to save separately.",
    "",
    ...detailRules,
    ...(toneInstruction(tone) ? [toneInstruction(tone)!] : []),
    "",
    `Detail: ${detail}; tone: ${tone}.`,
  ].join("\n");
}

export function hooksInstalledStatus(home?: string) {
  const result: Record<string, boolean> = {};
  for (const agent of ["claude", "cursor", "codex"] as HookAgent[]) {
    try {
      const raw = fs.readFileSync(configFile(agent, home), "utf8");
      result[agent] = raw.includes(`hook ${agent} `);
    } catch {
      result[agent] = false;
    }
  }
  return result;
}

export { buildReferences, latestDraftDate, scoreStandupDocument, verifyClaims, limitSectionBullets };
