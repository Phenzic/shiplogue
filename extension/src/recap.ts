import { StandupRecord, localDateKey } from "./standupStore";
import { unionSources, type SourceId } from "./sources";

export interface WeeklyRecap {
  title: string;
  markdown: string;
  sources: SourceId[];
  projects: string[];
  range: string;
  summary: { commits: number; files: number; github: number; notes?: string[] };
}

function doneBullets(markdown: string): string[] {
  const lines = markdown.split("\n");
  const bullets: string[] = [];
  let inDone = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\*\*(Done|Yesterday)\*\*$/i.test(line.trim())) {
      inDone = true;
      continue;
    }
    if (/^\*\*(Next|Today|Blockers|References)\*\*/i.test(line.trim())) {
      if (inDone) break;
      continue;
    }
    if (inDone && /^-\s+/.test(line)) {
      const text = line.replace(/^-\s+/, "").replace(/\s*\(inferred\)\s*$/i, "").trim();
      if (text) bullets.push(text);
    }
  }

  if (bullets.length > 0) return bullets;

  // Older/local drafts may not use the standard heading. Fall back to the
  // top-level bullets before any references section.
  let fallback = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\*\*References\*\*/i.test(line.trim())) break;
    if (/^-\s+/.test(line)) {
      fallback = true;
      const text = line.replace(/^-\s+/, "").trim();
      if (text && !/^\[.*\]\(.*\)$/.test(text)) bullets.push(text);
    }
  }
  return fallback ? bullets : [];
}

function cleanBullet(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function rangeLabel(records: StandupRecord[]): string {
  const dates = records.map((record) => record.date).sort();
  const start = dates[0];
  const end = dates[dates.length - 1];
  if (!start || !end) return "";
  if (start === end) return start;
  return `${start} – ${end}`;
}

/**
 * Compile the stored daily drafts into a weekly recap. This is deliberately
 * static: no model call, no commits, no filesystem scan, no new activity
 * collection. The daily drafts are the source of truth.
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

  const byProject = new Map<string, string[]>();
  const seen = new Set<string>();
  let bulletCount = 0;
  for (const record of recent) {
    const project = record.projectName?.trim() || "Workspace";
    for (const raw of doneBullets(record.markdown)) {
      const text = cleanBullet(raw);
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      const bucket = byProject.get(project) ?? [];
      bucket.push(text);
      byProject.set(project, bucket);
      bulletCount++;
    }
  }

  if (bulletCount === 0) return undefined;

  const projects = [...byProject.keys()].sort((a, b) => a.localeCompare(b));
  const sources = unionSources(recent.map((record) => record.sources));
  const range = rangeLabel(recent);
  const lines: string[] = [
    `# Weekly recap`,
    "",
    `**${range}**`,
    "",
    "**What I shipped**",
  ];

  for (const project of projects) {
    if (projects.length > 1) lines.push("", `### ${project}`);
    for (const bullet of byProject.get(project) ?? []) {
      lines.push(`- ${bullet}`);
    }
  }

  return {
    title: `Weekly recap · ${range}`,
    markdown: lines.join("\n"),
    sources,
    projects,
    range,
    summary: {
      commits: 0,
      files: 0,
      github: 0,
      notes: [`Compiled from ${recent.length} daily draft${recent.length === 1 ? "" : "s"}`],
    },
  };
}
