// Local draft artifacts. `save_standup` (agent-authored markdown) lands here;
// revisions are kept by metadata, and the Markdown file is the copyable draft.
import * as fs from "fs";
import * as path from "path";
import {
  buildReferences,
  enforceSublists,
  getFormatSections,
  limitSectionBullets,
  parseStandupDocument,
  renderStandupDocument,
  scoreStandupDocument,
  toPlainText,
  verifyClaims,
  type StandupContext,
  type StandupDocument,
  type StandupQuality,
  type Verification,
} from "../core";
import { draftsDir } from "../config";
import { dayKey } from "../events/store";

export interface DraftMetadata {
  date: string;
  revision: number;
  updatedAt: string;
  source?: string;
  backend?: string;
  warnings?: string[];
  quality?: StandupQuality;
}

export interface DraftRecord extends DraftMetadata {
  markdown: string;
  plainText: string;
}

export interface FinalizeResult {
  markdown: string;
  plainText: string;
  document?: StandupDocument;
  quality: StandupQuality;
  verification: Verification;
  warnings: string[];
}

export function draftPath(date: string): string {
  return path.join(draftsDir(), `${date}.md`);
}

export function metadataPath(date: string): string {
  return path.join(draftsDir(), `${date}.json`);
}

function readMetadata(date: string): DraftMetadata | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath(date), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as DraftMetadata) : undefined;
  } catch {
    return undefined;
  }
}

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Deterministic finalization shared by save_standup and the CLI. */
export function finalizeDraft(
  input: string,
  ctx: StandupContext,
): FinalizeResult {
  const formatted = enforceSublists(input);
  const verification = verifyClaims(formatted, ctx);
  const document = parseStandupDocument(verification.cleanDraft);
  const quality: StandupQuality = document
    ? scoreStandupDocument(document, ctx)
    : {
        score: 0,
        issues: ["Use the required theme format: ### Theme title [tag] under Today."],
      };
  const yesterdayLabel =
    getFormatSections().find((section) => section.key === "yesterday")?.label ??
    "Yesterday";
  const body = document
    ? renderStandupDocument(document)
    : limitSectionBullets(verification.cleanDraft, [yesterdayLabel], 4);
  const references = buildReferences(ctx);
  const markdown = references ? `${body}\n${references}` : body;

  const warnings: string[] = [];
  if (verification.removed.length > 0) {
    warnings.push(
      `⚠ Removed ${verification.removed.length} unverifiable mention(s): ${[
        ...new Set(verification.removed),
      ].join(", ")}`,
    );
  }
  const unsupported = verification.violations.filter(
    (violation) => violation.kind === "completion",
  ).length;
  if (verification.needsReview && unsupported > 0) {
    warnings.push(`⚠ ${unsupported} completion claim(s) need review before sending`);
  }

  return {
    markdown,
    plainText: toPlainText(markdown),
    document,
    quality,
    verification,
    warnings,
  };
}

export function saveDraft(
  markdown: string,
  options: {
    date?: string;
    source?: string;
    backend?: string;
    warnings?: string[];
    quality?: StandupQuality;
    plainText?: string;
  } = {},
): DraftRecord {
  const date = options.date ?? dayKey(new Date());
  const previous = readMetadata(date);
  const revision = (previous?.revision ?? 0) + 1;
  const updatedAt = new Date().toISOString();
  const plainText = options.plainText ?? toPlainText(markdown);
  writeAtomic(draftPath(date), markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  const metadata: DraftMetadata = {
    date,
    revision,
    updatedAt,
    source: options.source ?? "agent",
    ...(options.backend ? { backend: options.backend } : {}),
    ...(options.warnings?.length ? { warnings: options.warnings } : {}),
    ...(options.quality ? { quality: options.quality } : {}),
  };
  writeAtomic(metadataPath(date), `${JSON.stringify(metadata, null, 2)}\n`);
  return { ...metadata, markdown, plainText };
}

export function loadDraft(date?: string): DraftRecord | undefined {
  const key = date ?? latestDraftDate();
  if (!key) return undefined;
  try {
    const markdown = fs.readFileSync(draftPath(key), "utf8");
    const metadata = readMetadata(key) ?? {
      date: key,
      revision: 1,
      updatedAt: fs.statSync(draftPath(key)).mtime.toISOString(),
      source: "agent",
    };
    return { ...metadata, markdown, plainText: toPlainText(markdown) };
  } catch {
    return undefined;
  }
}

export function latestDraftDate(): string | undefined {
  try {
    const dates = fs
      .readdirSync(draftsDir())
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
      .map((file) => file.slice(0, 10))
      .sort()
      .reverse();
    return dates[0];
  } catch {
    return undefined;
  }
}

export function listDrafts(limit = 14): DraftRecord[] {
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(draftsDir())
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
      .sort()
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
  return files
    .map((file) => loadDraft(file.slice(0, 10)))
    .filter((draft): draft is DraftRecord => Boolean(draft));
}

/**
 * Replace or append one semantic section. Used by revise_standup; the labels
 * come from the active built-in/cloud format.
 */
export function reviseSection(
  markdown: string,
  section: "yesterday" | "today" | "next" | "blockers",
  text: string,
  mode: "replace" | "append" = "replace",
): string {
  const label =
    getFormatSections().find((item) => item.key === section)?.label ??
    section.charAt(0).toUpperCase() + section.slice(1);
  const lines = markdown.split("\n");
  const heading = `**${label}**`;
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) {
    return `${markdown.trimEnd()}\n\n${heading}\n${text.trim()}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\*\*.+\*\*$/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  const existing = lines.slice(start + 1, end);
  const next =
    mode === "append"
      ? [...existing.filter((line) => line.trim()), ...text.split("\n")]
      : text.split("\n");
  return [
    ...lines.slice(0, start + 1),
    ...next,
    ...lines.slice(end),
  ].join("\n");
}
