import * as vscode from "vscode";

export type SourceId =
  | "vscode"
  | "cursor"
  | "antigravity"
  | "windsurf"
  | "devin"
  | "vscodium"
  | "trae"
  | "kiro"
  | "zed"
  | "claude-code"
  | "codex"
  | "copilot"
  | "github"
  | "unknown";

export const SOURCE_LABELS: Record<SourceId, string> = {
  vscode: "VS Code",
  cursor: "Cursor",
  antigravity: "Antigravity",
  windsurf: "Windsurf",
  devin: "Devin",
  vscodium: "VSCodium",
  trae: "Trae",
  kiro: "Kiro",
  zed: "Zed",
  "claude-code": "Claude Code",
  codex: "Codex",
  copilot: "GitHub Copilot",
  github: "GitHub",
  unknown: "Editor",
};

export function currentEditorSource(appName = vscode.env?.appName ?? ""): SourceId {
  const value = appName.toLowerCase();
  if (value.includes("cursor")) return "cursor";
  if (value.includes("antigravity")) return "antigravity";
  if (value.includes("devin")) return "devin";
  if (value.includes("windsurf")) return "windsurf";
  if (value.includes("vscodium")) return "vscodium";
  if (value.includes("trae")) return "trae";
  if (value.includes("kiro")) return "kiro";
  if (value.includes("zed")) return "zed";
  if (value.includes("visual studio code") || value === "code" || value.includes("code - insiders")) {
    return "vscode";
  }
  return "unknown";
}

function promptSource(source: string | undefined, editor: SourceId): SourceId | undefined {
  if (source === "cursor") return "cursor";
  if (source === "antigravity") return "antigravity";
  if (source === "vscode") return editor === "unknown" ? "vscode" : editor;
  if (source === "chat-session") return editor === "unknown" ? "copilot" : editor;
  return undefined;
}

export function sourcesForContext(
  _prompts: { source?: string }[],
  appName = vscode.env?.appName ?? "",
): SourceId[] {
  // A stand-up is produced by the editor/agent hosting this session. Prompt
  // context may come from another tool, but it must not be credited as a
  // producing source (for example Cursor prompts inside Antigravity).
  return [currentEditorSource(appName)];
}

export function unionSources(lists: (readonly string[] | undefined)[]): SourceId[] {
  const seen = new Set<SourceId>();
  for (const list of lists) {
    for (const source of list ?? []) {
      if (source in SOURCE_LABELS) seen.add(source as SourceId);
    }
  }
  return [...seen];
}
