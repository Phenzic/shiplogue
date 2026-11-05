import * as vscode from "vscode";
import { cfg } from "./config";
import type { CloudClient } from "./cloud";

export type TelemetryEvent =
  | "extension.activated"
  | "standup.generated"
  | "standup.copied"
  | "standup.posted"
  | "standup.regenerated"
  | "generation.failed"
  | "connector.connected"
  | "connector.disconnected"
  | "sync.succeeded"
  | "sync.failed";

export type TelemetryProperties = Record<string, string | number | boolean | null>;

type Envelope = {
  event: TelemetryEvent;
  installationId: string;
  extensionVersion: string;
  editor: string;
  provider: string;
  occurredAt: string;
  properties: TelemetryProperties;
  dedupeKey: string;
};

const INSTALLATION_KEY = "shiplogue.installationId";

/**
 * Opt-in, cloud-only product telemetry. It never runs without a connector key
 * and `shiplogue.telemetry.enabled`; it never includes prompts, source, paths,
 * repository names, or error messages.
 */
export class Analytics {
  private pending: Envelope[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly cloud: CloudClient,
  ) {}

  async track(
    event: TelemetryEvent,
    properties: TelemetryProperties = {},
  ): Promise<void> {
    if (!cfg().telemetryEnabled) return;

    const key = await this.cloud.getKey();
    if (!key) return;

    const installationId = await this.installationId();
    const occurredAt = new Date().toISOString();
    this.pending.push({
      event,
      installationId,
      extensionVersion: this.extensionVersion(),
      editor: this.editor(),
      provider: this.provider(),
      occurredAt,
      properties,
      dedupeKey: `${installationId}:${event}:${occurredAt}:${Math.random().toString(36).slice(2, 10)}`,
    });

    if (this.pending.length > 200) {
      this.pending = this.pending.slice(-200);
    }
    this.schedule(1_200);
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    if (!cfg().telemetryEnabled) {
      this.pending = [];
      return;
    }

    this.flushing = true;
    try {
      while (this.pending.length > 0) {
        const key = await this.cloud.getKey();
        if (!key) {
          this.pending = [];
          break;
        }

        const batch = this.pending.splice(0, 50);
        const response = await fetch(`${this.cloud.baseUrl}/api/v1/analytics/events`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ events: batch }),
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          throw new Error(`Analytics request failed (HTTP ${response.status}).`);
        }
      }
    } catch {
      // Retry later; never block generation or sync. The queue is bounded.
      this.schedule(30_000);
    } finally {
      this.flushing = false;
    }
  }

  async dispose(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.flush();
  }

  private schedule(delayMs: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delayMs);
  }

  private async installationId(): Promise<string> {
    const existing = this.context.globalState.get<string>(INSTALLATION_KEY);
    if (existing) return existing;

    const id =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `inst-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    await this.context.globalState.update(INSTALLATION_KEY, id);
    return id;
  }

  private extensionVersion(): string {
    try {
      const extensions = (vscode as unknown as {
        extensions?: { getExtension?: (id: string) => { packageJSON?: { version?: string } } | undefined };
      }).extensions;
      return (
        extensions?.getExtension?.("phenzic.shiplogue")?.packageJSON?.version ??
        (this.context as unknown as { extension?: { packageJSON?: { version?: string } } }).extension
          ?.packageJSON?.version ??
        "unknown"
      );
    } catch {
      return "unknown";
    }
  }

  private editor(): string {
    const appName = ((vscode.env as unknown as { appName?: string }).appName ?? "").toLowerCase();
    if (appName.includes("cursor")) return "cursor";
    if (appName.includes("antigravity")) return "antigravity";
    if (appName.includes("windsurf")) return "windsurf";
    if (appName.includes("visual studio code")) return "vscode";
    if (!appName) return "unknown";
    return appName.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "unknown";
  }

  private provider(): string {
    const configured = cfg().providerType;
    if (configured !== "none") return configured;
    return cfg().modelBackend === "ollama" ? "ollama" : "unknown";
  }
}

let current: Analytics | undefined;

export function initAnalytics(context: vscode.ExtensionContext, cloud: CloudClient): Analytics {
  current = new Analytics(context, cloud);
  return current;
}

export function getAnalytics(): Analytics | undefined {
  return current;
}
