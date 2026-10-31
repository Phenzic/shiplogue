import * as vscode from "vscode";
import { GitHubItem } from "./types";
import { repoSlug } from "./git";
import { cfg } from "./config";

const API = "https://api.github.com";

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

interface SearchItem {
  number: number;
  title: string;
  html_url: string;
  closed_at: string;
  pull_request?: unknown;
}

async function gh(path: string, token: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "shiplogue-extension",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ${res.statusText} for ${path}`);
  }
  return res.json();
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
  try {
    const me = await gh("/user", token, signal);
    const login: string = me.login;
    const repos = await resolveRepos(configuredRepos, signal);
    if (repos.length === 0) {
      return [];
    }

    const day = since.toISOString().slice(0, 10); // YYYY-MM-DD
    const out: GitHubItem[] = [];

    for (const repo of repos) {
      const queries: Array<{ kind: "pr" | "issue"; q: string }> = [
        { kind: "pr", q: `repo:${repo} is:pr is:merged author:${login} merged:>=${day}` },
        { kind: "issue", q: `repo:${repo} is:issue is:closed assignee:${login} closed:>=${day}` },
      ];
      for (const { kind, q } of queries) {
        try {
          const data = await gh(`/search/issues?q=${encodeURIComponent(q)}&per_page=30`, token, signal);
          for (const it of (data.items ?? []) as SearchItem[]) {
            out.push({
              kind,
              number: it.number,
              title: it.title,
              url: it.html_url,
              repo,
              closedAt: it.closed_at,
            });
          }
        } catch (e) {
          console.error(`[shiplogue] GitHub search failed (${q}):`, e);
        }
      }
    }
    return out;
  } catch (e) {
    console.error("[shiplogue] GitHub collection failed:", e);
    return [];
  }
}
