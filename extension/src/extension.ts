import * as vscode from "vscode";
import * as crypto from "crypto";
import { Store } from "./store";
import { StandupStore } from "./standupStore";
import { Tracker } from "./tracker";
import { State } from "./state";
import { Reminder } from "./reminder";
import { cfg, setDetailGetter, setToneGetter } from "./config";
import { gatherContext, contextToText } from "./gather";
import { generateStandup } from "./summarize";
import { githubToken } from "./github";
import { buildReferences, extractSection } from "./format";
import { getFormatSections } from "./formatProfile";
import { ShiploguePanel } from "./shiploguePanel";
import { DraftEntry, DraftHistory } from "./draftHistory";
import { CloudDraftSync, getDraftSync, setDraftSync } from "./draftHistorySync";
import { Feedback, openFeedback, openRate, openStar } from "./feedback";
import { refreshDelivery } from "./delivery";
import { toPanelVerification } from "./panelVerification";
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
import { localDateKey, type CloudClient } from "./cloud";
import { Analytics, initAnalytics } from "./analytics";
import { activeWorkspace } from "./workspaces";
import { WeeklyRecapScheduler } from "./weeklyRecap";
import { sourcesForContext } from "./sources";
import type { StandupCoverage } from "./types";
import { PromptWatcher } from "./promptWatcher";
import { ActivitySync } from "./activitySync";
import { ActiveProviderType } from "./core/providers";

let store: Store;
let history: StandupStore;
let draftHistory: DraftHistory;
let state: State;
let tracker: Tracker | undefined;
let promptWatcher: PromptWatcher | undefined;
let reminder: Reminder | undefined;
let cloud: CloudClient | undefined;
let analytics: Analytics | undefined;
let weeklyRecap: WeeklyRecapScheduler | undefined;
let activitySync: ActivitySync | undefined;
const cloudHistoryCache = new Map<string, DraftEntry>();
let feedback: Feedback;

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
  history = new StandupStore(context);
  draftHistory = new DraftHistory(context);
  draftHistory.prune();
  ShiploguePanel.init(context);
  state = new State(context);
  cloud = initCloud(context);
  void refreshDelivery(cloud).then((d) => ShiploguePanel.updateDelivery(d));
  feedback = new Feedback(state, context.extension?.packageJSON?.version ?? "0.0.0");
  // Refresh a cached paid format profile in the background; offline/expired
  // keys simply keep the last validated profile (or the built-in format).
  void cloud
    .me()
    .then((me) => {
      if (cloud && me.workspace.features?.history) setDraftSync(new CloudDraftSync(cloud));
    })
    .catch(() => {});
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
  activitySync = new ActivitySync(context, store, cloud, draftHistory);
  activitySync.start();

  // Continuous prompt capture across Cursor/VS Code/Antigravity-compatible
  // hosts. The watcher is silent; failures never block activation.
  promptWatcher = new PromptWatcher();
  promptWatcher.start();

  reminder = new Reminder(state, () => void runGenerate("reminder"));
  void reminder.ensureSetup().then(() => reminder?.start());

  weeklyRecap = new WeeklyRecapScheduler(context, history, draftHistory, async () => {
    const action = await vscode.window.showInformationMessage(
      "Your weekly recap is ready.",
      "View recap",
      "Dismiss",
    );
    if (action === "View recap") await showHistory();
  });
  weeklyRecap.start();

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
    vscode.commands.registerCommand("shiplogue.generateWeeklyRecap", async () => {
      const entry = await weeklyRecap?.generateNow();
      if (!entry) {
        await vscode.window.showInformationMessage(
          "No daily drafts from the last seven days yet. Generate a stand-up first.",
        );
        return;
      }
      await showHistory();
    }),
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
    vscode.commands.registerCommand("shiplogue.feedback", () => openFeedback()),
    vscode.commands.registerCommand("shiplogue.star", () => openStar()),
    vscode.commands.registerCommand("shiplogue.rate", () => openRate()),
    vscode.commands.registerCommand("shiplogue.showHistory", () => void showHistory()),
    vscode.commands.registerCommand("shiplogue.connectGitHub", async () => {
      const token = await githubToken(true);
      vscode.window.showInformationMessage(
        token ? "GitHub connected — issues & PRs will be included." : "GitHub sign-in was cancelled.",
      );
    }),
  );
}

