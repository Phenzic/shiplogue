import { GitHubItem } from "../types";

const API = "https://api.github.com";

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
      "User-Agent": "standup-extension",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ${res.statusText} for ${path}`);
  }
  return res.json();
}

// Returns merged PRs (authored) and closed issues (assigned) for the user,
// since `since`, across the given repos. Empty array on any failure. Pure core
// (A0): callers supply token + repo list.
export async function collectGitHub(
  token: string,
  repos: string[],
  since: Date,
  signal?: AbortSignal,
): Promise<GitHubItem[]> {
  if (!token) {
    return [];
  }
  try {
    const me = await gh("/user", token, signal);
    const login: string = me.login;
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
          console.error(`[standup] GitHub search failed (${q}):`, e);
        }
      }
    }
    return out;
  } catch (e) {
    console.error("[standup] GitHub collection failed:", e);
    return [];
  }
}
