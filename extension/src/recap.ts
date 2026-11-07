import { StandupRecord, localDateKey } from "./standupStore";
import { unionSources, type SourceId } from "./sources";
import { getFormatSections } from "./formatProfile";

export interface WeeklyRecap {
  title: string;
  markdown: string;
  sources: SourceId[];
  projects: string[];
  range: string;
  summary: { commits: number; files: number; github: number; notes?: string[] };
}

type RecapItem = { text: string; details: string[]; title?: string; tag?: string };

function shortFile(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

function cleanText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s*\(inferred\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.;]+$/, "")
    .trim();
}

// Read one section's top-level bullets and their indented details. Bullets may
// be "-", "*" or "•"; headings are the fixed "**Label**" form.
function sectionItems(markdown: string, labels: string[]): RecapItem[] {
  const wanted = new Set(labels.map((label) => label.trim().toLowerCase()));
  const items: RecapItem[] = [];
  let inSection = false;
  let current: RecapItem | undefined;

  for (const raw of markdown.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const heading = line.trim().match(/^\*\*(.+?)\*\*$/);
    if (heading) {
      if (inSection) break;
      if (wanted.has(heading[1].trim().toLowerCase())) inSection = true;
      continue;
    }
    if (!inSection) continue;

    const nested = line.match(/^\s{2,}[-*•]\s+(.+)$/);
    if (nested && current) {
      const detail = cleanText(nested[1]);
      if (detail) current.details.push(detail);
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      const text = cleanText(bullet[1]);
      if (text) {
        current = { text, details: [] };
        items.push(current);
      }
    }
  }
  return items;
}

function labelsFor(key: "today" | "yesterday" | "next" | "blockers", fallback: string[]): string[] {
  const label = getFormatSections().find((section) => section.key === key)?.label;
  return label ? [label, ...fallback] : fallback;
}

function rangeLabel(records: StandupRecord[]): string {
  const dates = records.map((record) => record.date).sort();
  const start = dates[0];
  const end = dates[dates.length - 1];
  if (!start || !end) return "";
  if (start === end) return start;
  return `${start} – ${end}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Compile stored daily drafts into a readable weekly story. Static: the daily
 * drafts are the source of truth; no new activity collection or model call.
 */
export function buildWeeklyRecap(
  records: StandupRecord[],
  now = new Date(),
): WeeklyRecap | undefined {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffKey = localDateKey(cutoff);
  const recent = records
    .filter((record) => record.date >= cutoffKey && record.date <= localDateKey(now))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (recent.length === 0) return undefined;

  const primaryLabels = labelsFor("today", ["Today", "Done"]);
  const yesterdayLabels = labelsFor("yesterday", ["Yesterday"]);
  const nextLabels = labelsFor("next", ["Next"]);
  const blockerLabels = labelsFor("blockers", ["Blockers"]);

  const byProject = new Map<string, RecapItem[]>();
  const seen = new Set<string>();
  let bulletCount = 0;

  for (const record of recent) {
    const project = record.projectName?.trim() || "Workspace";
    const items: RecapItem[] = record.document
      ? record.document.today.map((theme) => ({
          text: theme.summary,
          title: theme.title,
          tag: theme.tag,
          details: [...theme.details, ...theme.files.map(shortFile)],
        }))
      : sectionItems(record.markdown, primaryLabels);
    for (const item of items) {
      const key = (item.title ? `${item.title}: ` : "") + item.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = byProject.get(project) ?? [];
      bucket.push(item);
      byProject.set(project, bucket);
      bulletCount++;
    }
  }

  // Older drafts may predate the Today section; fall back to Yesterday.
  if (bulletCount === 0) {
    for (const record of recent) {
      const project = record.projectName?.trim() || "Workspace";
      for (const item of sectionItems(record.markdown, yesterdayLabels)) {
        const key = item.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const bucket = byProject.get(project) ?? [];
        bucket.push(item);
        byProject.set(project, bucket);
        bulletCount++;
      }
    }
  }

  if (bulletCount === 0) return undefined;

  const projects = [...byProject.keys()].sort((a, b) => a.localeCompare(b));
  const sources = unionSources(recent.map((record) => record.sources));
  const range = rangeLabel(recent);

  let commits = 0;
  let files = 0;
  let github = 0;
  let prs = 0;
  let issues = 0;
  let prompts = 0;
  let sessions = 0;
  for (const record of recent) {
    commits += record.summary?.commits ?? record.coverage?.git.commits ?? 0;
    files += record.summary?.files ?? record.coverage?.git.files ?? 0;
    github += record.summary?.github ?? record.coverage?.github.items ?? 0;
    prs += record.coverage?.github.prs ?? 0;
    issues += record.coverage?.github.issues ?? 0;
    prompts += record.coverage?.agents.prompts ?? 0;
    sessions += record.coverage?.agents.sessions ?? 0;
  }

  const latest = recent[recent.length - 1];
  const nextItems = (latest.document?.next ?? sectionItems(latest.markdown, nextLabels).map((item) => item.text))
    .filter((text) => !/^none\.?$/i.test(text));
  const blockers = (latest.document?.blockers ?? sectionItems(latest.markdown, blockerLabels).map((item) => item.text))
    .filter((text) => !/^none\.?$/i.test(text));

  const lines: string[] = ["# Weekly recap", "", `**${range}**`, "", "**Week at a glance**"];
  lines.push(
    `- ${plural(recent.length, "daily stand-up")} across ${plural(projects.length, "project")}`,
  );
  const countBits: string[] = [];
  if (commits) countBits.push(plural(commits, "commit"));
  if (files) countBits.push(`${plural(files, "file")} touched`);
  if (prs) countBits.push(plural(prs, "merged PR"));
  if (issues) countBits.push(plural(issues, "closed issue"));
  if (prs === 0 && issues === 0 && github) countBits.push(plural(github, "GitHub item"));
  if (prompts) countBits.push(plural(prompts, "AI prompt"));
  if (sessions) countBits.push(plural(sessions, "AI session"));
  if (countBits.length) lines.push(`- ${countBits.join(" · ")}`);
  if (sources.length) lines.push(`- Sources: ${sources.join(", ")}`);

  lines.push("", "**What I shipped**");
  for (const project of projects) {
    if (projects.length > 1) lines.push("", `### ${project}`);
    for (const item of byProject.get(project) ?? []) {
      const lead = item.title
        ? `**${item.title}**${item.tag ? ` [${item.tag}]` : ""} — `
        : "";
      lines.push(`- ${lead}${item.text}`);
      for (const detail of item.details) lines.push(`  - ${detail}`);
    }
  }

  if (nextItems.length || blockers.length) {
    lines.push("", "**Carrying forward**");
    for (const text of nextItems) lines.push(`- ${text}`);
    for (const text of blockers) lines.push(`- Blocked: ${text}`);
  }

  return {
    title: `Weekly recap · ${range}`,
    markdown: lines.join("\n"),
    sources,
    projects,
    range,
    summary: {
      commits,
      files,
      github,
      notes: [`Compiled from ${plural(recent.length, "daily draft")}`],
    },
  };
}
