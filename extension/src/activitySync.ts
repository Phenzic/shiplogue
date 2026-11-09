import * as vscode from "vscode";
import * as crypto from "crypto";
import { cfg } from "./config";
import type { CloudClient } from "./cloud";
import { Store } from "./store";
import { currentEditorSource } from "./sources";
import { normalizeFolderPath } from "./paths";
import { gatherContext } from "./gather";
import { collectCommitActivity } from "./git";
import type { DraftHistory } from "./draftHistory";

const LAST_SYNC_KEY = "shiplogue.activitySync.lastAt";
const WARNED_KEY = "shiplogue.activitySync.warned";

/**
 * Opt-in, metadata-only activity sync. Paths, event type, project, timestamp and
 * source are uploaded. File contents, prompts and terminal output never leave
 * the machine.
 */
export class ActivitySync {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: Store,
    private readonly cloud: CloudClient,
    private readonly history: DraftHistory,
  ) {}

  start(): void {
    this.schedule(8_000);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().finally(() => this.schedule(5 * 60_000));
    }, delay);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.running || !cfg().activitySyncEnabled) return;
    if (!(await this.cloud.hasKey())) return;
    this.running = true;
    try {
      const last = this.context.globalState.get<string>(LAST_SYNC_KEY);
      const since = last ? new Date(new Date(last).getTime() - 5 * 60_000) : new Date(Date.now() - 30 * 24 * 60 * 60_000);
      const until = new Date();
      const localEvents = this.store.readRange(since, until).map((event) => {
          const id = crypto
            .createHash("sha256")
            .update(`${event.projectPath ?? event.project}|${event.file}|${event.ts}|${event.type}`)
            .digest("hex")
            .slice(0, 40);
          const projectPath = event.projectPath ? normalizeFolderPath(event.projectPath) : event.project;
          const localWorkspaceId = projectPath
            ? crypto.createHash("sha1").update(projectPath).digest("hex").slice(0, 20)
            : undefined;
          return {
            id,
            source: currentEditorSource(),
            type: "file_edit",
            occurredAt: event.ts,
            title: `${event.type === "save" ? "Saved" : "Edited"} ${event.file}`,
            summary: event.file,
            project: event.project,
            ...(localWorkspaceId ? { localWorkspaceId } : {}),
            files: [{ path: event.file }],
            producer: "shiplogue-extension",
            aiAssisted: false,
            metadata: { language: event.lang, action: event.type },
          };
        });

      const extra: Record<string, unknown>[] = [];
      try {
        for (const commit of await collectCommitActivity(since, until)) {
          extra.push({
            id: `commit:${commit.repo}:${commit.hash}`,
            source: "git",
            type: "commit",
            occurredAt: commit.date || new Date().toISOString(),
            title: commit.subject,
            summary: commit.body || undefined,
            project: commit.repo,
            files: commit.files,
            producer: "git",
            aiAssisted: false,
            metadata: { hash: commit.hash, repo: commit.repo },
          });
        }
      } catch {
        /* commit history collection is best effort */
      }
      try {
        const ctx = await gatherContext(this.store);
        for (const item of ctx.github) {
          extra.push({
            id: `github:${item.kind}:${item.number}:${item.url}`,
            source: "github",
            type: "github",
            occurredAt: new Date().toISOString(),
            title: `${item.kind === "pr" ? "Merged PR" : "Closed issue"} #${item.number}: ${item.title}`,
            producer: "github",
            aiAssisted: false,
            metadata: { url: item.url, kind: item.kind },
          });
        }
        const sessions = new Map<string, { source: string; first: string; last: string; count: number }>();
        for (const prompt of ctx.cursorPrompts) {
          const source = prompt.source ?? "ai";
          const existing = sessions.get(source);
          if (existing) {
            existing.count++;
            if (prompt.ts < existing.first) existing.first = prompt.ts;
            if (prompt.ts > existing.last) existing.last = prompt.ts;
          } else {
            sessions.set(source, { source, first: prompt.ts, last: prompt.ts, count: 1 });
          }
        }
        for (const prompt of ctx.cursorPrompts) {
          const source = prompt.source ?? "ai";
          extra.push({
            id: `prompt:${source}:${prompt.ts}:${prompt.text.length}`,
            source,
            type: "prompt",
            occurredAt: prompt.ts,
            title: `${source} prompt`,
            producer: "ai-session",
            aiAssisted: true,
            metadata: { characters: prompt.text.length },
          });
        }
        for (const [source, session] of sessions) {
          extra.push({
            id: `session:${source}:${session.first.slice(0, 10)}:${session.first}:${session.last}`,
            source,
            type: "session",
            occurredAt: session.last,
            title: `${source} session · ${session.count} prompt${session.count === 1 ? "" : "s"}`,
            producer: "ai-session",
            aiAssisted: true,
            metadata: { prompts: session.count, firstAt: session.first, lastAt: session.last },
          });
        }
      } catch {
        /* source collection is best effort */
      }

      for (const entry of this.history.list({ limit: 50 }).entries) {
        if (entry.ts < since.toISOString() || entry.ts > until.toISOString()) continue;
        if (!entry.stats?.inputTokens && !entry.stats?.outputTokens) continue;
        extra.push({
          id: `draft:${entry.id}`,
          source: "shiplogue",
          type: "session",
          occurredAt: entry.ts,
          title: `Stand-up generated — ${entry.modelLabel ?? "local model"}`,
          producer: entry.modelLabel ?? "shiplogue",
          aiAssisted: true,
          tokens: {
            ...(entry.stats.inputTokens ? { input: entry.stats.inputTokens } : {}),
            ...(entry.stats.outputTokens ? { output: entry.stats.outputTokens } : {}),
          },
          metadata: { draftId: entry.id, durationMs: entry.stats.durationMs },
        });
      }

      const events = [...localEvents, ...extra];
      for (let i = 0; i < events.length; i += 100) {
        const batch = events.slice(i, i + 100);
        const response = await fetch(`${this.cloud.baseUrl}/api/v1/events`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await this.cloud.getKey()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ events: batch }),
          signal: AbortSignal.timeout(15_000),
        });
        if (response.status === 403) {
          if (!this.context.globalState.get<boolean>(WARNED_KEY)) {
            await this.context.globalState.update(WARNED_KEY, true);
            void vscode.window.showInformationMessage(
              "Activity sync is off for this project. Enable activity sync when creating the project key.",
            );
          }
          return;
        }
        if (!response.ok) throw new Error(`Activity sync failed (${response.status}).`);
      }
      await this.context.globalState.update(LAST_SYNC_KEY, until.toISOString());
    } catch {
      // Retry on the next interval; never interrupt generation.
    } finally {
      this.running = false;
    }
  }
}
