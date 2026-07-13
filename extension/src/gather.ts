import * as vscode from "vscode";
import { Store } from "./store";
import { cfg } from "./config";
import { collectCommits } from "./git";
import { collectGitHub, githubToken } from "./github";
import { collectCursorPrompts } from "./cursor";
import { ActivityEvent, FileTouch, StandupContext } from "./types";

function aggregateTouches(events: ActivityEvent[]): FileTouch[] {
  const map = new Map<string, FileTouch>();
  for (const ev of events) {
    const key = `${ev.project}::${ev.file}`;
    const t = map.get(key) ?? {
      file: ev.file,
      project: ev.project,
      lang: ev.lang,
      saves: 0,
      edits: 0,
      lastTs: ev.ts,
    };
    if (ev.type === "save") {
      t.saves++;
    } else {
      t.edits++;
    }
    if (ev.ts > t.lastTs) {
      t.lastTs = ev.ts;
    }
    map.set(key, t);
  }
  // Most-touched first.
  return [...map.values()].sort(
    (a, b) => b.saves + b.edits - (a.saves + a.edits),
  );
}

// Pull together everything for the stand-up window. With scope="workspace"
// (the default), only activity belonging to the folders open in THIS window is
// included — tracked file touches and Cursor prompts from other projects are
// filtered out. Git commits and GitHub repos are already per-workspace.
export async function gatherContext(store: Store): Promise<StandupContext> {
  const c = cfg();
  const until = new Date();
  const since = new Date(until.getTime() - c.lookbackHours * 3600_000);

  const folders = vscode.workspace.workspaceFolders ?? [];
  const scoped = c.scope === "workspace";
  const folderPaths = scoped ? folders.map((f) => f.uri.fsPath) : null;
  const folderNames = new Set(folders.map((f) => f.name));

  const token = await githubToken(false);
  const [commits, github, cursorPrompts] = await Promise.all([
    collectCommits(since, until),
    collectGitHub(token, c.githubRepos, since),
    c.cursorEnabled ? collectCursorPrompts(since, until, folderPaths) : Promise.resolve([]),
  ]);

  let events = store.readRange(since, until);
  if (scoped) {
    events = events.filter((ev) => folderNames.has(ev.project));
  }
  const touches = aggregateTouches(events);

  return { since, until, commits, touches, github, cursorPrompts };
}

// Render the gathered context as a text block for the model / debug view.
// The detail level scales the INPUT, not just the instructions: elaborate gets
// per-commit file lists and bodies (so it can name pages and what changed in
// each), concise gets subjects only. A model can't enumerate what it isn't given.
export function contextToText(ctx: StandupContext): string {
  const detail = cfg().detail;
  const perCommitFiles = detail === "elaborate" ? 15 : detail === "standard" ? 6 : 0;
  const bodyChars = detail === "elaborate" ? 400 : detail === "standard" ? 200 : 0;
  const touchCap = detail === "elaborate" ? 25 : detail === "standard" ? 12 : 5;
  const lines: string[] = [];

  if (ctx.commits.length) {
    lines.push("## Git commits");
    for (const cm of ctx.commits) {
      const body =
        bodyChars && cm.body ? ` — ${cm.body.replace(/\s+/g, " ").slice(0, bodyChars)}` : "";
      lines.push(`- [${cm.repo}] ${cm.subject}${body}`);
      if (perCommitFiles && cm.files.length) {
        const shown = cm.files.slice(0, perCommitFiles);
        const more = cm.files.length - shown.length;
        lines.push(`  files: ${shown.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`);
      }
    }
    lines.push("");
  }

  if (ctx.github.length) {
    lines.push("## GitHub");
    for (const g of ctx.github) {
      const tag = g.kind === "pr" ? "merged PR" : "closed issue";
      lines.push(`- [${g.repo}] ${tag} #${g.number}: ${g.title}`);
    }
    lines.push("");
  }

  if (ctx.cursorPrompts.length) {
    lines.push("## AI prompts I gave my assistant today (shows intent / in-progress work)");
    for (const p of ctx.cursorPrompts) {
      lines.push(`- ${p.text}`);
    }
    lines.push("");
  }

  if (ctx.touches.length) {
    lines.push("## Files worked on (not necessarily committed)");
    for (const t of ctx.touches.slice(0, touchCap)) {
      lines.push(`- [${t.project}] ${t.file} (${t.lang}, ${t.saves} saves)`);
    }
    lines.push("");
  }

  if (lines.length === 0) {
    lines.push("(No tracked activity in this window.)");
  }
  return lines.join("\n");
}
