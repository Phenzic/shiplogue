import * as vscode from "vscode";
import { Store } from "./store";
import { Tracker } from "./tracker";
import { State } from "./state";
import { Reminder } from "./reminder";
import { cfg, setDetailGetter, setToneGetter } from "./config";
import { gatherContext, contextToText } from "./gather";
import { generateStandup } from "./summarize";
import { githubToken } from "./github";
import { buildReferences } from "./format";
import { ShiploguePanel } from "./shiploguePanel";
import {
  AUTO_UPDATE_SETTINGS_QUERY,
  EXTENSION_ID,
  MARKETPLACE_URL,
  OPEN_VSX_URL,
  checkForUpdate,
} from "./versionCheck";
import { setSecretStorage } from "./model/secrets";
import { loadProviderConfig, providerDisplayName } from "./model/registry";
import { BackendMeta } from "./model/types";
import { clearProviderKey, setProviderKey, testProvider } from "./commands/providerKeys";
import { configureShortcut } from "./commands/shortcuts";
import { cloudStatus, connectCloud, disconnectCloud, initCloud } from "./commands/cloud";
import type { CloudClient } from "./cloud";
import { Analytics, initAnalytics } from "./analytics";
import { PromptWatcher } from "./promptWatcher";
import { ActiveProviderType } from "./core/providers";

let store: Store;
let state: State;
let tracker: Tracker | undefined;
let promptWatcher: PromptWatcher | undefined;
let reminder: Reminder | undefined;
let cloud: CloudClient | undefined;
let analytics: Analytics | undefined;

// Generation runs are serialized by a monotonic epoch: a new run (Regenerate,
// Detail change) aborts and supersedes the previous one, whose late results
// are dropped instead of overwriting the newer draft.
let generationEpoch = 0;
let inFlight: AbortController | undefined;

// The latest activation's health check, exposed so tests can await it instead
// of racing a fire-and-forget promise. Never rejects.
export let healthCheckDone: Promise<void> | undefined;

export function activate(context: vscode.ExtensionContext) {
  store = new Store(context);
  state = new State(context);
  cloud = initCloud(context);
  analytics = initAnalytics(context, cloud);
  cloudWarningShown = false;
  void analytics.track("extension.activated");
  // Provider keys live only in SecretStorage (OS keychain). Guard because a
  // few hosts (and the test stub) do not implement it.
  if (context.secrets) {
    setSecretStorage(context.secrets);
  }
  store.pruneOld(cfg().storeRetentionDays);

  // Migrate a previously saved workspace setting into globalState once.
  if (!state.hasDetail()) {
    const insp = vscode.workspace
      .getConfiguration("shiplogue")
      .inspect<"concise" | "standard" | "elaborate">("detail");
    const saved = insp?.globalValue ?? insp?.workspaceValue;
    if (saved) {
      void state.setDetail(saved);
    }
  }
  setDetailGetter(() => state.getDetail());
  setToneGetter(() => state.getTone());

  if (cfg().trackEnabled) {
    tracker = new Tracker(store);
    tracker.start();
  }

  // Continuous prompt capture across Cursor/VS Code/Antigravity-compatible
  // hosts. The watcher is silent; failures never block activation.
  promptWatcher = new PromptWatcher();
  promptWatcher.start();

  reminder = new Reminder(state, () => void runGenerate("reminder"));
  void reminder.ensureSetup().then(() => reminder?.start());

  // Fire-and-forget first-run check: surface Ollama problems at startup with a
  // fix path, instead of letting the first Generate fail. Never blocks
  // activation and never throws.
  healthCheckDone = checkOllamaHealth();
  void healthCheckDone;

  // Extension-side update check: VS Code handles marketplace auto-update for
  // installed extensions; this adds a GitHub-Releases-based notice (covers manual
  // VSIX installs, which have no marketplace update channel). Fire-and-forget;
  // never blocks or breaks activation.
  void runUpdateCheck(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("shiplogue.generate", () => runGenerate("manual")),
    vscode.commands.registerCommand("shiplogue.showActivity", () => runShowActivity()),
    vscode.commands.registerCommand("shiplogue.setProviderKey", () => setProviderKey()),
    vscode.commands.registerCommand("shiplogue.clearProviderKey", () => clearProviderKey()),
    vscode.commands.registerCommand("shiplogue.testProvider", () => testProvider()),
    vscode.commands.registerCommand("shiplogue.setReminderTime", () =>
      reminder?.pickTime("What time should Shiplogue remind you daily? (24h, local)"),
    ),
    vscode.commands.registerCommand("shiplogue.configureShortcut", () => configureShortcut()),
    vscode.commands.registerCommand("shiplogue.connectCloud", () => connectCloud()),
    vscode.commands.registerCommand("shiplogue.disconnectCloud", () => disconnectCloud()),
    vscode.commands.registerCommand("shiplogue.cloudStatus", () => cloudStatus()),
    vscode.commands.registerCommand("shiplogue.checkUpdate", () => void runUpdateCheck(context, true)),
    vscode.commands.registerCommand("shiplogue.connectGitHub", async () => {
      const token = await githubToken(true);
      vscode.window.showInformationMessage(
        token ? "GitHub connected — issues & PRs will be included." : "GitHub sign-in was cancelled.",
      );
    }),
  );
}

