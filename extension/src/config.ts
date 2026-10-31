import * as vscode from "vscode";
import { DetailLevel, Tone } from "./state";

let detailGetter: () => DetailLevel = () => "concise";
let toneGetter: () => Tone = () => "neutral";

// Wired in activate() so the panel's last-used detail level is the source of truth.
export function setDetailGetter(fn: () => DetailLevel): void {
  detailGetter = fn;
}

// Same pattern for the tone: the panel's last-used tone wins.
export function setToneGetter(fn: () => Tone): void {
  toneGetter = fn;
}

// Thin typed wrapper over the extension's settings.
export function cfg() {
  const c = vscode.workspace.getConfiguration("shiplogue");
  return {
    lookbackHours: c.get<number>("lookbackHours", 24),
    ollamaUrl: c.get<string>("ollama.url", "http://localhost:11434").replace(/\/+$/, ""),
    ollamaModel: c.get<string>("ollama.model", "llama3.2"),
    // 0 = fall back to the per-detail budget in summarize.ts; explicit values
    // let users give reasoning models a bigger output budget.
    ollamaNumPredict: c.get<number>("ollama.numPredict", 0),
    ollamaNumCtx: c.get<number>("ollama.numCtx", 8192),
    // Reasoning-model control: "auto" sends nothing and only disables thinking
    // on the empty-response retry; "off"/"on" are sent as think:false/true.
    ollamaThink: c.get<"auto" | "on" | "off">("ollama.think", "auto"),
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
    // Which drafting backend to use. "local" (bundled model) lands in 0.2.0;
    // until then it produces an actionable message rather than a crash.
    modelBackend: c.get<"auto" | "local" | "provider" | "ollama">("model.backend", "auto"),
    providerType: c.get<"none" | "anthropic" | "openai" | "google" | "openai-compatible">(
      "provider.type",
      "none",
    ),
    providerModel: c.get<string>("provider.model", "").trim(),
    providerBaseUrl: c.get<string>("provider.baseUrl", "").trim().replace(/\/+$/, ""),
    // Hard cap for BYOK output; 0 = use the detail level's budget.
    providerMaxOutputTokens: c.get<number>("provider.maxOutputTokens", 1200),
    detail: detailGetter(),
    tone: toneGetter(),
    scope: c.get<"workspace" | "all">("scope", "workspace"),
    // 0 disables the generation timeout.
    generateTimeoutSeconds: c.get<number>("generate.timeoutSeconds", 180),
    // 0 keeps activity logs forever.
    storeRetentionDays: c.get<number>("store.retentionDays", 14),
  };
}
