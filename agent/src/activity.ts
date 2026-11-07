// Agent-side activity gather. Reuses the shared core for git/GitHub/IDE input
// and layers the agent event store on top. No VS Code imports.
import * as path from "path";
import { AgentEvent } from "./types";
import {
  aggregateTouches,
  capActivity,
  collectAllPrompts,
  collectCommits,
  collectDiffStats,
  collectGitHub,
  collectUncommittedFiles,
  normalizeFolderPath,
  sanitizeUntrusted,
  summarizeAgentSessions,
  type ActivityEvent,
  type CursorPrompt,
  type FolderRef,
  type StandupContext,
} from "./core";
import { EventStore, dayKey } from "./events/store";
import { eventsDir, loadConfig } from "./config";
import { workspaceIdFor } from "./events/dedupe";

export interface ActivityOptions {
  lookbackHours?: number;
  repoPath?: string;
  includeGitHub?: boolean;
  includeIdePrompts?: boolean;
  signal?: AbortSignal;
}

export interface ActivityStats {
  workspaceRoot: string;
  since: string;
  until: string;
  events: number;
  sessions: number;
  prompts: number;
  responses: number;
  toolCalls: number;
  shells: number;
  fileEdits: number;
  fileReads: number;
  filesTouched: number;
  commits: number;
  commitFiles: number;
  uncommittedFiles: number;
  diff: { additions: number; deletions: number };
  github: { prs: number; issues: number };
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
    costUsd: number;
  };
  bySource: Record<string, number>;
}

export interface ActivityResult {
  context: StandupContext;
  stats: ActivityStats;
  events: AgentEvent[];
}

function languageOf(file: string): string {
  const ext = path.extname(file).slice(1);
  return ext || "text";
}

function eventTouches(events: AgentEvent[], root: string): ActivityEvent[] {
  const project = path.basename(root);
  return events
    .filter((e) => (e.kind === "file_edit" || e.kind === "file_read") && e.file)
    .map((e) => ({
      ts: e.ts,
      type: e.kind === "file_edit" ? ("edit" as const) : ("save" as const),
      file: e.file ?? "",
      lang: languageOf(e.file ?? ""),
      project,
      projectPath: root,
    }));
}

function promptEvents(events: AgentEvent[]) {
  return events
    .filter((e) => (e.kind === "prompt" || e.kind === "response") && e.text)
    .map((e) => ({
      ts: e.ts,
      text: e.text ?? "",
      source: e.source,
    }));
}

function tokenStats(events: AgentEvent[]): ActivityStats["tokens"] {
  const out = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0 };
  for (const event of events) {
    const meta = event.meta ?? {};
    out.input += Number(meta.input_tokens ?? 0) || 0;
    out.output += Number(meta.output_tokens ?? 0) || 0;
    out.cacheRead += Number(meta.cache_read_tokens ?? 0) || 0;
    out.cacheWrite += Number(meta.cache_write_tokens ?? 0) || 0;
    out.total += Number(meta.total_tokens ?? 0) || 0;
    out.costUsd += Number(meta.cost_usd ?? 0) || 0;
  }
  if (out.total === 0) out.total = out.input + out.output;
  return out;
}

function mergePrompts(
  agentPrompts: Array<{ ts: string; text: string; source?: string }>,
  idePrompts: Array<{ ts: string; text: string; source?: string }>,
) {
  const seen = new Set<string>();
  const out: Array<{ ts: string; text: string; source?: string }> = [];
  for (const prompt of [...agentPrompts, ...idePrompts]) {
    const key = `${prompt.ts.slice(0, 16)}|${prompt.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...prompt, text: sanitizeUntrusted(prompt.text) });
  }
  return out.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 80);
}

/**
 * Gather the activity window for the agent. Calendar-day vs lookback is the
 * caller's choice; the default matches the extension's 24h lookback for CLI use.
 */
export async function gatherActivity(
  options: ActivityOptions = {},
): Promise<ActivityResult> {
  const config = loadConfig();
  const root = path.resolve(options.repoPath ?? process.cwd());
  const folders: FolderRef[] = [{ name: path.basename(root), path: root }];
  const until = new Date();
  const since = new Date(
    until.getTime() - (options.lookbackHours ?? config.lookbackHours) * 3600_000,
  );
  const store = new EventStore(eventsDir());
  const workspaceId = workspaceIdFor(root);
  const allEvents = store.readRange(since, until);
  const events = allEvents.filter(
    (event) =>
      event.workspaceId === workspaceId ||
      normalizeFolderPath(event.workspaceRoot) === normalizeFolderPath(root),
  );

  const [commits, uncommittedFiles, diff, idePrompts] = await Promise.all([
    collectCommits(folders, since, until, options.signal),
    collectUncommittedFiles(folders, options.signal),
    collectDiffStats(folders, since, until, options.signal),
    (options.includeIdePrompts ?? process.env.SHIPLOGUE_IDE_PROMPTS !== "0")
      ? collectAllPrompts(since, until, [root], options.signal)
      : Promise.resolve([]),
  ]);

  let github: StandupContext["github"] = [];
  if (options.includeGitHub !== false && process.env.GITHUB_TOKEN) {
    const repos = (process.env.SHIPLOGUE_GITHUB_REPOS ?? "")
      .split(",")
      .map((repo) => repo.trim())
      .filter(Boolean);
    github = await collectGitHub(
      process.env.GITHUB_TOKEN,
      repos,
      since,
      options.signal,
      folders,
    );
  }

  const prompts = mergePrompts(promptEvents(events), idePrompts);
  const touches = aggregateTouches(eventTouches(events, root));
  const context = capActivity({
    since,
    until,
    commits: commits.map((commit) => ({
      ...commit,
      subject: sanitizeUntrusted(commit.subject),
      body: sanitizeUntrusted(commit.body),
    })),
    touches,
    github: github.map((item) => ({
      ...item,
      title: sanitizeUntrusted(item.title),
    })),
    cursorPrompts: prompts as CursorPrompt[],
    agentSessions: summarizeAgentSessions(prompts),
    uncommittedFiles,
    diffStats: diff,
  });

  const bySource: Record<string, number> = {};
  for (const event of events) {
    bySource[event.source] = (bySource[event.source] ?? 0) + 1;
  }
  const sessions = new Set(
    events
      .map((event) => event.sessionId)
      .filter((value): value is string => Boolean(value)),
  );
  const stats: ActivityStats = {
    workspaceRoot: root,
    since: since.toISOString(),
    until: until.toISOString(),
    events: events.length,
    sessions: sessions.size,
    prompts: prompts.length,
    responses: events.filter((event) => event.kind === "response").length,
    toolCalls:
      events.filter((event) => event.kind === "tool_call").length +
      events.filter((event) => event.kind === "tool_result").length,
    shells: events.filter((event) => event.kind === "shell").length,
    fileEdits: events.filter((event) => event.kind === "file_edit").length,
    fileReads: events.filter((event) => event.kind === "file_read").length,
    filesTouched: touches.length,
    commits: commits.length,
    commitFiles: new Set(commits.flatMap((commit) => commit.files)).size,
    uncommittedFiles: uncommittedFiles.length,
    diff,
    github: {
      prs: github.filter((item) => item.kind === "pr").length,
      issues: github.filter((item) => item.kind === "issue").length,
    },
    tokens: tokenStats(events),
    bySource,
  };

  store.pruneOld(config.retentionDays);
  return { context, stats, events };
}

export { dayKey };
