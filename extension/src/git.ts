import * as vscode from "vscode";
import { Commit } from "./types";
import { collectCommitsFromFolders } from "./core/gather/git";

export { repoSlug } from "./core/gather/git";

// Commits authored by the local git user across all workspace git repos,
// within [since, until]. The pure implementation lives in core/gather/git.ts.
export async function collectCommits(since: Date, until: Date, signal?: AbortSignal): Promise<Commit[]> {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    name: f.name,
    path: f.uri.fsPath,
  }));
  return collectCommitsFromFolders(folders, since, until, signal);
}
