import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { CursorPrompt } from "./types";

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

async function sqliteJson(db: string, sql: string): Promise<any[]> {
  const { stdout } = await pexec(
    "sqlite3",
    ["-readonly", `file:${db}?immutable=1`, "-json", sql],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout.trim() ? JSON.parse(stdout) : [];
}

function fileUriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, "")).replace(/\/+$/, "");
}

// Composer-session ids that belong to the given workspace folders. Cursor keeps
// a per-workspace state.vscdb (workspaceStorage/<hash>/) whose composer.composerData
// lists the workspace's composer ids. Empty set if anything is missing.
async function composerIdsForWorkspaces(globalDb: string, folders: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  const wsRoot = path.join(path.dirname(path.dirname(globalDb)), "workspaceStorage");
  const wanted = new Set(folders.map((f) => f.replace(/\/+$/, "")));

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
): Promise<CursorPrompt[]> {
  const db = cursorDbPath();
  if (!db) {
    return [];
  }

  let allowed: Set<string> | null = null;
  if (workspaceFolders) {
    allowed = await composerIdsForWorkspaces(db, workspaceFolders);
    if (allowed.size === 0) {
      return [];
    }
  }

  const sql =
    "SELECT key, json_extract(value,'$.createdAt') AS ts, json_extract(value,'$.text') AS text " +
    "FROM cursorDiskKV " +
    "WHERE key LIKE 'bubbleId:%' " +
    "AND json_extract(value,'$.type')=1 " +
    "AND json_extract(value,'$.text') <> '' " +
    `AND json_extract(value,'$.createdAt') >= '${since.toISOString()}' ` +
    `AND json_extract(value,'$.createdAt') <= '${until.toISOString()}' ` +
    "ORDER BY ts DESC LIMIT 200";

  try {
    const rows = (await sqliteJson(db, sql)) as Array<{ key: string; ts: string; text: string }>;
    return rows
      .filter((r) => !allowed || allowed.has(r.key.split(":")[1] ?? ""))
      .slice(0, 60)
      .map((r) => ({ ts: r.ts, text: (r.text ?? "").replace(/\s+/g, " ").trim().slice(0, 280) }))
      .filter((p) => p.text.length > 0);
  } catch (e) {
    console.error("[standup] cursor prompt read failed:", e);
    return [];
  }
}
