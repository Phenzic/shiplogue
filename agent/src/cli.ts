#!/usr/bin/env node
// Shiplogue CLI. A1 scope: `status` (+ `--json`). Later chunks add
// watch/hook/hooks/mcp/standup/render/preview/post/sync/config.
import * as path from "path";
import {
  agentDir,
  configPath,
  eventsDir,
  loadConfig,
  shiplogueHome,
  statePath,
} from "./config";
import { EventStore } from "./events/store";
import { loadState } from "./state";
import { workspaceIdFor } from "./events/dedupe";
import { countCommitsSince } from "./git";

// Find the agent's own package.json regardless of build layout (src vs dist).
function agentVersion(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pj = require(path.join(dir, "package.json")) as {
        name?: string;
        version?: string;
      };
      if (pj.name === "@phenzic/shiplogue-agent") {
        return pj.version ?? "0.0.0-dev";
      }
    } catch {
      /* keep walking up */
    }
    dir = path.dirname(dir);
  }
  return "0.0.0-dev";
}

const VERSION = agentVersion();

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
}

function parseWorkspace(args: string[]): string {
  const ix = args.findIndex((a) => a === "--workspace" || a === "-w");
  if (ix >= 0 && args[ix + 1]) {
    return path.resolve(args[ix + 1]);
  }
  return process.cwd();
}

async function status(args: string[], json: boolean): Promise<void> {
  const workspace = parseWorkspace(args);
  const config = loadConfig();
  const store = new EventStore(eventsDir());
  const state = loadState(VERSION);
  const since = new Date(Date.now() - 24 * 3600_000);
  let commits24h = 0;
  try {
    commits24h = await countCommitsSince([workspace], since);
  } catch {
    /* sources just show 0 */
  }

  const info: StatusInfo = {
    agent: VERSION,
    schemaVersion: state.schemaVersion,
    deviceId: state.deviceId,
    workspace,
    workspaceId: workspaceIdFor(workspace),
    paths: {
      home: shiplogueHome(),
      events: eventsDir(),
      config: configPath(),
      state: statePath(),
    },
    capture: {
      prompts: config.capturePrompts,
      fileReads: config.captureFileReads,
      retentionDays: config.retentionDays,
    },
    sources: {
      gitCommits24h: commits24h,
      eventsToday: store.countToday(),
    },
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
      `Store: ${info.paths.events}`,
      `Agent home: ${agentDir()}`,
    ].join("\n") + "\n",
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const cmd = args.find((a) => !a.startsWith("-"));
  switch (cmd) {
    case "status":
    case undefined:
      await status(args, json);
      break;
    default:
      process.stderr.write(
        `Unknown command: ${cmd}\nAvailable: status [--json] [--workspace <dir>]\n`,
      );
      process.exitCode = 1;
  }
}

void main();
