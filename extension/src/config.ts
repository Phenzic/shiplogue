import * as vscode from "vscode";
import { DetailLevel } from "./state";

let detailGetter: () => DetailLevel = () => "concise";

// Wired in activate() so the panel's last-used detail level is the source of truth.
export function setDetailGetter(fn: () => DetailLevel): void {
  detailGetter = fn;
}

// Thin typed wrapper over the extension's settings.
export function cfg() {
  const c = vscode.workspace.getConfiguration("standup");
  return {
    lookbackHours: c.get<number>("lookbackHours", 24),
    ollamaUrl: c.get<string>("ollama.url", "http://localhost:11434").replace(/\/+$/, ""),
    ollamaModel: c.get<string>("ollama.model", "llama3.2"),
    githubToken: c.get<string>("github.token", "").trim(),
    githubUseBuiltInAuth: c.get<boolean>("github.useBuiltInAuth", true),
    githubRepos: c.get<string[]>("github.repos", []),
    format: c.get<"done-next-blockers" | "yesterday-today-blockers">("format", "done-next-blockers"),
    webhookType: c.get<"none" | "discord" | "slack">("webhook.type", "none"),
    webhookUrl: c.get<string>("webhook.url", "").trim(),
    trackEnabled: c.get<boolean>("track.enabled", true),
    reminderEnabled: c.get<boolean>("reminder.enabled", true),
    reminderTime: c.get<string>("reminder.time", "16:00"),
    cursorEnabled: c.get<boolean>("cursor.enabled", true),
    detail: detailGetter(),
    scope: c.get<"workspace" | "all">("scope", "workspace"),
  };
}
