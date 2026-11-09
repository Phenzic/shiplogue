import { getFormatSections, type SectionKey } from "./formatProfile";

export const STANDUP_TAGS = [
  "feature",
  "fix",
  "debug",
  "security",
  "docs",
  "refactor",
  "test",
  "performance",
  "chore",
] as const;

export type StandupTag = (typeof STANDUP_TAGS)[number];

export type StandupTheme = {
  title: string;
  tag: StandupTag;
  summary: string;
  details: string[];
  files: string[];
};

export type StandupDocument = {
  greeting: string;
  headline: string;
  labels?: Partial<Record<SectionKey, string>>;
  yesterday: string[];
  today: StandupTheme[];
  next: string[];
  blockers: string[];
};

const TAGS = new Set<string>(STANDUP_TAGS);
const PATH = /[\w@][\w.\/-]*\.\w{1,6}/;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
}

function tagOf(raw: string): StandupTag {
  const value = raw.trim().toLowerCase().replace(/[`"'[\]]/g, "");
  if (value === "bug") return "fix";
  if (value === "perf") return "performance";
  return TAGS.has(value) ? (value as StandupTag) : "chore";
}

function isFile(value: string): boolean {
  return PATH.test(value) && !/\s/.test(value) && !/^https?:\/\//i.test(value);
}

/**
 * Parse the theme-first Markdown contract into the canonical document.
 * Returns undefined when the model used the old flat format, so callers can
 * keep the previous formatter as a compatibility fallback.
 */
export function parseStandupDocument(markdown: string): StandupDocument | undefined {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const labels = new Map<string, SectionKey>();
  for (const section of getFormatSections()) {
    labels.set(section.label.trim().toLowerCase(), section.key);
  }

  let greeting = "";
  let section: SectionKey | undefined;
  let headlineParts: string[] = [];
  let currentTheme: StandupTheme | undefined;
  const doc: StandupDocument = {
    greeting: "",
    headline: "",
    labels: Object.fromEntries(
      getFormatSections().map((section) => [section.key, section.label]),
    ) as Partial<Record<SectionKey, string>>,
    yesterday: [],
    today: [],
    next: [],
    blockers: [],
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.trim().match(/^\*\*(.+?)\*\*$/);
    if (heading) {
      const key = labels.get(heading[1].trim().toLowerCase());
      if (key) {
        section = key;
        currentTheme = undefined;
        continue;
      }
    }

    if (!section) {
      const text = line.trim();
      if (!text) continue;
      // Theme-first headers before Today are malformed model output, not a
      // headline. Never leak them into copied Markdown.
      if (/^###\s+/.test(text)) continue;
      if (/^hey team\b/i.test(text) && !greeting) {
        greeting = text;
      } else {
        headlineParts.push(text);
      }
      continue;
    }

    if (section === "today") {
      const theme = line.trim().match(/^###\s+(.+?)\s+\[([^\]]+)\]\s*$/);
      if (theme) {
        const title = clean(theme[1]);
        // Some models emit the tag as the heading ("### feature [chore]").
        // Prefer that explicit tag instead of defaulting everything to chore.
        const titleTag = title.toLowerCase();
        currentTheme = {
          title,
          tag: TAGS.has(titleTag) ? (titleTag as StandupTag) : tagOf(theme[2]),
          summary: "",
          details: [],
          files: [],
        };
        doc.today.push(currentTheme);
        continue;
      }
      if (!currentTheme) continue;

      const sub = line.match(/^\s{2,}[-*•]\s+(.+)$/);
      if (sub) {
        const text = clean(sub[1]);
        if (!text) continue;
        if (isFile(text)) currentTheme.files.push(text);
        else currentTheme.details.push(text);
        continue;
      }
      const bullet = line.match(/^[-*•]\s+(.+)$/);
      if (bullet) {
        const text = clean(bullet[1]);
        if (!currentTheme.summary) currentTheme.summary = text;
        else currentTheme.details.push(text);
        continue;
      }
      if (line.trim() && !currentTheme.summary) {
        currentTheme.summary = clean(line);
      }
      continue;
    }

    if (section === "yesterday" || section === "next" || section === "blockers") {
      const bullet = line.match(/^[-*•]\s+(.+)$/);
      if (!bullet) continue;
      const text = clean(bullet[1]);
      if (text) doc[section].push(text);
    }
  }

  doc.greeting = greeting || "Hey team, here's what I worked on today:";
  doc.headline = clean(headlineParts.join(" "));
  if (doc.today.length === 0) return undefined;
  if (doc.today.some((theme) => !theme.title || !theme.summary)) return undefined;
  return doc;
}

/** Render the clean story Markdown. File/detail metadata stays in the document. */
/** Copy-friendly rendering: Today is a list, never a tag heading. */
export function renderStandupCopy(doc: StandupDocument): string {
  const sections = getFormatSections();
  const label = (key: SectionKey, fallback: string) =>
    doc.labels?.[key] ?? sections.find((section) => section.key === key)?.label ?? fallback;
  const lines: string[] = [doc.greeting, "", doc.headline, ""];
  lines.push(`**${label("yesterday", "Yesterday")}**`);
  for (const item of doc.yesterday.length ? doc.yesterday : ["None"]) lines.push(`- ${item}`);
  lines.push("");
  const themes = doc.today.filter((theme) => !/^no activity yet$/i.test(theme.title.trim()));
  if (themes.length > 0) {
    lines.push(`**${label("today", "Today")}**`);
    for (const theme of themes) {
      const tag = theme.tag && theme.tag !== "chore" ? ` [${theme.tag}]` : "";
      lines.push(`- ${theme.summary}${tag}`);
      for (const detail of theme.details) lines.push(`  - ${detail}`);
      for (const file of theme.files) lines.push(`  - ${file}`);
    }
    lines.push("");
  }
  lines.push(`**${label("next", "Next")}**`);
  for (const item of doc.next.length ? doc.next : ["None"]) lines.push(`- ${item}`);
  lines.push("");
  lines.push(`**${label("blockers", "Blockers")}**`);
  for (const item of doc.blockers.length ? doc.blockers : ["None"]) lines.push(`- ${item}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function renderStandupDocument(doc: StandupDocument): string {
  const sections = getFormatSections();
  const label = (key: SectionKey, fallback: string) =>
    doc.labels?.[key] ?? sections.find((section) => section.key === key)?.label ?? fallback;

  const lines: string[] = [doc.greeting, "", doc.headline, ""];
  lines.push(`**${label("yesterday", "Yesterday")}**`);
  for (const item of doc.yesterday) lines.push(`- ${item}`);
  lines.push("");
  lines.push(`**${label("today", "Today")}**`);
  lines.push("");
  for (const theme of doc.today) {
    lines.push(`### ${theme.title} [${theme.tag}]`);
    lines.push(theme.summary);
    lines.push("");
  }
  lines.push(`**${label("next", "Next")}**`);
  for (const item of doc.next.length ? doc.next : ["None"]) lines.push(`- ${item}`);
  lines.push("");
  lines.push(`**${label("blockers", "Blockers")}**`);
  for (const item of doc.blockers.length ? doc.blockers : ["None"]) lines.push(`- ${item}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}