function buildCoverage(ctx: {
  since: Date;
  until: Date;
  commits: { files: string[] }[];
  touches: { file: string }[];
  github: { kind: "issue" | "pr" }[];
  agentSessions?: { source: string; prompts: number }[];
  uncommittedFiles?: string[];
  diffStats?: { additions: number; deletions: number };
}): StandupCoverage {
  const commitFiles = new Set<string>();
  for (const commit of ctx.commits) {
    for (const file of commit.files) commitFiles.add(file);
  }
  const bySource: Record<string, number> = {};
  for (const session of ctx.agentSessions ?? []) {
    bySource[session.source] = (bySource[session.source] ?? 0) + session.prompts;
  }
  return {
    window: {
      kind: "calendar-day",
      start: ctx.since.toISOString(),
      end: ctx.until.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    git: { commits: ctx.commits.length, files: commitFiles.size, ...(ctx.diffStats ?? {}) },
    ide: { touchedFiles: ctx.touches.length },
    github: {
      prs: ctx.github.filter((item) => item.kind === "pr").length,
      issues: ctx.github.filter((item) => item.kind === "issue").length,
      items: ctx.github.length,
    },
    agents: {
      sessions: ctx.agentSessions?.length ?? 0,
      prompts: ctx.agentSessions?.reduce((count, session) => count + session.prompts, 0) ?? 0,
      bySource,
    },
    uncommitted: { files: ctx.uncommittedFiles?.length ?? 0 },
  };
}

function changedFileCount(ctx: { commits: { files: string[] }[]; touches: { file: string }[] }): number {
  const files = new Set<string>();
  for (const commit of ctx.commits) {
    for (const file of commit.files) files.add(file.replace(/^[/]/, ""));
  }
  for (const touch of ctx.touches) files.add(touch.file);
  return files.size;
}

async function runGenerate(
  reason: "manual" | "regenerate" | "reminder" = "manual",
): Promise<void> {
  const local = cfg().scope === "workspace" ? activeWorkspace() : undefined;
  const panel = openPanel(local);
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
    const ctx = await gatherContext(store, {
      signal: controller.signal,
      onPhase: setPhase,
      ...(local ? { folder: local.folder } : {}),
    });
    const previous = history?.getYesterday(local?.id);
    if (previous) {
      const sections = getFormatSections();
      const todayLabel = sections.find((section) => section.key === "today")?.label ?? "Today";
      const previousToday =
        extractSection(previous.markdown, [todayLabel, "Today", "Done"]) ?? previous.markdown;
      ctx.previousStandup = {
        date: previous.date,
        // Feed only yesterday's main/Today section; the prompt condenses it to
        // 1-2 bullets instead of copying a whole daily draft.
        markdown: previousToday,
        ...(previous.projectName ? { projectName: previous.projectName } : {}),
      };
    }
    if (
      !ctx.commits.length &&
      !ctx.github.length &&
      !ctx.touches.length &&
      !ctx.cursorPrompts.length &&
      !previous
    ) {
      if (epoch === generationEpoch) {
        panel.setError(
          `No activity found today. Commit some work, then generate again.`,
        );
      }
      return;
    }
    setPhase("Writing your stand-up…");
    const {
      text: draft,
      warnings,
      backend,
      verification,
      document,
      quality,
    } = await generateStandup(ctx, controller.signal);
    if (controller.signal.aborted) {
      throw new DOMException("Generation aborted", "AbortError");
    }
    const sources = sourcesForContext(ctx.cursorPrompts);
    const coverage = buildCoverage(ctx);
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
      const modelLabel = backend ? backendLabel(backend) : undefined;
      const generatedAt = new Date().toISOString();
      const panelVerification = verification ? toPanelVerification(verification) : undefined;
      let draftEntry;
      try {
        draftEntry = draftHistory?.add({
          ts: generatedAt,
          markdown,
          detail: cfg().detail,
          tone: cfg().tone,
          ...(local?.name ? { projectName: local.name } : {}),
          ...(modelLabel ? { modelLabel } : {}),
          ...(sources.length ? { sources } : {}),
          coverage,
          ...(document ? { document } : {}),
          ...(quality ? { quality } : {}),
          ...(panelVerification ? { verification: panelVerification } : {}),
          windowHours: Math.max(1, Math.round((ctx.until.getTime() - ctx.since.getTime()) / 3600_000)),
          summary: {
            commits: ctx.commits.length,
            files: changedFileCount(ctx),
            github: ctx.github.length,
            ...(notes.length ? { notes } : {}),
          },
          stats: {
            durationMs: Date.now() - started,
            ...(backend?.inputTokens ? { inputTokens: backend.inputTokens } : {}),
            ...(backend?.outputTokens ? { outputTokens: backend.outputTokens } : {}),
          },
        });
      } catch {
        /* the history log must never block the draft */
      }
      let record;
      try {
        record = history?.saveGenerated(markdown, {
          ...(local?.id ? { workspaceId: local.id } : {}),
          ...(local?.name ? { projectName: local.name } : {}),
          ...(modelLabel ? { modelLabel } : {}),
          ...(sources.length ? { sources } : {}),
          coverage,
          ...(document ? { document } : {}),
          ...(quality ? { quality } : {}),
          summary: {
            commits: ctx.commits.length,
            files: changedFileCount(ctx),
            github: ctx.github.length,
            ...(notes.length ? { notes } : {}),
          },
        });
      } catch {
        /* local history must never block the draft */
      }
      panel.setDraft({
        markdown,
        summary: {
          commits: ctx.commits.length,
          files: changedFileCount(ctx),
          github: ctx.github.length,
          ...(notes.length ? { notes } : {}),
        },
        ...(warnings.length ? { warnings } : {}),
        ...(modelLabel && backend ? { modelLabel, modelNote: backendNote(backend) } : {}),
        ...(local ? { projectName: local.name } : {}),
        ...(panelVerification ? { verification: panelVerification } : {}),
        ...(draftEntry ? { draftId: draftEntry.id } : {}),
        coverage,
        ...(document ? { document } : {}),
        ...(quality ? { quality } : {}),
        windowHours: Math.max(1, Math.round((ctx.until.getTime() - ctx.since.getTime()) / 3600_000)),
        generatedAt,
        stats: {
          durationMs: Date.now() - started,
          ...(backend?.inputTokens ? { inputTokens: backend.inputTokens } : {}),
          ...(backend?.outputTokens ? { outputTokens: backend.outputTokens } : {}),
        },
      });
      void feedback.recordSuccess(modelLabel ?? "unknown");
      void analytics?.track("standup.generated", {
        trigger: reason,
        durationMs: Date.now() - started,
        commits: ctx.commits.length,
        files: changedFileCount(ctx),
        github: ctx.github.length,
        warnings: warnings.length,
        backend: backend?.kind ?? "none",
        detail: cfg().detail,
        tone: cfg().tone,
      });
      if (reason === "regenerate") {
        void analytics?.track("standup.regenerated", { trigger: "panel" });
      }
      void syncDraftToCloud(
        record?.markdown ?? markdown,
        record?.modelLabel ?? modelLabel,
        local,
        sources,
        coverage,
        record?.document,
        record?.quality ?? quality,
      );
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

// One place that builds the panel callbacks, shared by generate, weekly recap
// and the history command.
function openPanel(local: { id: string; name: string } | undefined): ShiploguePanel {
  let panel!: ShiploguePanel;
  panel = ShiploguePanel.show(
    {
      onRegenerate: () => void runGenerate("regenerate"),
      onCancel: () => inFlight?.abort(),
      onCopy: (format, text, draftId) => {
        void analytics?.track("standup.copied", { format });
        if (!text.trim()) return;
        if (draftId) {
          try {
            draftHistory?.markCopied(draftId);
          } catch {
            /* history bookkeeping must never block copying */
          }
        }
        try {
          const copiedEntry = draftId ? draftHistory.get(draftId) : undefined;
          const record = history?.markReviewed(text, {
            ...(local?.id ? { workspaceId: local.id } : {}),
            ...(local?.name ? { projectName: local.name } : {}),
            ...(copiedEntry?.coverage ? { coverage: copiedEntry.coverage } : {}),
            ...(copiedEntry?.document ? { document: copiedEntry.document } : {}),
            ...(copiedEntry?.quality ? { quality: copiedEntry.quality } : {}),
            ...(copiedEntry?.summary ? { summary: copiedEntry.summary } : {}),
          });
          if (record) {
            void syncDraftToCloud(
              record.markdown,
              record.modelLabel,
              local,
              record.sources,
              copiedEntry?.coverage,
              record.document,
              record.quality,
            );
          }
        } catch {
          /* local history must never block copying */
        }
      },
      onHistoryRequest: (opts) => {
        const sync = getDraftSync();
        if (sync.isEnabled()) {
          void sync
            .fetchPage({ cursor: opts.cursor, limit: 20 })
            .then((page) => {
              page.entries.forEach((entry) => cloudHistoryCache.set(entry.id, entry));
              panel.setHistoryPage({
                entries: page.entries,
                cursor: page.cursor,
                append: Boolean(opts.cursor),
              });
            })
            .catch(() => {
              try {
                const page = draftHistory.list({ ...opts, limit: 20 });
                panel.setHistoryPage({
                  entries: page.entries,
                  cursor: page.cursor,
                  append: Boolean(opts.cursor),
                });
              } catch {
                panel.setNote("Could not load draft history.");
              }
            });
          return;
        }
        try {
          const page = draftHistory.list({ ...opts, limit: 20 });
          panel.setHistoryPage({
            entries: page.entries,
            cursor: page.cursor,
            append: Boolean(opts.cursor),
          });
        } catch {
          panel.setNote("Could not load draft history.");
        }
      },
      onRestore: (id) => {
        const entry = draftHistory.get(id) ?? cloudHistoryCache.get(id);
        if (!entry) {
          panel.setNote("That draft is no longer available on this device.");
          return;
        }
        panel.setDraft({
          markdown: entry.markdown,
          summary: entry.summary ?? { commits: 0, files: 0, github: 0 },
          ...(entry.verification ? { verification: entry.verification } : {}),
          ...(entry.modelLabel ? { modelLabel: entry.modelLabel } : {}),
          ...(entry.projectName ? { projectName: entry.projectName } : {}),
          draftId: entry.id,
          generatedAt: entry.ts,
          ...(entry.windowHours ? { windowHours: entry.windowHours } : {}),
          ...(entry.coverage ? { coverage: entry.coverage } : {}),
          ...(entry.document ? { document: entry.document } : {}),
          ...(entry.quality ? { quality: entry.quality } : {}),
          ...(entry.stats ? { stats: entry.stats } : {}),
        });
        panel.setNote("Restored from history — review before copying.");
      },
      onSyncStored: (id) => {
        const entry = draftHistory.get(id) ?? cloudHistoryCache.get(id);
        if (!entry) {
          panel.setNote("That draft is no longer available on this device.");
          return;
        }
        void syncStoredViaCloud(panel, entry, local);
      },
      onSend: (draftId, markdown) => {
        void sendViaCloud(panel, draftId, markdown, local);
      },
      onFeedback: (value, backend) => {
        void feedback.recordThumbs(value, backend);
        panel.setNote(value === "up" ? "Thanks! Glad it helped." : "Thanks — the feedback form is open.");
      },
    },
    state,
    local?.name,
  );
  return panel;
}

// Push a fresh history page into the panel (used after restores/sends too).
function pushHistoryPage(panel: ShiploguePanel, opts: { query?: string; cursor?: string } = {}): void {
  try {
    const page = draftHistory.list({ ...opts, limit: 20 });
    panel.setHistoryPage({ entries: page.entries, cursor: page.cursor, append: Boolean(opts.cursor) });
  } catch {
    panel.setNote("Could not load draft history.");
  }
}

// History "Sync" = push a stored draft to Shiplogue Cloud without posting it to
// connected targets. The draft view's Send button is the one that asks the cloud
// to deliver to Slack/Discord/Teams.
async function syncStoredViaCloud(
  panel: ShiploguePanel,
  entry: DraftEntry,
  local: { id: string; name: string } | undefined,
): Promise<void> {
  if (!cloud) return;
  if (!(await cloud.hasKey())) {
    const pick = await vscode.window.showInformationMessage(
      "Sync needs a Shiplogue Cloud connector key. Connect one to store this draft online.",
      "Connect Cloud",
    );
    if (pick === "Connect Cloud") await connectCloud();
    return;
  }

  const standupDate = localDateKey(new Date(entry.ts));
  panel.setNote("Syncing via Shiplogue Cloud…");
  const result = await cloud.syncStandup({
    markdown: entry.markdown,
    standupDate,
    title: entry.title ?? `Standup for ${standupDate}`,
    ...(entry.modelLabel ? { modelLabel: entry.modelLabel } : {}),
    ...(entry.sources?.length ? { sources: entry.sources } : {}),
    ...(entry.coverage ? { coverage: entry.coverage } : {}),
    ...(entry.document ? { document: entry.document } : {}),
    ...(entry.quality ? { quality: entry.quality } : {}),
    ...(local ? { localWorkspaceId: local.id, localWorkspaceName: local.name } : {}),
  });
  if (result.status === "synced") {
    panel.setNote("Synced to Shiplogue Cloud.");
    vscode.window.showInformationMessage("Draft synced to Shiplogue Cloud.");
    return;
  }
  panel.setNote(
    result.status === "failed"
      ? `Sync failed: ${result.error}`
      : "Cloud sync is unavailable. Enable it in settings first.",
  );
}

// Send = ask Shiplogue Cloud to post the stand-up (Pro, cloud-side). The
// extension never contacts Slack/Discord/Teams directly.
async function sendViaCloud(
  panel: ShiploguePanel,
  draftId: string | undefined,
  markdown: string,
  local: { id: string; name: string } | undefined,
  cachedEntry?: DraftEntry,
): Promise<void> {
  if (!cloud) return;
  if (!(await cloud.hasKey())) {
    const pick = await vscode.window.showInformationMessage(
      "Connect a Shiplogue project key to sync and review this stand-up in the cloud.",
      "Connect Cloud",
    );
    if (pick === "Connect Cloud") await connectCloud();
    return;
  }

  const entry = cachedEntry ?? (draftId ? draftHistory.get(draftId) : undefined);
  panel.setNote("Syncing this stand-up to Shiplogue Cloud…");
  const synced = await cloud.syncStandup({
    markdown,
    ...(entry?.modelLabel ? { modelLabel: entry.modelLabel } : {}),
    ...(entry?.sources?.length ? { sources: entry.sources } : {}),
    ...(entry?.coverage ? { coverage: entry.coverage } : {}),
    localWorkspaceId: local?.id,
    localWorkspaceName: local?.name,
    ...(local ? { title: `Standup for ${localDateKey()} — ${local.name}` } : {}),
  });
  if (synced.status !== "synced") {
    panel.setNote(
      synced.status === "failed"
        ? `Shiplogue Cloud: ${synced.error}`
        : "Shiplogue Cloud sync is unavailable. Enable it in settings first.",
    );
    return;
  }

  panel.setNote("Compiling the project story in Shiplogue Cloud…");
  try {
    await cloud.compileProject(localDateKey());
  } catch {
    /* The review page can retry compilation. */
  }
  const url = await cloud.reviewUrl(localDateKey());
  panel.setNote("Synced. Review and confirm the project stand-up in Shiplogue Cloud.");
  if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
}

let cloudWarningShown = false;

async function syncDraftToCloud(
  markdown: string,
  modelLabel?: string,
  local?: { id: string; name: string },
  sources?: string[],
  coverage?: StandupCoverage,
  document?: import("./standupDocument").StandupDocument,
  quality?: import("./standupQuality").StandupQuality,
): Promise<void> {
  if (!cloud) return;
  const result = await cloud.syncStandup({
    markdown,
    modelLabel,
    ...(local ? { localWorkspaceId: local.id, localWorkspaceName: local.name } : {}),
    ...(sources && sources.length ? { sources } : {}),
    ...(coverage ? { coverage } : {}),
    ...(document ? { document } : {}),
    ...(quality ? { quality } : {}),
    ...(local ? { title: `Standup for ${localDateKey()} — ${local.name}` } : {}),
  });
  if (result.status === "synced") {
    void analytics?.track("sync.succeeded", {});
    if (result.standupId) {
      void cloud
        .createRevision({
          standupId: result.standupId,
          bodyMarkdown: markdown,
          ...(modelLabel ? { model: modelLabel } : {}),
          ...(sources?.length ? { sources } : {}),
        })
        .catch(() => {
          /* revisions are a Pro extra; the canonical draft is already synced */
        });
    }
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

async function showHistory(): Promise<void> {
  const local = cfg().scope === "workspace" ? activeWorkspace() : undefined;
  const panel = openPanel(local);
  panel.showHistoryView();
}

async function runShowActivity(): Promise<void> {
  const ctx = await gatherContext(store);
  const doc = await vscode.workspace.openTextDocument({
    content:
      `# Shiplogue activity (today)\n` +
      `# ${ctx.since.toISOString()} → ${ctx.until.toISOString()}\n\n` +
      contextToText(ctx),
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc);
}

export function deactivate() {
  tracker?.dispose();
  activitySync?.dispose();
  promptWatcher?.dispose();
  reminder?.dispose();
  weeklyRecap?.dispose();
  weeklyRecap = undefined;
  void analytics?.dispose();
  analytics = undefined;
  store?.flush();
}
