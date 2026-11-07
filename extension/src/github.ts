// VS Code adapter over the pure core GitHub gather. Built-in auth and settings
// stay here; the core owns the API queries and mapping.
import * as vscode from "vscode";
import { GitHubItem } from "./types";
import { cfg } from "./config";
import {
  collectGitHub as coreCollectGitHub,
} from "./core/gather/github";
import { FolderRef } from "./core/gather/git";

// Resolves a GitHub token WITHOUT requiring a manual PAT: prefers an explicit
// token if the user set one, otherwise uses the editor's built-in GitHub
// sign-in (VS Code / Cursor). Pass interactive=true to trigger the login UI.
export async function githubToken(interactive = false): Promise<string> {
  const c = cfg();
  if (c.githubToken) {
    return c.githubToken;
  }
  if (!c.githubUseBuiltInAuth) {
    return "";
  }
  try {
    const session = await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: interactive,
      silent: !interactive,
    });
    return session?.accessToken ?? "";
  } catch {
    return "";
  }
}

function folderRefs(
  workspaceFolders?: readonly vscode.WorkspaceFolder[],
): FolderRef[] {
  return (workspaceFolders ?? vscode.workspace.workspaceFolders ?? []).map(
    (folder) => ({ name: folder.name, path: folder.uri.fsPath }),
  );
}

// Returns merged PRs (authored) and closed issues (assigned) for the user,
// since `since`. Empty array if no token or anything fails.
export function collectGitHub(
  token: string,
  configuredRepos: string[],
  since: Date,
  signal?: AbortSignal,
  workspaceFolders?: readonly vscode.WorkspaceFolder[],
): Promise<GitHubItem[]> {
  return coreCollectGitHub(
    token,
    configuredRepos,
    since,
    signal,
    folderRefs(workspaceFolders),
    "shiplogue-extension",
  );
}
