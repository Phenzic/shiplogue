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
import { StandupPanel } from "./standupPanel";
import { setSecretStorage } from "./model/secrets";
import { loadProviderConfig, providerDisplayName } from "./model/registry";
import { BackendMeta } from "./model/types";
import { clearProviderKey, setProviderKey, testProvider } from "./commands/providerKeys";
import { ActiveProviderType } from "./core/providers";

let store: Store;
let state: State;
let tracker: Tracker | undefined;
let reminder: Reminder | undefined;

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
  // Provider keys live only in SecretStorage (OS keychain). Guard because a
  // few hosts (and the test stub) do not implement it.
  if (context.secrets) {
    setSecretStorage(context.secrets);
  }
  store.pruneOld(cfg().storeRetentionDays);

  // Migrate a previously saved workspace setting into globalState once.
  if (!state.hasDetail()) {
    const insp = vscode.workspace
      .getConfiguration("standup")
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

  reminder = new Reminder(state, () => void runGenerate());
  void reminder.ensureSetup().then(() => reminder?.start());

  // Fire-and-forget first-run check: surface Ollama problems at startup with a
  // fix path, instead of letting the first Generate fail. Never blocks
  // activation and never throws.
  healthCheckDone = checkOllamaHealth();
  void healthCheckDone;

  context.subscriptions.push(
    vscode.commands.registerCommand("standup.generate", () => runGenerate()),
    vscode.commands.registerCommand("standup.showActivity", () => runShowActivity()),
    vscode.commands.registerCommand("standup.setProviderKey", () => setProviderKey()),
    vscode.commands.registerCommand("standup.clearProviderKey", () => clearProviderKey()),
    vscode.commands.registerCommand("standup.testProvider", () => testProvider()),
    vscode.commands.registerCommand("standup.setReminderTime", () =>
      reminder?.pickTime("What time should Standup remind you daily? (24h, local)"),
    ),
    vscode.commands.registerCommand("standup.connectGitHub", async () => {
      const token = await githubToken(true);
      vscode.window.showInformationMessage(
        token ? "GitHub connected — issues & PRs will be included." : "GitHub sign-in was cancelled.",
      );
    }),
  );
}

async function runGenerate(): Promise<void> {
  const panel = StandupPanel.show(
    () => void runGenerate(),
    state,
    () => inFlight?.abort(),
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
          `No activity found in the last ${cfg().lookbackHours}h. Commit some work, or increase standup.lookbackHours.`,
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
        ...(backend ? { modelLabel: backendLabel(backend) } : {}),
      });
    }
  } catch (e: any) {
    if (controller.signal.aborted) {
      // Only the current run may announce its cancellation; superseded runs
      // stay silent because the newer run already owns the panel.
      if (epoch === generationEpoch) {
        panel.setCancelled(
          timedOut
            ? `Generation timed out after ${timeoutSeconds}s. Increase standup.generate.timeoutSeconds, or use a smaller/faster model.`
            : "Cancelled.",
        );
      }
    } else if (epoch === generationEpoch) {
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

// First-run health check: ping Ollama and verify the configured model is
// pulled. Fire-and-forget from activate() — a slow or down server must never
// delay or break activation, so every path is caught.
async function checkOllamaHealth(): Promise<void> {
  try {
    const c = cfg();
    // Only probe Ollama when it is the backend that would actually be used.
    // A configured provider must not trigger an "Ollama isn't running" warning.
    if (c.modelBackend === "provider" || c.modelBackend === "local") {
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
        "Standup: Ollama isn't running — stand-ups can't be generated until it is.",
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
      `Standup: model '${want}' isn't pulled in Ollama yet.`,
      "Pull now",
      "Pick another model",
      "Dismiss",
    );
    if (pick === "Pull now") {
      const term = vscode.window.createTerminal("Standup: ollama pull");
      term.show();
      term.sendText(`ollama pull ${want}`);
    } else if (pick === "Pick another model") {
      const choice = await vscode.window.showQuickPick(models, {
        placeHolder: "Use which installed Ollama model?",
      });
      if (choice) {
        await vscode.workspace
          .getConfiguration("standup")
          .update("ollama.model", choice, vscode.ConfigurationTarget.Global);
      }
    }
  } catch {
    /* health check must never break activation */
  }
}

async function runShowActivity(): Promise<void> {  const ctx = await gatherContext(store);
  const doc = await vscode.workspace.openTextDocument({
    content:
      `# Standup activity (last ${cfg().lookbackHours}h)\n` +
      `# ${ctx.since.toISOString()} → ${ctx.until.toISOString()}\n\n` +
      contextToText(ctx),
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc);
}

export function deactivate() {
  tracker?.dispose();
  reminder?.dispose();
  store?.flush();
}
