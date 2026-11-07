// Minimal git helper for `shiplogue status`. A0 replaces this with the shared
// core gather/git module; until then the agent must not import extension code.
import { execFile } from "child_process";
import { promisify } from "util";

const pexec = promisify(execFile);

async function git(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
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

/**
 * Count commits authored by the local git user since `since` across the given
 * workspace folders. Best effort: non-repos and git failures count as zero.
 */
export async function countCommitsSince(
  folders: string[],
  since: Date,
  signal?: AbortSignal,
): Promise<number> {
  let total = 0;
  for (const cwd of folders) {
    if (!(await isRepo(cwd, signal))) continue;
    let author = "";
    try {
      author = (await git(cwd, ["config", "user.email"], signal)).trim();
    } catch {
      /* all authors */
    }
    const args = ["rev-list", "--count", `--since=${since.toISOString()}`];
    if (author) args.push(`--author=${author}`);
    args.push("HEAD");
    try {
      const out = await git(cwd, args, signal);
      const n = Number(out.trim());
      if (Number.isFinite(n)) total += n;
    } catch {
      /* no HEAD, shallow clone, or not a repo */
    }
  }
  return total;
}