async function runGenerate(
  reason: "manual" | "regenerate" | "reminder" = "manual",
): Promise<void> {
  const panel = ShiploguePanel.show(
    () => void runGenerate("regenerate"),
    state,
    () => inFlight?.abort(),
    (format) => {
      void analytics?.track("standup.copied", { format });
    },
  );
  // A new run supersedes and aborts any in-flight run.
  inFlight?.abort();
  const epoch = ++generationEpoch;
  const controller = new AbortController();
  inFlight = controller;

  const timeoutSeconds = cfg().generateTimeoutSeconds;
  let timedOut = false;
  const timeout =
    timeoutSeconds > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutSeconds * 1000)
      : undefined;

  // Progress: the phase label is set on transitions; a 1s ticker appends
  // elapsed time so long model runs visibly progress.
  const started = Date.now();
  let phase = "";
  const tick = setInterval(() => {
    if (phase && epoch === generationEpoch) {
      panel.setLoading(`${phase} (${Math.round((Date.now() - started) / 1000)}s)`);
    }
  }, 1000);
  const setPhase = (label: string) => {
    phase = label;
    if (epoch === generationEpoch) {
      panel.setLoading(label);
    }
  };

  try {
    const ctx = await gatherContext(store, { signal: controller.signal, onPhase: setPhase });
    if (!ctx.commits.length && !ctx.github.length && !ctx.touches.length && !ctx.cursorPrompts.length) {
      if (epoch === generationEpoch) {
        panel.setError(
          `No activity found in the last ${cfg().lookbackHours}h. Commit some work, or increase shiplogue.lookbackHours.`,
        );
      }
      return;
    }
    setPhase("Writing your stand-up…");
    const { text: draft, warnings, backend } = await generateStandup(ctx, controller.signal);
    if (controller.signal.aborted) {
      throw new DOMException("Generation aborted", "AbortError");
    }
    const markdown = draft + buildReferences(ctx);
    // Surface input caps / scope fallbacks next to the activity counts, so a
    // busy day never looks silently incomplete.
    const notes: string[] = [];
    if (ctx.noFolder) {
      notes.push("No folder open — included all projects.");
    }
    if (ctx.truncated?.commits) {
      notes.push(`showing ${ctx.commits.length} of ${ctx.truncated.commits} commits (most recent)`);
    }
    if (ctx.truncated?.cursorPrompts) {
      notes.push(
        `showing ${ctx.cursorPrompts.length} of ${ctx.truncated.cursorPrompts} AI prompts (most recent)`,
      );
    }
    if (ctx.truncated?.github) {
      notes.push(`showing ${ctx.github.length} of ${ctx.truncated.github} GitHub items (most recent)`);
    }
    if (epoch === generationEpoch) {
      panel.setDraft({
        markdown,
        summary: {
          commits: ctx.commits.length,
          files: ctx.touches.length,
          github: ctx.github.length,
          ...(notes.length ? { notes } : {}),
        },
        ...(warnings.length ? { warnings } : {}),
        ...(backend ? { modelLabel: backendLabel(backend), modelNote: backendNote(backend) } : {}),
      });
      void analytics?.track("standup.generated", {
        trigger: reason,
        durationMs: Date.now() - started,
        commits: ctx.commits.length,
        files: ctx.touches.length,
        github: ctx.github.length,
        warnings: warnings.length,
        backend: backend?.kind ?? "none",
        detail: cfg().detail,
        tone: cfg().tone,
      });
      if (reason === "regenerate") {
        void analytics?.track("standup.regenerated", { trigger: "panel" });
      }
      void syncDraftToCloud(markdown, backend ? backendLabel(backend) : undefined);
    }
  } catch (e: any) {
    if (controller.signal.aborted) {
      // Only the current run may announce its cancellation; superseded runs
      // stay silent because the newer run already owns the panel.
      if (epoch === generationEpoch) {
        if (timedOut) {
          void analytics?.track("generation.failed", {
            category: "timeout",
            durationMs: Date.now() - started,
            phase,
          });
        }
        panel.setCancelled(
          timedOut
            ? `Generation timed out after ${timeoutSeconds}s. Increase shiplogue.generate.timeoutSeconds, or use a smaller/faster model.`
            : "Cancelled.",
        );
      }
    } else if (epoch === generationEpoch) {
      void analytics?.track("generation.failed", {
        category: e?.userFacing === true ? "backend" : "unexpected",
        durationMs: Date.now() - started,
        phase,
      });
      // Adapter/backend errors are written for humans; anything else is
      // unexpected and gets a prefix so it isn't mistaken for advice.
      const msg = e?.userFacing === true ? e.message : `Something went wrong: ${e.message ?? e}`;
      panel.setError(msg);
    }
  } finally {
    clearInterval(tick);
    if (timeout) {
      clearTimeout(timeout);
    }
    if (inFlight === controller) {
      inFlight = undefined;
    }
  }
}

