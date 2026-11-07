// Pure GitHub gathering. The VS Code adapter resolves the token (explicit
// setting or built-in auth) and passes folder refs; the agent passes its token
// and workspace paths. No VS Code imports belong here.
import { GitHubItem } from "../types";
import { FolderRef, repoSlug } from "./git";

const API = "https://api.github.com";

interface SearchItem {
  number: number;
  title: string;
  html_url: string;
  closed_at: string;
  pull_request?: unknown;
}

async function gh(
  path: string,
  token: string,
  signal?: AbortSignal,
  userAgent = "shiplogue",
): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": userAgent,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ${res.statusText} for ${path}`);
  }
  return res.json();
}

async function resolveRepos(
  configured: string[],
  folders: readonly FolderRef[],
  signal?: AbortSignal,
): Promise<string[]> {
  if (configured.length > 0) {
    return configured;
  }
  const slugs = new Set<string>();
  for (const folder of folders) {
    const slug = await repoSlug(folder.path, signal);
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
  folders: readonly FolderRef[] = [],
  userAgent = "shiplogue",
): Promise<GitHubItem[]> {
  if (!token) {
    return [];
  }
  try {
    const me = await gh("/user", token, signal, userAgent);
    const login: string = me.login;
    const repos = await resolveRepos(configuredRepos, folders, signal);
    if (repos.length === 0) {
      return [];
    }

    const day = since.toISOString().slice(0, 10); // YYYY-MM-DD
    const out: GitHubItem[] = [];

    for (const repo of repos) {
      const queries: Array<{ kind: "pr" | "issue"; q: string }> = [
        {
          kind: "pr",
          q: `repo:${repo} is:pr is:merged author:${login} merged:>=${day}`,
        },
        {
          kind: "issue",
          q: `repo:${repo} is:issue is:closed assignee:${login} closed:>=${day}`,
        },
      ];
      for (const { kind, q } of queries) {
        try {
          const data = await gh(
            `/search/issues?q=${encodeURIComponent(q)}&per_page=30`,
            token,
            signal,
            userAgent,
          );
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
