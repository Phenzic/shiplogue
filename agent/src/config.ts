// Agent configuration: environment (SHIPLOGUE_*) > ~/.shiplogue/config.json
// (mode 0600) > defaults. Values may hold secrets later, so nothing here logs
// the config object.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AgentConfig } from "./types";

export const DEFAULTS: AgentConfig = {
  capturePrompts: true,
  captureFileReads: false,
  retentionDays: 14,
  lookbackHours: 24,
};

/**
 * SHIPLOGUE_HOME exists so tests and portable installs never touch the real
 * home directory. Production behavior is unchanged when it is unset.
 */
export function shiplogueHome(): string {
  return process.env.SHIPLOGUE_HOME
    ? path.resolve(process.env.SHIPLOGUE_HOME)
    : path.join(os.homedir(), ".shiplogue");
}

export function configPath(): string {
  return path.join(shiplogueHome(), "config.json");
}

export function agentDir(): string {
  return path.join(shiplogueHome(), "agent");
}

export function eventsDir(): string {
  return path.join(agentDir(), "events");
}

export function statePath(): string {
  return path.join(agentDir(), "state.json");
}

export function logsDir(): string {
  return path.join(agentDir(), "logs");
}

export function draftsDir(): string {
  return path.join(agentDir(), "drafts");
}

function readFileConfig(): Partial<AgentConfig> {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed
      ? (parsed as Partial<AgentConfig>)
      : {};
  } catch {
    return {};
  }
}

function bool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  return v === "1" || v === "true";
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const file = readFileConfig();
  return {
    capturePrompts:
      bool(env.SHIPLOGUE_CAPTURE_PROMPTS) ??
      file.capturePrompts ??
      DEFAULTS.capturePrompts,
    captureFileReads:
      bool(env.SHIPLOGUE_CAPTURE_READS) ??
      file.captureFileReads ??
      DEFAULTS.captureFileReads,
    retentionDays:
      num(env.SHIPLOGUE_RETENTION_DAYS) ??
      file.retentionDays ??
      DEFAULTS.retentionDays,
    lookbackHours:
      num(env.SHIPLOGUE_LOOKBACK_HOURS) ??
      file.lookbackHours ??
      DEFAULTS.lookbackHours,
  };
}

/** Merge a partial update into config.json with owner-only permissions. */
export function writeConfig(update: Partial<AgentConfig>): AgentConfig {
  fs.mkdirSync(shiplogueHome(), { recursive: true });
  const next = { ...readFileConfig(), ...update };
  const tmp = `${configPath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, configPath());
  try {
    fs.chmodSync(configPath(), 0o600);
  } catch {
    /* best effort on filesystems without POSIX modes */
  }
  // Environment overrides still win on read, matching loadConfig().
  return loadConfig();
}
