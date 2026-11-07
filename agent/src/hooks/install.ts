// Hook installers. Each host has its own config file and event names, but the
// command is always the installed CLI (`shiplogue hook <agent> --event <name>`),
// never `npx` per event. Installs are idempotent, backed up, and reversible.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { HookAgent } from "./normalize";

export interface InstallOptions {
  home?: string;
  dryRun?: boolean;
  uninstall?: boolean;
  /** Override for tests/advanced installs. */
  command?: string;
}

export interface InstallResult {
  agent: HookAgent;
  file: string;
  changed: boolean;
  command: string;
  backup?: string;
  events: string[];
}

const CLAUDE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "SubagentStop",
  "SessionEnd",
];

const CURSOR_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "postToolUse",
  "postToolUseFailure",
  "afterFileEdit",
  "afterAgentResponse",
  "afterAgentThought",
  "afterShellExecution",
  "stop",
  "subagentStart",
  "subagentStop",
];

const CODEX_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
];

export function eventsFor(agent: HookAgent): string[] {
  switch (agent) {
    case "claude":
      return CLAUDE_EVENTS;
    case "cursor":
      return CURSOR_EVENTS;
    case "codex":
      return CODEX_EVENTS;
  }
}

export function configFile(agent: HookAgent, home = os.homedir()): string {
  switch (agent) {
    case "claude":
      return path.join(home, ".claude", "settings.json");
    case "cursor":
      return path.join(home, ".cursor", "hooks.json");
    case "codex":
      return path.join(home, ".codex", "hooks.json");
  }
}

/**
 * Absolute command. `process.argv[1]` is the installed CLI when a hook runs;
 * in tests or unusual launches, pass options.command.
 */
export function defaultHookCommand(
  agent: HookAgent,
  event: string,
  cli = process.argv[1],
): string {
  const executable = process.execPath;
  const script = cli ? path.resolve(cli) : "shiplogue";
  return `"${executable}" "${script}" hook ${agent} --event ${event}`;
}

function marker(agent: HookAgent): string {
  return `hook ${agent} `;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readConfig(file: string): Record<string, any> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function backup(file: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  const dest = `${file}.shiplogue-backup-${Date.now()}`;
  fs.copyFileSync(file, dest);
  return dest;
}

function writeConfig(file: string, config: Record<string, any>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
}

function isOurHandler(value: unknown, agent: HookAgent): boolean {
  if (!isRecord(value)) return false;
  const command = typeof value.command === "string" ? value.command : "";
  const looksLikeCli =
    command.includes("shiplogue") ||
    command.includes("@phenzic/shiplogue-agent") ||
    command.includes("cli.js");
  return looksLikeCli && command.includes(marker(agent));
}

function installClaudeLike(
  config: Record<string, any>,
  agent: HookAgent,
  options: InstallOptions,
): boolean {
  const hooks = isRecord(config.hooks) ? config.hooks : {};
  let changed = false;
  for (const event of eventsFor(agent)) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    if (options.uninstall) {
      const next: any[] = [];
      for (const group of groups) {
        if (!isRecord(group)) {
          next.push(group);
          continue;
        }
        const handlers = Array.isArray(group.hooks) ? group.hooks : [];
        const kept = handlers.filter((handler: unknown) => !isOurHandler(handler, agent));
        if (kept.length !== handlers.length) changed = true;
        if (kept.length > 0) next.push({ ...group, hooks: kept });
      }
      if (next.length > 0) hooks[event] = next;
      else if (hooks[event] !== undefined) {
        delete hooks[event];
        changed = true;
      }
      continue;
    }

    const command = options.command ?? defaultHookCommand(agent, event);
    const already = groups.some((group: any) => {
      const handlers = Array.isArray(group?.hooks) ? group.hooks : [];
      return handlers.some((handler: unknown) => isOurHandler(handler, agent));
    });
    if (!already) {
      groups.push({
        hooks: [{ type: "command", command, timeout: 10 }],
      });
      hooks[event] = groups;
      changed = true;
    }
  }
  if (options.uninstall && Object.keys(hooks).length === 0) {
    delete config.hooks;
  } else {
    config.hooks = hooks;
  }
  return changed;
}

function installCursor(
  config: Record<string, any>,
  agent: HookAgent,
  options: InstallOptions,
): boolean {
  const hooks = isRecord(config.hooks) ? config.hooks : {};
  if (config.version === undefined) config.version = 1;
  let changed = false;
  for (const event of eventsFor(agent)) {
    const entries = Array.isArray(hooks[event]) ? hooks[event] : [];
    if (options.uninstall) {
      const kept = entries.filter((entry: unknown) => !isOurHandler(entry, agent));
      if (kept.length !== entries.length) changed = true;
      if (kept.length > 0) hooks[event] = kept;
      else if (hooks[event] !== undefined) {
        delete hooks[event];
        changed = true;
      }
      continue;
    }
    const command = options.command ?? defaultHookCommand(agent, event);
    if (!entries.some((entry: unknown) => isOurHandler(entry, agent))) {
      entries.push({ command, timeout: 10 });
      hooks[event] = entries;
      changed = true;
    }
  }
  config.hooks = hooks;
  return changed;
}

/**
 * Install or uninstall Shiplogue's hook entries. Existing user hooks are kept;
 * only entries whose command is ours are added/removed.
 */
export function installHooks(
  agent: HookAgent,
  options: InstallOptions = {},
): InstallResult {
  const file = configFile(agent, options.home);
  const config = readConfig(file);
  const changed =
    agent === "cursor"
      ? installCursor(config, agent, options)
      : installClaudeLike(config, agent, options);

  const result: InstallResult = {
    agent,
    file,
    changed,
    command: options.command ?? defaultHookCommand(agent, "<event>"),
    events: eventsFor(agent),
  };
  if (!changed || options.dryRun) return result;
  result.backup = backup(file);
  writeConfig(file, config);
  return result;
}
