// Local, read-only status for `shiplogue status`, MCP get_agent_status, and the
// plugin skill. Counts and versions only; never prompt text or secrets.
import * as fs from "fs";
import * as os from "os";
import {
  agentDir,
  configPath,
  draftsDir,
  eventsDir,
  loadConfig,
  logsDir,
  shiplogueHome,
  statePath,
} from "./config";
import { configFile } from "./hooks/install";
import type { HookAgent } from "./hooks/normalize";
import { EventStore } from "./events/store";
import { loadState } from "./state";
import { workspaceIdFor } from "./events/dedupe";
import { agentVersion } from "./version";
import { latestDraftDate } from "./drafts/store";

function hooksFor(home = os.homedir()): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const agent of ["claude", "cursor", "codex"] as HookAgent[]) {
    try {
      const raw = fs.readFileSync(configFile(agent, home), "utf8");
      result[agent] = raw.includes(`hook ${agent} `);
    } catch {
      result[agent] = false;
    }
  }
  return result;
}

export interface AgentStatus {
  agent: string;
  schemaVersion: number;
  deviceId: string;
  workspace: string;
  workspaceId: string;
  paths: {
    home: string;
    events: string;
    drafts: string;
    config: string;
    state: string;
  };
  capture: { prompts: boolean; fileReads: boolean; retentionDays: number };
  eventsToday: number;
  latestDraft?: string;
  hooks: Record<string, boolean>;
  cloud: { configured: boolean };
}

export function currentAgentStatus(workspace = process.cwd()): AgentStatus {
  const config = loadConfig();
  const state = loadState(agentVersion());
  const store = new EventStore(eventsDir());
  const latest = latestDraftDate();
  return {
    agent: agentVersion(),
    schemaVersion: state.schemaVersion,
    deviceId: state.deviceId,
    workspace,
    workspaceId: workspaceIdFor(workspace),
    paths: {
      home: shiplogueHome(),
      events: eventsDir(),
      drafts: draftsDir(),
      config: configPath(),
      state: statePath(),
    },
    capture: {
      prompts: config.capturePrompts,
      fileReads: config.captureFileReads,
      retentionDays: config.retentionDays,
    },
    eventsToday: store.countToday(),
    ...(latest ? { latestDraft: latest } : {}),
    hooks: hooksFor(),
    cloud: {
      configured: Boolean(
        process.env.SHIPLOGUE_PROJECT_KEY || process.env.SHIPLOGUE_CLOUD_TOKEN,
      ),
    },
  };
}

export { configFile, logsDir, agentDir };
