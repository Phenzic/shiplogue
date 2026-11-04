import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CursorPrompt } from "./types";
import { collectCursorPrompts } from "./cursor";

// Prompt capture is not Cursor-only. Cursor uses its chat DB; VS Code,
// Antigravity and compatible forks persist chat sessions under
// User/{workspaceStorage/<hash>,globalStorage}/chatSessions as JSON/JSONL.
// This module reads those stores read-only and normalizes user prompts.

function appRoots(): Array<{ name: string; dir: string }> {
  const override = process.env.SHIPLOGUE_CHAT_ROOTS;
  if (override) {
    return override
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => ({ name: path.basename(dir), dir }));
  }
  const home = os.homedir();
  const names =
    process.platform === "darwin"
      ? ["Code", "Code - Insiders", "Antigravity", "VSCodium", "Windsurf"]
      : process.platform === "win32"
        ? ["Code", "Code - Insiders", "Antigravity", "VSCodium", "Windsurf"]
        : ["Code", "Code - Insiders", "Antigravity", "VSCodium", "Windsurf"];
  const base =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? process.env.APPDATA ?? path.join(home, "AppData", "Roaming")
        : path.join(home, ".config");
  return names.map((name) => ({ name, dir: path.join(base, name) }));
}

function sourceLabel(appName: string): "vscode" | "antigravity" | "chat-session" {
  if (/antigravity/i.test(appName)) return "antigravity";
  if (/^(code|vscodium|windsurf)/i.test(appName)) return "vscode";
  return "chat-session";
}

function fileStamp(file: string): string {
  try {
    return new Date(fs.statSync(file).mtimeMs).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function asIso(v: unknown, fallback: string): string {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback;
}

function walk(node: unknown, out: CursorPrompt[], fallbackTs: string): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out, fallbackTs);
    return;
  }
  const o = node as Record<string, unknown>;
  const message = o.message as Record<string, unknown> | undefined;
  if (message && typeof message.text === "string") {
    const role = typeof message.role === "string" ? message.role : "user";
    if (role === "user" && message.text.trim()) {
      out.push({
        ts: asIso(o.timestamp ?? o.creationDate ?? o.ts, fallbackTs),
        text: message.text.replace(/\s+/g, " ").trim().slice(0, 280),
      });
    }
  }
  // VS Code requests sometimes store the prompt directly on the request.
  if (typeof o.prompt === "string" && o.prompt.trim() && !o.response) {
    out.push({
      ts: asIso(o.timestamp ?? o.creationDate ?? o.ts, fallbackTs),
      text: o.prompt.replace(/\s+/g, " ").trim().slice(0, 280),
    });
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === "response" || k === "responses" || k === "toolCalls") continue;
    walk(v, out, fallbackTs);
  }
}

function parseChatFile(file: string): CursorPrompt[] {
  const fallback = fileStamp(file);
  const out: CursorPrompt[] = [];
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  if (file.endsWith(".jsonl")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        walk(obj?.v ?? obj, out, asIso(obj?.creationDate, fallback));
      } catch {
        /* tolerate a half-written line */
      }
    }
  } else {
    try {
      walk(JSON.parse(text), out, fallback);
    } catch {
      /* ignore malformed session */
    }
  }
  return out;
}

function sessionDirs(root: string): string[] {
  const user = path.join(root, "User");
  const dirs: string[] = [];
  const ws = path.join(user, "workspaceStorage");
  try {
    for (const entry of fs.readdirSync(ws, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.join(ws, entry.name, "chatSessions"));
    }
  } catch {
    /* no workspace storage */
  }
  dirs.push(path.join(user, "globalStorage", "chatSessions"));
  return dirs.filter((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

function workspaceMatches(sessionDir: string, folders: string[] | null): boolean {
  if (!folders) return true;
  const hashDir = path.dirname(sessionDir);
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(hashDir, "workspace.json"), "utf8"));
    const uri = String(meta.folder ?? "");
    if (!uri.startsWith("file://")) return false;
    const p = decodeURIComponent(uri.replace(/^file:\/\//, ""));
    return folders.some((f) => p.startsWith(f));
  } catch {
    return false;
  }
}

export async function collectChatSessionPrompts(
  since: Date,
  until: Date,
  workspaceFolders: string[] | null,
  signal?: AbortSignal,
): Promise<CursorPrompt[]> {
  const out: CursorPrompt[] = [];
  for (const app of appRoots()) {
    for (const dir of sessionDirs(app.dir)) {
      if (signal?.aborted) return out;
      if (!workspaceMatches(dir, workspaceFolders)) continue;
      let files: string[] = [];
      try {
        files = fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".jsonl") || f.endsWith(".json"));
      } catch {
        continue;
      }
      for (const f of files) {
        for (const prompt of parseChatFile(path.join(dir, f))) {
          const ts = new Date(prompt.ts).getTime();
          if (ts < since.getTime() || ts > until.getTime()) continue;
          out.push({ ...prompt, source: sourceLabel(app.name) });
        }
      }
    }
  }
  return out;
}

export async function collectAllPrompts(
  since: Date,
  until: Date,
  workspaceFolders: string[] | null,
  signal?: AbortSignal,
): Promise<CursorPrompt[]> {
  const [cursor, chat] = await Promise.all([
    collectCursorPrompts(since, until, workspaceFolders, signal),
    collectChatSessionPrompts(since, until, workspaceFolders, signal),
  ]);
  const seen = new Set<string>();
  const merged: CursorPrompt[] = [];
  for (const p of [...cursor.map((x) => ({ ...x, source: "cursor" as const })), ...chat]) {
    const key = `${p.ts.slice(0, 16)}|${p.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }
  return merged.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 80);
}
