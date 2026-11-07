// `shiplogue hook <agent>` — read one host hook payload from stdin, normalize,
// append, and exit 0. Any failure is logged locally and swallowed (fail-open):
// Shiplogue must never block the agent because a hook had a bad day.
import * as fs from "fs";
import * as path from "path";
import { eventsDir, loadConfig, logsDir } from "../config";
import { EventStore } from "../events/store";
import { AgentEventDraft } from "../types";
import { HookAgent, normalizeHook } from "./normalize";

export interface HookRunResult {
  stored: number;
  skipped: number;
}

function logFailure(message: string): void {
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    const line = `${new Date().toISOString()} ${message.replace(/\s+/g, " ")}\n`;
    fs.appendFileSync(path.join(logsDir(), "agent.log"), line, "utf8");
  } catch {
    /* logging must never throw */
  }
}

function allowed(
  draft: AgentEventDraft,
  capturePrompts: boolean,
  captureFileReads: boolean,
): boolean {
  if (!capturePrompts && (draft.kind === "prompt" || draft.kind === "response" || draft.kind === "thought")) {
    return false;
  }
  if (!captureFileReads && draft.kind === "file_read") {
    return false;
  }
  return true;
}

export function runHook(
  agent: HookAgent,
  raw: string,
  eventHint?: string,
): HookRunResult {
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      logFailure(`hook ${agent}: payload is not a JSON object`);
      return { stored: 0, skipped: 0 };
    }
    payload = parsed as Record<string, unknown>;
  } catch (e) {
    logFailure(`hook ${agent}: malformed JSON (${(e as Error).message})`);
    return { stored: 0, skipped: 0 };
  }

  try {
    const config = loadConfig();
    const store = new EventStore(eventsDir());
    const drafts = normalizeHook(agent, payload, { eventHint });
    let stored = 0;
    let skipped = 0;
    for (const draft of drafts) {
      if (!allowed(draft, config.capturePrompts, config.captureFileReads)) {
        skipped++;
        continue;
      }
      if (store.append(draft)) stored++;
      else skipped++;
    }
    // Retention is cheap (a directory read) and keeps unattended installs tidy.
    store.pruneOld(config.retentionDays);
    return { stored, skipped };
  } catch (e) {
    logFailure(`hook ${agent}: ${(e as Error).message}`);
    return { stored: 0, skipped: 0 };
  }
}

/**
 * Cursor permission hooks require a JSON decision; observational hooks do not.
 * `beforeSubmitPrompt` and the before-* hooks are the only ones we install that
 * need an explicit allow.
 */
export function hookResponse(agent: HookAgent, event: string): string | undefined {
  if (agent !== "cursor") return undefined;
  if (event === "beforeSubmitPrompt") return JSON.stringify({ continue: true });
  if (
    event === "beforeShellExecution" ||
    event === "beforeMCPExecution" ||
    event === "beforeReadFile" ||
    event === "preToolUse"
  ) {
    return JSON.stringify({ permission: "allow" });
  }
  return undefined;
}