let cloudWarningShown = false;

async function syncDraftToCloud(markdown: string, modelLabel?: string): Promise<void> {
  if (!cloud) return;
  const result = await cloud.syncStandup({ markdown, modelLabel });
  if (result.status === "synced") {
    void analytics?.track("sync.succeeded", {});
    return;
  }
  if (result.status !== "failed") return;
  void analytics?.track("sync.failed", { category: "cloud" });
  console.warn(`[shiplogue] cloud sync failed: ${result.error}`);
  if (cloudWarningShown) return;
  cloudWarningShown = true;
  const action = await vscode.window.showWarningMessage(
    `Stand-up saved locally, but cloud sync failed: ${result.error}`,
    "Cloud status",
  );
  if (action === "Cloud status") await cloudStatus();
}

// Human label for the panel's "via …" badge.
function backendLabel(meta: BackendMeta): string {
  if (meta.kind === "provider") {
    const name = meta.provider
      ? providerDisplayName(meta.provider as ActiveProviderType)
      : "Provider";
    return `${name} · ${meta.model}`;
  }
  if (meta.kind === "ollama") {
    return `Ollama · ${meta.model}`;
  }
  return `Local model · ${meta.model}`;
}

// Short note under the Copy button: "done with OpenAI BYOK", "done with Ollama".
function backendNote(meta: BackendMeta): string {
  if (meta.kind === "provider") {
    const name = meta.provider
      ? providerDisplayName(meta.provider as ActiveProviderType)
      : "Provider";
    return `${name} BYOK`;
  }
  if (meta.kind === "ollama") {
    return "Ollama";
  }
  return "Local model";
}

