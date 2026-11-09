#!/usr/bin/env node
// Shiplogue CLI. A1/A3: status, hook, hooks install/uninstall, init. Later
// chunks add watch/mcp/standup/render/preview/post/sync/config.
import * as fs from "fs";
import * as path from "path";
import {
  agentDir,
  configPath,
  eventsDir,
  loadConfig,
  logsDir,
  shiplogueHome,
  statePath,
  writeConfig,
} from "./config";
import { loadState } from "./state";
import { countCommitsSince } from "./git";
import { hookResponse, runHook } from "./hooks/command";
import { HookAgent } from "./hooks/normalize";
import { eventsFor, installHooks } from "./hooks/install";
import { agentVersion } from "./version";
import { currentAgentStatus } from "./status";
import { renderStandup } from "./mcp/tools";
import { latestDraftDate, listDrafts } from "./drafts/store";
import { runMcp } from "./mcp/run";
import { cloudStatus, postAgentDraft, syncAgentActivity, syncAgentDraft } from "./cloud";

const VERSION = agentVersion();
const HOOK_AGENTS: HookAgent[] = ["claude", "cursor", "codex"];

interface StatusInfo {
  agent: string;
  schemaVersion: number;
  deviceId: string;
  workspace: string;
  workspaceId: string;
  paths: { home: string; events: string; config: string; state: string };
  capture: {
    prompts: boolean;
    fileReads: boolean;
    retentionDays: number;
  };
  sources: { gitCommits24h: number; eventsToday: number };
  hooks: Record<string, boolean>;
  cloud: { configured: boolean };
  latestDraft?: string;
}

function flag(args: string[], name: string): string | undefined {
  const ix = args.indexOf(name);
  return ix >= 0 ? args[ix + 1] : undefined;
}

function parseWorkspace(args: string[]): string {
  const value = flag(args, "--workspace") ?? flag(args, "-w");
  return value ? path.resolve(value) : process.cwd();
}

function hookAgent(args: string[]): HookAgent | undefined {
  const value = flag(args, "--agent") ?? args.find((a) => HOOK_AGENTS.includes(a as HookAgent));
  return HOOK_AGENTS.includes(value as HookAgent) ? (value as HookAgent) : undefined;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function status(args: string[], json: boolean): Promise<void> {
  const workspace = parseWorkspace(args);
  const base = currentAgentStatus(workspace);
  const since = new Date(Date.now() - 24 * 3600_000);
  let commits24h = 0;
  try {
    commits24h = await countCommitsSince([workspace], since);
  } catch {
    /* sources just show 0 */
  }

  const info: StatusInfo = {
    ...base,
    sources: { gitCommits24h: commits24h, eventsToday: base.eventsToday },
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `Shiplogue agent v${info.agent} (schema v${info.schemaVersion})`,
      `Workspace: ${info.workspace} [${info.workspaceId}]`,
      `Events today: ${info.sources.eventsToday} · git commits (24h): ${info.sources.gitCommits24h}`,
      `Capture: prompts ${info.capture.prompts ? "on" : "off"}, file reads ${
        info.capture.fileReads ? "on" : "off"
      }, retention ${info.capture.retentionDays}d`,
      `Hooks: ${Object.entries(info.hooks)
        .map(([agent, installed]) => `${agent}=${installed ? "on" : "off"}`)
        .join(", ")}`,
      `Cloud project key: ${info.cloud.configured ? "configured" : "not configured"}`,
      ...(info.latestDraft ? [`Latest draft: ${info.latestDraft}`] : []),
      `Store: ${info.paths.events}`,
      `Agent home: ${agentDir()}`,
    ].join("\n") + "\n",
  );
}

async function hook(args: string[], json: boolean): Promise<void> {
  const agent = hookAgent(args);
  if (!agent) {
    process.stderr.write("Usage: shiplogue hook <claude|cursor|codex> [--event <name>]\n");
    process.exitCode = 1;
    return;
  }
  const event = flag(args, "--event") ?? "";
  // Codex `notify` passes the JSON payload as an argument, not on stdin.
  const notifyIx = args.indexOf("--notify");
  const raw =
    notifyIx >= 0
      ? args[notifyIx + 1] ?? args[args.length - 1] ?? "{}"
      : await readStdin();
  const result = runHook(agent, raw || "{}", event);
  const response = hookResponse(agent, event);
  if (response) process.stdout.write(`${response}\n`);
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
}

