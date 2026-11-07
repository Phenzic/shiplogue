// VS Code adapter over the pure core git gather. The core owns parsing and
// privacy filtering; this file only maps workspace folders.
import * as vscode from "vscode";
import {
  FolderRef,
  collectCommits as coreCollectCommits,
  collectDiffStats as coreCollectDiffStats,
  collectUncommittedFiles as coreCollectUncommittedFiles,
} from "./core/gather/git";

export { repoSlug } from "./core/gather/git";

function folderRefs(
  workspaceFolders?: readonly vscode.WorkspaceFolder[],
): FolderRef[] {
  return (workspaceFolders ?? vscode.workspace.workspaceFolders ?? []).map(
    (folder) => ({ name: folder.name, path: folder.uri.fsPath }),
  );
}

// Commits authored by the local git user across all workspace git repos,
// within [since, until].
export function collectCommits(
  since: Date,
  until: Date,
  signal?: AbortSignal,
  workspaceFolders?: readonly vscode.WorkspaceFolder[],
) {
  return coreCollectCommits(folderRefs(workspaceFolders), since, until, signal);
}

/** Uncommitted paths only (no contents), local metadata for the coverage strip. */
export function collectUncommittedFiles(
  signal?: AbortSignal,
  workspaceFolders?: readonly vscode.WorkspaceFolder[],
) {
  return coreCollectUncommittedFiles(folderRefs(workspaceFolders), signal);
}

/** Local-only aggregate additions/deletions for coverage; no file contents. */
export function collectDiffStats(
  since: Date,
  until: Date,
  signal?: AbortSignal,
  workspaceFolders?: readonly vscode.WorkspaceFolder[],
) {
  return coreCollectDiffStats(
    folderRefs(workspaceFolders),
    since,
    until,
    signal,
  );
}
