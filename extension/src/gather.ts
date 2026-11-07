import * as vscode from "vscode";
import { Store } from "./store";
import { cfg } from "./config";
import { collectCommits, collectDiffStats, collectUncommittedFiles } from "./git";
import { collectGitHub, githubToken } from "./github";
import { collectAllPrompts } from "./promptSources";
import { StandupContext } from "./types";
import { normalizeFolderPath } from "./paths";
import { sanitizeUntrusted } from "./format";
import {
  aggregateTouches,
  capActivity,
  contextToText as coreContextToText,
  summarizeAgentSessions,
} from "./core/gather/activity";

// Re-exported for existing extension consumers/tests. The implementation lives
// in core/gather/activity so the agent can use it without VS Code.
export { INPUT_CAPS, capActivity } from "./core/gather/activity";

export interface GatherOptions {
  // Cancels collection: child processes are killed and phases stop early.
  signal?: AbortSignal;
  // Reports which source is being collected so the panel can show progress.
  onPhase?: (label: string) => void;
  // Generate for one project instead of every folder open in the window.
  folder?: vscode.WorkspaceFolder;
  // Override the lookback window (weekly recap uses 168h).
  lookbackHours?: number;
}

// Pull together everything for the stand-up window. With scope="workspace"
// (the default), only activity belonging to the folders open in THIS window is
// included — tracked file touches and Cursor prompts from other projects are
// filtered out. Git commits and GitHub repos are already per-workspace.
export async function gatherContext(store: Store, opts: GatherOptions = {}): Promise<StandupContext> {
  const { signal, onPhase } = opts;
  const checkAborted = () => {
    if (signal?.aborted) {
      throw new DOMException("Gathering aborted", "AbortError");
    }
  };
  const c = cfg();
  const until = new Date();
  // Daily stand-ups use a fixed local calendar-day boundary. Explicit
  // lookbackHours is retained for debug/recap-style ranges.
  const since = opts.lookbackHours
    ? new Date(until.getTime() - opts.lookbackHours * 3600_000)
    : new Date(until.getFullYear(), until.getMonth(), until.getDate(), 0, 0, 0, 0);

  const folders = opts.folder ? [opts.folder] : vscode.workspace.workspaceFolders ?? [];
  // With no folder open, scoping to "this window" would match nothing — fall
  // back to the whole day and tell the user via the panel summary.
  const noFolder = c.scope === "workspace" && folders.length === 0 && !opts.folder;
  const scoped = Boolean(opts.folder) || (c.scope === "workspace" && !noFolder);
  const folderPaths = scoped ? folders.map((f) => f.uri.fsPath) : null;
  const folderNames = new Set(folders.map((f) => f.name));

  const token = await githubToken(false);
  // Sequential phases (not Promise.all) so the progress label actually says
  // which source is slow.
  onPhase?.("Gathering commits…");
  let commits = await collectCommits(since, until, signal, folders);
  const uncommittedFiles = await collectUncommittedFiles(signal, folders);
  const diffStats = await collectDiffStats(since, until, signal, folders);
  checkAborted();
  onPhase?.("Gathering GitHub activity…");
  let github = await collectGitHub(token, c.githubRepos, since, signal, folders);
  checkAborted();
  let cursorPrompts: Awaited<ReturnType<typeof collectAllPrompts>> = [];
  if (c.cursorEnabled) {
    onPhase?.("Gathering Cursor prompts…");
    cursorPrompts = await collectAllPrompts(since, until, folderPaths, signal);
    checkAborted();
  }

  // Sanitize untrusted text at the collection boundary: commit messages, issue
  // titles and AI prompts end up inside an LLM prompt verbatim.
  commits = commits.map((cm) => ({
    ...cm,
    subject: sanitizeUntrusted(cm.subject),
    body: sanitizeUntrusted(cm.body),
  }));
  github = github.map((g) => ({ ...g, title: sanitizeUntrusted(g.title) }));
  cursorPrompts = cursorPrompts.map((p) => ({ ...p, text: sanitizeUntrusted(p.text) }));

  let events = store.readRange(since, until);
  if (scoped) {
    const pathSet = new Set(folders.map((f) => normalizeFolderPath(f.uri.fsPath)));
    // New events carry the folder path so two same-named folders in different
    // windows stay separate; pre-0.1.0 events fall back to the folder name.
    // Normalize the event path too: logs written on Windows (or before the
    // tracker normalized paths) carry backslashes.
    events = events.filter((ev) =>
      ev.projectPath
        ? pathSet.has(normalizeFolderPath(ev.projectPath))
        : folderNames.has(ev.project),
    );
  }
  const touches = aggregateTouches(events);

  return capActivity({
    since,
    until,
    commits,
    touches,
    github,
    cursorPrompts,
    agentSessions: summarizeAgentSessions(cursorPrompts),
    uncommittedFiles,
    diffStats,
    ...(noFolder ? { noFolder: true } : {}),
  });
}

/**
 * Extension wrapper: the core renderer takes an explicit detail level, while
 * existing callers expect the current setting to be applied.
 */
export function contextToText(ctx: StandupContext): string {
  return coreContextToText(ctx, cfg().detail);
}