function init(args: string[], json: boolean): void {
  fs.mkdirSync(eventsDir(), { recursive: true });
  fs.mkdirSync(logsDir(), { recursive: true });
  const config = loadConfig();
  writeConfig(config);
  const state = loadState(VERSION);
  const info = {
    agent: VERSION,
    home: shiplogueHome(),
    events: eventsDir(),
    config: configPath(),
    state: statePath(),
    deviceId: state.deviceId,
    next: [
      "shiplogue hooks install --agent claude",
      "shiplogue hooks install --agent cursor",
      "shiplogue hooks install --agent codex",
    ],
  };
  if (json) process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
  else {
    process.stdout.write(
      [
        `Initialized Shiplogue agent in ${info.home}`,
        `Events: ${info.events}`,
        `Next: ${info.next.join(" · ")}`,
      ].join("\n") + "\n",
    );
  }
}

function hooks(args: string[], json: boolean): void {
  const sub = args.find((a) => a === "install" || a === "uninstall");
  const agent = hookAgent(args);
  if (!sub || !agent) {
    process.stderr.write(
      "Usage: shiplogue hooks install|uninstall --agent <claude|cursor|codex> [--dry-run]\n",
    );
    process.exitCode = 1;
    return;
  }
  const result = installHooks(agent, {
    dryRun: args.includes("--dry-run"),
    uninstall: sub === "uninstall",
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `${result.changed ? "Updated" : "No change"} ${result.agent} hooks: ${result.file}`,
      `Events: ${eventsFor(agent).length}`,
      result.backup ? `Backup: ${result.backup}` : "",
    ]
      .filter(Boolean)
      .join("\n") + "\n",
  );
}

function render(args: string[], json: boolean): void {
  const date = flag(args, "--date");
  const rendered = renderStandup({ date });
  if (json) {
    process.stdout.write(`${JSON.stringify(rendered, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${rendered.markdown}\n`);
}

function drafts(args: string[], json: boolean): void {
  const limit = Number(flag(args, "--limit") ?? 14) || 14;
  const records = listDrafts(limit).map((draft) => ({
    date: draft.date,
    revision: draft.revision,
    updatedAt: draft.updatedAt,
    source: draft.source,
    quality: draft.quality?.score,
  }));
  if (json) {
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    return;
  }
  if (records.length === 0) {
    process.stdout.write("No drafts saved yet.\n");
    return;
  }
  process.stdout.write(
    records
      .map(
        (record) =>
          `${record.date}  rev ${record.revision}  ${record.source ?? "agent"}${
            record.quality !== undefined ? `  score ${record.quality}` : ""
          }`,
      )
      .join("\n") + "\n",
  );
}

async function cloud(args: string[], json: boolean): Promise<void> {
  const sub = args.find((a) => a === "status" || a === "sync" || a === "post");
  if (sub === "sync") {
    const date = flag(args, "--date") ?? undefined;
    const activity = await syncAgentActivity(date)
    let draft: unknown = null
    try { draft = await syncAgentDraft(date) } catch (error) { draft = { skipped: (error as Error).message } }
    const result = { activity, draft }
    process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `Synced activity: ${activity.accepted} accepted, ${activity.duplicates} duplicates.\nDraft: ${draft && typeof draft === "object" && "revision" in draft ? `revision ${(draft as { revision: number }).revision}` : "not synced"}.\n`)
    return
  }
  if (sub === "post") {
    const date = flag(args, "--date") ?? latestDraftDate()
    if (!date) throw new Error("No local draft found.")
    const result = await postAgentDraft(date)
    process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `Posted ${date}; delivery ${result.delivery.id} ${result.delivery.status}.\n`)
    return
  }
  const status = await cloudStatus()
  process.stdout.write(json ? `${JSON.stringify(status, null, 2)}\n` : `Project: ${status.project.name} (${status.plan})\nTargets: ${status.targets.length}\n`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const cmd = args.find((a) => !a.startsWith("-"));
  try {
    switch (cmd) {
      case "status":
      case undefined:
        await status(args, json);
        break;
      case "hook":
        await hook(args, json);
        break;
      case "hooks":
        hooks(args, json);
        break;
      case "mcp":
        runMcp();
        break;
      case "render":
        render(args, json);
        break;
      case "drafts":
        drafts(args, json);
        break;
      case "cloud":
        await cloud(args, json);
        break;
      case "init":
        init(args, json);
        break;
      default:
        process.stderr.write(
          `Unknown command: ${cmd}\n` +
            "Available: status, init, hook, hooks install|uninstall, mcp, render, drafts\n",
        );
        process.exitCode = 1;
    }
  } catch (e) {
    // Hooks are fail-open, but an unexpected CLI failure should still be visible.
    process.stderr.write(`shiplogue: ${(e as Error).message}\n`);
    process.exitCode = cmd === "hook" ? 0 : 1;
  }
}

void main();
