// Agent configuration: CLI flags > env (SHIPLOGUE_*) > ~/.shiplogue/config.json
// (mode 0600) > defaults. Never print config values — they may hold secrets.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface AgentConfig {
  capturePrompts: boolean;
  captureFileReads: boolean;
  retentionDays: number; // 0 = keep forever
  lookbackHours: number;
}

export const DEFAULTS: AgentConfig = {
  capturePrompts: true,
  captureFileReads: false,
  retentionDays: 14,
  lookbackHours: 24,
};

export function shiplogueHome(): string {
  return path.join(os.homedir(), ".shiplogue");
}

export function configPath(): string {
  return path.join(shiplogueHome(), "config.json");
}

export function eventsDir(): string {
  return path.join(shiplogueHome(), "agent", "events");
}

export function statePath(): string {
  return path.join(shiplogueHome(), "agent", "state.json");
}

function readFileConfig(): Partial<AgentConfig> {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function bool(v: string | undefined): boolean | undefined {
  if (v === undefined) {
    return undefined;
  }
  return v === "1" || v === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const file = readFileConfig();
  return {
    capturePrompts:
      bool(env.SHIPLOGUE_CAPTURE_PROMPTS) ?? file.capturePrompts ?? DEFAULTS.capturePrompts,
    captureFileReads:
      bool(env.SHIPLOGUE_CAPTURE_READS) ?? file.captureFileReads ?? DEFAULTS.captureFileReads,
    retentionDays:
      (env.SHIPLOGUE_RETENTION_DAYS ? Number(env.SHIPLOGUE_RETENTION_DAYS) : undefined) ??
      file.retentionDays ??
      DEFAULTS.retentionDays,
    lookbackHours:
      (env.SHIPLOGUE_LOOKBACK_HOURS ? Number(env.SHIPLOGUE_LOOKBACK_HOURS) : undefined) ??
      file.lookbackHours ??
      DEFAULTS.lookbackHours,
  };
}

// Write config with owner-only permissions (0600) — the file can hold keys later.
export function writeConfig(update: Partial<AgentConfig>): void {
  fs.mkdirSync(shiplogueHome(), { recursive: true });
  const next = { ...readFileConfig(), ...update };
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
}
