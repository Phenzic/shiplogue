import * as vscode from "vscode";
import * as crypto from "crypto";
import { cfg } from "./config";
import type { CloudClient } from "./cloud";
import { Store } from "./store";
import { currentEditorSource } from "./sources";
import { normalizeFolderPath } from "./paths";

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
  }

  async flush(): Promise<void> {
    if (this.running || !cfg().activitySyncEnabled) return;
    if (!(await this.cloud.hasKey())) return;
    this.running = true;
    try {
      const last = this.context.globalState.get<string>(LAST_SYNC_KEY);
      const since = last ? new Date(new Date(last).getTime() - 5 * 60_000) : new Date(Date.now() - 7 * 24 * 60 * 60_000);
      const until = new Date();
      const events = this.store
        .readRange(since, until)
        .map((event) => {
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
