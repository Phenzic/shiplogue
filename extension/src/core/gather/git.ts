// Pure git gathering. Callers supply folder references, so the extension and
// the agent share the same parsing without importing VS Code.
import { execFile } from "child_process";
import { promisify } from "util";
import { Commit } from "../types";
import { isPrivatePath } from "../ignore";

const pexec = promisify(execFile);

export interface FolderRef {
  name: string;
  path: string;
}

async function git(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  // `signal` kills the child process on cancel so git never lingers.
  const { stdout } = await pexec("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    signal,
  });
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
export async function repoSlug(
  cwd: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const url = (await git(cwd, ["remote", "get-url", "origin"], signal)).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
}

// Commits authored by the local git user across all supplied git repos,
// within [since, until].
export async function collectCommits(
  folders: readonly FolderRef[],
  since: Date,
  until: Date,
  signal?: AbortSignal,
): Promise<Commit[]> {
  const RS = "\x1e"; // record start
  const US = "\x1f"; // field sep
  const GS = "\x1d"; // header/files sep
  const out: Commit[] = [];

  for (const folder of folders) {
    const cwd = folder.path;
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
          .filter((f) => f && !isPrivatePath(f, cwd));
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
      console.error(`[shiplogue] git log failed in ${cwd}:`, e);
    }
  }
  return out;
}

/** Uncommitted paths only (no contents), local metadata for the coverage strip. */
export async function collectUncommittedFiles(
  folders: readonly FolderRef[],
  signal?: AbortSignal,
): Promise<string[]> {
  const out = new Set<string>();
  for (const folder of folders) {
    const cwd = folder.path;
    if (!(await isRepo(cwd, signal))) continue;
    try {
      const status = await git(cwd, ["status", "--porcelain"], signal);
      for (const line of status.split("\n")) {
        const file = line.slice(3).trim();
        if (file && !isPrivatePath(file, cwd)) {
          out.add(`${folder.name}/${file}`);
        }
      }
    } catch {
      /* status is best effort */
    }
  }
  return [...out];
}

/** Local-only aggregate additions/deletions for coverage; no file contents. */
export async function collectDiffStats(
  folders: readonly FolderRef[],
  since: Date,
  until: Date,
  signal?: AbortSignal,
): Promise<{ additions: number; deletions: number }> {
  let additions = 0;
  let deletions = 0;
  for (const folder of folders) {
    const cwd = folder.path;
    if (!(await isRepo(cwd, signal))) continue;
    let author = "";
    try {
      author = (await git(cwd, ["config", "user.email"], signal)).trim();
    } catch {
      /* all authors */
    }
    const args = [
      "log",
      "--numstat",
      `--since=${since.toISOString()}`,
      `--until=${until.toISOString()}`,
      "--pretty=format:",
    ];
    if (author) args.push(`--author=${author}`);
    try {
      const stdout = await git(cwd, args, signal);
      for (const line of stdout.split("\n")) {
        const [added, removed, file] = line.split("\t");
        if (!file || !/^\d+$/.test(added) || !/^\d+$/.test(removed)) continue;
        if (isPrivatePath(file, cwd)) continue;
        additions += Number(added);
        deletions += Number(removed);
      }
    } catch {
      /* stats are best effort */
    }
  }
  return { additions, deletions };
}
