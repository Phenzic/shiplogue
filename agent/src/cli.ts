#!/usr/bin/env node
// shiplogue CLI. A0 scope: `status` (+ `--json`). Later chunks add
// watch/hook/hooks/mcp/standup/render/preview/post/sync/config.
import * as path from "path";
import { loadConfig, eventsDir, configPath, statePath } from "./config";
import { EventStore } from "./events/store";
import { loadState } from "./state";
import { workspaceIdFor } from "./events/dedupe";
import { collectCommitsFromFolders } from "../../extension/src/core/gather/git";

// Find the agent's own package.json regardless of build layout (src vs dist).
function agentVersion(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    try {
      const pj = require(path.join(dir, "package.json"));
      if (pj.name === "@phenzic/shiplogue-agent") {
        return pj.version;
      }
    } catch {
      /* keep walking up */
    }
    dir = path.dirname(dir);
  }
  return "0.0.0-dev";
}
const VERSION = agentVersion();

async function status(json: boolean): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig();
  const store = new EventStore(eventsDir());
  const state = loadState(VERSION);

  let commits24h = 0;
  try {
    const since = new Date(Date.now() - 24 * 3600_000);
    const commits = await collectCommitsFromFolders(
      [{ name: path.basename(cwd), path: cwd }],
      since,
      new Date(),
    );
    commits24h = commits.length;
  } catch {
    /* not a git repo / no git — sources just show 0 */
  }

  const info = {
    agent: VERSION,
    schemaVersion: state.schemaVersion,
    deviceId: state.deviceId,
    workspace: cwd,
    workspaceId: workspaceIdFor(cwd),
    paths: {
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
    process.stdout.write(JSON.stringify(info, null, 2) + "\n");
    return;
  }
  process.stdout.write(
    [
      `Shiplogue agent v${info.agent} (schema v${info.schemaVersion})`,
      `Workspace: ${info.workspace} [${info.workspaceId}]`,
      `Events today: ${info.sources.eventsToday} · git commits (24h): ${info.sources.gitCommits24h}`,
      `Capture: prompts ${info.capture.prompts ? "on" : "off"}, file reads ${info.capture.fileReads ? "on" : "off"}, retention ${info.capture.retentionDays}d`,
      `Store: ${info.paths.events}`,
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
      await status(json);
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\nAvailable: status\n`);
      process.exitCode = 1;
  }
}

void main();
