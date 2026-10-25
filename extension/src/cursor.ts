import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { CursorPrompt } from "./types";
import { normalizeFolderPath } from "./paths";

const pexec = promisify(execFile);

// Cursor's local chat DB. Cursor is a VS Code fork; prompts live as "bubbles"
// in cursorDiskKV (type 1 = user prompt), keyed bubbleId:<composerId>:<uuid>.
// Read-only + immutable so a running Cursor is never affected.
function cursorDbPath(): string | null {
  const candidates = [
    path.join(os.homedir(), "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
    path.join(os.homedir(), ".config/Cursor/User/globalStorage/state.vscdb"),
    path.join(os.homedir(), "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

async function sqliteJson(db: string, sql: string, signal?: AbortSignal): Promise<any[]> {
  // `signal` kills the sqlite3 child process on cancel so it never lingers.
  const { stdout } = await pexec(
    "sqlite3",
    ["-readonly", `file:${db}?immutable=1`, "-json", sql],
    { maxBuffer: 32 * 1024 * 1024, signal },
  );
  return stdout.trim() ? JSON.parse(stdout) : [];
}

function fileUriToPath(uri: string): string {
  let p = decodeURIComponent(uri.replace(/^file:\/\//, ""));
  // Windows URIs look like file:///C:/x — drop the leading slash only when it
  // precedes a drive letter, never for POSIX paths.
  if (/^\/[A-Za-z]:/.test(p)) {
    p = p.slice(1);
  }
  return normalizeFolderPath(p);
}

// Module-scope cache for the workspace→composer-id scan: walking every
// workspaceStorage subdirectory on each generation is wasteful, and the result
// only changes when Cursor writes new workspace state (which bumps the
// directory mtime).
let composerCache: { key: string; ids: Set<string> } | null = null;

// Composer-session ids that belong to the given workspace folders. Cursor keeps
// a per-workspace state.vscdb (workspaceStorage/<hash>/) whose composer.composerData
// lists the workspace's composer ids. Empty set if anything is missing.
async function composerIdsForWorkspaces(globalDb: string, folders: string[], signal?: AbortSignal): Promise<Set<string>> {
  const wsRoot = path.join(path.dirname(path.dirname(globalDb)), "workspaceStorage");
  let mtime = 0;
  try {
    mtime = fs.statSync(wsRoot).mtimeMs;
  } catch {
    return new Set();
  }
  const key = `${globalDb}|${folders.join()}|${mtime}`;
  if (composerCache && composerCache.key === key) {
    return composerCache.ids;
  }
  const ids = await scanComposerIds(wsRoot, folders, signal);
  composerCache = { key, ids };
  return ids;
}

async function scanComposerIds(wsRoot: string, folders: string[], signal?: AbortSignal): Promise<Set<string>> {
  const ids = new Set<string>();
  const wanted = new Set(folders.map(normalizeFolderPath));

  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(wsRoot);
  } catch {
    return ids;
  }

  for (const dir of dirs) {
    let folderUri = "";
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(wsRoot, dir, "workspace.json"), "utf8"));
      folderUri = meta.folder ?? "";
    } catch {
      continue;
    }
    if (!folderUri.startsWith("file://") || !wanted.has(fileUriToPath(folderUri))) {
      continue;
    }
    try {
      const rows = await sqliteJson(
        path.join(wsRoot, dir, "state.vscdb"),
        "SELECT value FROM ItemTable WHERE key='composer.composerData';",
        signal,
      );
      if (rows.length === 0) {
        continue;
      }
      const data = JSON.parse(rows[0].value);
      for (const c of data.allComposers ?? []) {
        if (c.composerId) {
          ids.add(c.composerId);
        }
      }
      for (const id of [...(data.selectedComposerIds ?? []), ...(data.lastFocusedComposerIds ?? [])]) {
        ids.add(id);
      }
    } catch (e) {
      console.error("[standup] cursor workspace db read failed:", e);
    }
  }
  return ids;
}

// The user prompts issued to Cursor's AI within [since, until].
// workspaceFolders scopes prompts to those folders' chat sessions; pass null
// for all projects. If scoping is requested but no sessions can be attributed,
// returns [] — never leaks other projects' prompts. Never throws.
export async function collectCursorPrompts(
  since: Date,
  until: Date,
  workspaceFolders: string[] | null,
  signal?: AbortSignal,
): Promise<CursorPrompt[]> {
  const db = cursorDbPath();
  if (!db) {
    return [];
  }

  let allowed: Set<string> | null = null;
  if (workspaceFolders) {
    allowed = await composerIdsForWorkspaces(db, workspaceFolders, signal);
    if (allowed.size === 0) {
      return [];
    }
  }

  let sql =
    "SELECT key, json_extract(value,'$.createdAt') AS ts, json_extract(value,'$.text') AS text " +
    "FROM cursorDiskKV " +
    "WHERE key LIKE 'bubbleId:%' " +
    "AND json_extract(value,'$.type')=1 " +
    "AND json_extract(value,'$.text') <> '' " +
    `AND json_extract(value,'$.createdAt') >= '${since.toISOString()}' ` +
    `AND json_extract(value,'$.createdAt') <= '${until.toISOString()}' `;

  if (allowed) {
    // Filter INSIDE SQL, before the LIMIT: a global LIMIT 200 followed by
    // in-memory filtering drops a quiet workspace's prompts whenever >200
    // newer prompts exist elsewhere. LIKE chunks keep the statement a sane
    // size when a workspace has many composer sessions.
    const ids = [...allowed];
    const groups: string[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const group = ids
        .slice(i, i + 100)
        .map((id) => `key LIKE 'bubbleId:${id.replace(/'/g, "''")}:%'`)
        .join(" OR ");
      groups.push(`(${group})`);
    }
    sql += `AND (${groups.join(" OR ")}) `;
  }
  sql += `ORDER BY ts DESC LIMIT ${allowed ? 60 : 200}`;

  try {
    const rows = (await sqliteJson(db, sql, signal)) as Array<{ key: string; ts: string; text: string }>;
    return rows
      .slice(0, 60)
      .map((r) => ({ ts: r.ts, text: (r.text ?? "").replace(/\s+/g, " ").trim().slice(0, 280) }))
      .filter((p) => p.text.length > 0);
  } catch (e) {
    console.error("[standup] cursor prompt read failed:", e);
    return [];
  }
}
