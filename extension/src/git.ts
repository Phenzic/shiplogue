import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";
import { Commit } from "./types";

const pexec = promisify(execFile);

async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  // `signal` kills the child process on cancel so git never lingers.
  const { stdout } = await pexec("git", args, { cwd, maxBuffer: 10 * 1024 * 1024, signal });
  return stdout;
}

async function isRepo(cwd: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const out = await git(cwd, ["rev-parse", "--is-inside-work-tree"], signal);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

// owner/name parsed from `git remote get-url origin`, or null.
export async function repoSlug(cwd: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const url = (await git(cwd, ["remote", "get-url", "origin"], signal)).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
}

// Commits authored by the local git user across all workspace git repos,
// within [since, until].
export async function collectCommits(since: Date, until: Date, signal?: AbortSignal): Promise<Commit[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const RS = "\x1e"; // record start
  const US = "\x1f"; // field sep
  const GS = "\x1d"; // header/files sep
  const out: Commit[] = [];

  for (const folder of folders) {
    const cwd = folder.uri.fsPath;
    if (!(await isRepo(cwd, signal))) {
      continue;
    }

    let author = "";
    try {
      author = (await git(cwd, ["config", "user.email"], signal)).trim();
    } catch {
      /* no configured email — fall through to all commits */
    }

    const slug = (await repoSlug(cwd, signal)) ?? folder.name;
    // RS opens each record and GS closes the header, so the --name-only file
    // list that git prints after the header can be split off unambiguously.
    const args = [
      "log",
      "--name-only",
      `--since=${since.toISOString()}`,
      `--until=${until.toISOString()}`,
      `--pretty=format:${RS}%H${US}%aI${US}%s${US}%b${GS}`,
    ];
    if (author) {
      args.push(`--author=${author}`);
    }

    try {
      const stdout = await git(cwd, args, signal);
      for (const rec of stdout.split(RS)) {
        if (!rec.trim()) {
          continue;
        }
        const [header, filesBlob = ""] = rec.split(GS);
        const [hash, date, subject, body = ""] = header.split(US);
        if (!hash?.trim()) {
          continue;
        }
        const files = filesBlob
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean);
        out.push({
          hash: hash.trim().slice(0, 8),
          date: date ?? "",
          subject: subject ?? "",
          body: body.trim(),
          repo: slug,
          files,
        });
      }
    } catch (e) {
      console.error(`[standup] git log failed in ${cwd}:`, e);
    }
  }
  return out;
}
