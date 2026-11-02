// Shared data shapes used across the extension.

export interface ActivityEvent {
  ts: string; // ISO timestamp
  type: "save" | "edit";
  file: string; // workspace-relative path, "/"-normalized
  lang: string; // VS Code languageId
  project: string; // workspace folder name
  // Workspace folder fsPath, "/"-normalized. Recorded for new events so two
  // same-named folders in different windows don't leak into each other;
  // absent in logs written before 0.1.0 (those match by `project` name).
  projectPath?: string;
}

export interface Commit {
  hash: string;
  date: string; // ISO
  subject: string;
  body: string;
  repo: string;
  files: string[]; // paths changed in this commit
}

export interface GitHubItem {
  kind: "issue" | "pr";
  number: number;
  title: string;
  url: string;
  repo: string;
  closedAt: string;
}

export interface FileTouch {
  file: string;
  project: string;
  lang: string;
  saves: number;
  edits: number;
  lastTs: string;
}

export interface CursorPrompt {
  ts: string; // ISO
  text: string;
}

// Everything gathered for one stand-up generation.
export interface StandupContext {
  since: Date;
  until: Date;
  commits: Commit[];
  touches: FileTouch[];
  github: GitHubItem[];
  cursorPrompts: CursorPrompt[];
  // Pre-cap totals, present only when an input cap actually dropped items, so
  // the prompt and panel can say "showing N of M".
  truncated?: { commits?: number; cursorPrompts?: number; github?: number };
  // True when scope is "workspace" but no folder is open: gather behaved as
  // "all" and the panel should say so.
  noFolder?: boolean;
}
