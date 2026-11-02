import * as vscode from "vscode";
import { GitHubItem } from "./types";
import { repoSlug } from "./git";
import { cfg } from "./config";
import { collectGitHub as collectGitHubCore } from "./core/gather/github";

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

async function resolveRepos(configured: string[], signal?: AbortSignal): Promise<string[]> {
  if (configured.length > 0) {
    return configured;
  }
  const slugs = new Set<string>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const slug = await repoSlug(folder.uri.fsPath, signal);
    if (slug) {
      slugs.add(slug);
    }
  }
  return [...slugs];
}

// Returns merged PRs (authored) and closed issues (assigned) for the user,
// since `since`. Empty array if no token or anything fails.
export async function collectGitHub(
  token: string,
  configuredRepos: string[],
  since: Date,
  signal?: AbortSignal,
): Promise<GitHubItem[]> {
  if (!token) {
    return [];
  }
  const repos = await resolveRepos(configuredRepos, signal);
  return collectGitHubCore(token, repos, since, signal);
}
