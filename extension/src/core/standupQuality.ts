import type { StandupContext } from "./types";
import type { StandupDocument } from "./standupDocument";

export type StandupQuality = {
  score: number;
  issues: string[];
};

const PATH = /[\w@][\w.\/-]*\.\w{1,6}/;

function sentences(text: string): number {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

/**
 * Heuristic editorial score. It is intentionally deterministic: it catches
 * the failures we saw in real drafts (flat file lists, duplicated Yesterday,
 * merge-first ordering, unsupported deploy claims) and drives one repair.
 */
export function scoreStandupDocument(
  doc: StandupDocument,
  ctx?: StandupContext,
): StandupQuality {
  const issues: string[] = [];
  const headline = doc.headline.trim();
  if (!headline) {
    issues.push("add a 1-2 sentence headline that tells the story");
  } else if (sentences(headline) > 2) {
    issues.push("shorten the headline to 1-2 sentences");
  }

  if (doc.today.length < 2) {
    issues.push("group Today into at least 2 workstreams");
  }
  if (doc.today.length > 5) {
    issues.push("collapse Today to at most 5 workstreams");
  }

  let totalFiles = 0;
  for (const theme of doc.today) {
    if (!theme.summary) issues.push(`add a one-sentence outcome for "${theme.title}"`);
    if (/:$/.test(theme.summary.trim())) {
      issues.push(`remove the dangling colon from "${theme.title}"`);
    }
    if (PATH.test(theme.summary)) {
      issues.push(`move file paths out of the "${theme.title}" sentence`);
    }
    if (/["“”]/.test(theme.title) || /["“”]/.test(theme.summary)) {
      issues.push(`remove quotation marks from "${theme.title}"`);
    }
    if (theme.files.length > 3) {
      issues.push(`cap "${theme.title}" at 3 files`);
    }
    totalFiles += theme.files.length;
  }
  if (totalFiles > 8) issues.push("cap the draft at 8 referenced files");

  if (doc.yesterday.length === 0) {
    issues.push("add a short Yesterday summary");
  }
  if (doc.yesterday.length > 4) {
    issues.push("keep Yesterday to at most 4 story bullets");
  }
  if (doc.yesterday.some((item) => PATH.test(item))) {
    issues.push("remove file paths from Yesterday");
  }
  const todayText = doc.today.map((theme) => theme.summary.toLowerCase()).join(" ");
  for (const item of doc.yesterday) {
    const text = item.toLowerCase();
    if (text.length > 12 && todayText.includes(text)) {
      issues.push("do not repeat Today items in Yesterday");
      break;
    }
  }

  const tags = new Set(doc.today.map((theme) => theme.tag));
  if (tags.size === 1 && (tags.has("chore") || tags.has("docs"))) {
    issues.push("lead with product work, not merge/chore work");
  }
  if (doc.today.every((theme) => /merge|origin\/main|dependency/i.test(theme.title))) {
    issues.push("replace merge/housekeeping bullets with the actual product work");
  }

  const activity = JSON.stringify(ctx ?? {});
  const deployClaim = doc.today.some((theme) => /\bdeploy(ed|ment)?\b/i.test(theme.summary));
  if (deployClaim && !/\bdeploy/i.test(activity)) {
    issues.push("remove the deployment claim unless the activity proves a deploy");
  }

  const score = Math.max(0, Math.min(100, 100 - issues.length * 12));
  return { score, issues };
}