// First-run health check: ping Ollama and verify the configured model is
// pulled. Fire-and-forget from activate() — a slow or down server must never
// delay or break activation, so every path is caught.
async function checkOllamaHealth(): Promise<void> {
  try {
    const c = cfg();
    // Only probe Ollama when it is the backend that would actually be used.
    // A configured provider must not trigger an "Ollama isn't running" warning.
    if (c.modelBackend === "provider") {
      return;
    }
    if (c.modelBackend === "auto" && (await loadProviderConfig())) {
      return;
    }
    let models: string[];
    try {
      const res = await fetch(`${c.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      const data = (await res.json()) as { models?: { name: string }[] };
      models = (data.models ?? []).map((m) => m.name);
    } catch {
      const pick = await vscode.window.showWarningMessage(
        "Shiplogue: Ollama isn't running — stand-ups can't be generated until it is.",
        "How to install",
        "Dismiss",
      );
      if (pick === "How to install") {
        void vscode.env.openExternal(vscode.Uri.parse("https://ollama.com"));
      }
      return;
    }

    // Match with or without the implicit ":latest" tag Ollama adds.
    const stripLatest = (n: string) => n.replace(/:latest$/, "");
    const want = c.ollamaModel;
    if (models.some((m) => m === want || stripLatest(m) === stripLatest(want))) {
      return;
    }
    const pick = await vscode.window.showWarningMessage(
      `Shiplogue: model '${want}' isn't pulled in Ollama yet.`,
      "Pull now",
      "Pick another model",
      "Dismiss",
    );
    if (pick === "Pull now") {
      const term = vscode.window.createTerminal("Shiplogue: ollama pull");
      term.show();
      term.sendText(`ollama pull ${want}`);
    } else if (pick === "Pick another model") {
      const choice = await vscode.window.showQuickPick(models, {
        placeHolder: "Use which installed Ollama model?",
      });
      if (choice) {
        await vscode.workspace
          .getConfiguration("shiplogue")
          .update("ollama.model", choice, vscode.ConfigurationTarget.Global);
      }
    }
  } catch {
    /* health check must never break activation */
  }
}

// Extension-side update check: compare the running version against the latest
// published listing (Marketplace + Open VSX) and notify once per version. The
// editor's own auto-update handles gallery installs; this covers manual VSIX
// installs and takes the user to the right place when they need to act.
// Never throws.
async function runUpdateCheck(context: vscode.ExtensionContext, force = false): Promise<void> {
  try {
    if (!cfg().updateEnabled && !force) return;
    const result = await checkForUpdate(context);
    if (!result.updateAvailable) {
      if (force) {
        await vscode.window.showInformationMessage(
          `Shiplogue is up to date (v${result.currentVersion}).`,
        );
      }
      return;
    }
    const latest = result.latestVersion;
    if (!latest) return;
    if (!force && state.getUpdatePromptedVersion() === latest) return;
    await state.setUpdatePromptedVersion(latest);

    const action = await vscode.window.showInformationMessage(
      `Shiplogue v${latest} is available (you're using v${result.currentVersion}).`,
      "Update now",
      "Open listing",
      "Enable auto-update",
    );
    const listing =
      result.source === "openvsx" ||
      /cursor|antigravity|vscodium|windsurf/i.test(vscode.env?.appName ?? "")
        ? OPEN_VSX_URL
        : MARKETPLACE_URL;

    if (action === "Update now") {
      try {
        // Asks the host's gallery to install the latest build. Works for
        // Marketplace/Open VSX installs; a manual VSIX may prompt or open the
        // extension page instead.
        await vscode.commands.executeCommand("workbench.extensions.installExtension", EXTENSION_ID);
      } catch {
        void vscode.env.openExternal(vscode.Uri.parse(listing));
      }
    } else if (action === "Open listing") {
      void vscode.env.openExternal(vscode.Uri.parse(listing));
    } else if (action === "Enable auto-update") {
      // The extension cannot change this setting itself; open the exact toggle.
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        AUTO_UPDATE_SETTINGS_QUERY,
      );
    }
  } catch {
    /* update check must never break activation */
  }
}

async function runShowActivity(): Promise<void> {  const ctx = await gatherContext(store);
  const doc = await vscode.workspace.openTextDocument({
    content:
      `# Shiplogue activity (last ${cfg().lookbackHours}h)\n` +
      `# ${ctx.since.toISOString()} → ${ctx.until.toISOString()}\n\n` +
      contextToText(ctx),
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc);
}

export function deactivate() {
  tracker?.dispose();
  promptWatcher?.dispose();
  reminder?.dispose();
  void analytics?.dispose();
  analytics = undefined;
  store?.flush();
}
