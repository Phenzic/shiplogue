import * as vscode from "vscode";
import { cfg } from "./config";
import { currentEditorSource } from "./sources";
import {
  isPaidPlan,
  normalizeFormatSections,
  resetFormatSections,
  setFormatSections,
} from "./formatProfile";

export const CLOUD_SECRET_KEY = "shiplogue.cloud.connectorKey";
export const CLOUD_PROFILE_KEY = "shiplogue.cloud.formatProfile";
export const DEFAULT_CLOUD_URL = "https://shiplogue.dev";

export class CloudError extends Error {
  readonly userFacing = true;
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "CloudError";
    this.status = status;
  }
}

export type CloudMe = {
  workspace: {
    id: string;
    name: string;
    plan: string;
    syncActivity: boolean;
    format?: { sections?: unknown };
    features?: {
      posting?: boolean;
      scheduledPosting?: boolean;
      history?: boolean;
    };
  };
  connector: {
    id: string;
    name: string;
    scopes: string[];
  };
};

export type CloudSyncResult =
  | { status: "synced"; standupId: string }
  | { status: "skipped"; reason: "no-key" | "disabled" }
  | { status: "failed"; error: string };

// Posting is a Pro feature executed by Shiplogue Cloud: the extension asks the
// cloud to post a synced stand-up to the workspace's configured platforms.
export type CloudSendResult =
  | { status: "sent"; standupId: string; targets?: string[] }
  | {
      status: "queued";
      standupId: string;
      deliveryId: string;
      targets?: string[];
    }
  | { status: "skipped"; reason: "no-key" | "disabled" | "not-pro" }
  | { status: "failed"; error: string };

export type CloudDelivery = {
  id: string;
  status: "queued" | "sending" | "sent" | "partial" | "failed" | string;
  targets: { target: string; status: string }[];
  sentAt: string | null;
};

export type CloudHistoryEntry = {
  id: string;
  standupDate: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  bodyMarkdown: string;
  model: string | null;
  status: string;
  localWorkspace?: { id?: string | null; name?: string | null };
  sources?: string[];
  coverage?: import("./types").StandupCoverage;
  sent?: { targets: string[]; at: string; status?: string } | null;
  scheduled?: { at: string; targets: string[]; status: string } | null;
};

export type CloudHistoryPage = {
  entries: CloudHistoryEntry[];
  cursor?: string;
  total?: number;
};

export function normalizeCloudUrl(raw: string): string {
  const value = (raw || "").trim() || DEFAULT_CLOUD_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CloudError(
      "The cloud URL is not valid. Use https://shiplogue.dev or your own deployment URL.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CloudError("The cloud URL must start with http:// or https://.");
  }
  return url.toString().replace(/\/+$/, "");
}

export function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Client for the connector API. The raw connector key is kept in SecretStorage
 * and is never written to settings, globalState, logs, or error messages.
 */
export class CloudClient {
  constructor(private readonly context: vscode.ExtensionContext) {
    this.restoreProfile();
  }

  /** Use the last paid profile while offline; free/unknown always built-in. */
  private restoreProfile(): void {
    const cached = this.context.globalState.get<{ plan?: string; sections?: unknown }>(
      CLOUD_PROFILE_KEY,
    );
    if (cached && isPaidPlan(cached.plan)) {
      setFormatSections(cached.sections);
    } else {
      resetFormatSections();
    }
  }

  /** Paid cloud profiles may customise section labels/order. Free is ignored. */
  private applyProfile(me: CloudMe): void {
    const sections = isPaidPlan(me.workspace.plan)
      ? normalizeFormatSections(me.workspace.format?.sections)
      : undefined;
    setFormatSections(sections);
    void this.context.globalState.update(CLOUD_PROFILE_KEY, {
      plan: me.workspace.plan,
      sections,
    });
  }

  get baseUrl(): string {
    return normalizeCloudUrl(cfg().cloudUrl);
  }

  async getKey(): Promise<string | undefined> {
    if (!this.context.secrets) return undefined;
    const value = await this.context.secrets.get(CLOUD_SECRET_KEY);
    return value && value.trim() ? value.trim() : undefined;
  }

  async hasKey(): Promise<boolean> {
    return Boolean(await this.getKey());
  }

  async connect(rawKey: string): Promise<CloudMe> {
    if (!this.context.secrets) {
      throw new CloudError("This editor does not expose secret storage, so the key cannot be saved.");
    }
    const key = rawKey.trim();
    if (!/^shp_live_[A-Za-z0-9_-]{16,}$/.test(key)) {
      throw new CloudError(
        "That does not look like a Shiplogue connector key. It should start with shp_live_.",
      );
    }
    const me = await this.meWithKey(key);
    await this.context.secrets.store(CLOUD_SECRET_KEY, key);
    this.applyProfile(me);
    return me;
  }

  async disconnect(): Promise<void> {
    await this.context.secrets?.delete(CLOUD_SECRET_KEY);
    resetFormatSections();
    await this.context.globalState.update(CLOUD_PROFILE_KEY, undefined);
  }

  async me(): Promise<CloudMe> {
    const me = await this.meWithKey(await this.requireKey());
    this.applyProfile(me);
    return me;
  }

  async syncStandup(input: {
    markdown: string;
    modelLabel?: string;
    localWorkspaceId?: string;
    localWorkspaceName?: string;
    sources?: string[];
    coverage?: import("./types").StandupCoverage;
    standupDate?: string;
    title?: string;
  }): Promise<CloudSyncResult> {
    const c = cfg();
    if (!c.cloudEnabled) return { status: "skipped", reason: "disabled" };

    const key = await this.getKey();
    if (!key) return { status: "skipped", reason: "no-key" };

    try {
      const standupDate = input.standupDate ?? localDateKey();
      const minutes = Math.max(
        0,
        Math.min(1440, Math.round(Number(c.cloudEstimatedMinutesSaved) || 0)),
      );
      const data = await this.request<{ standup?: { id?: string } }>(key, "/api/v1/standups", {
        method: "POST",
        body: JSON.stringify({
          standupDate,
          title: input.title ?? `Standup for ${standupDate}`,
          bodyMarkdown: input.markdown,
          localWorkspaceId: input.localWorkspaceId,
          localWorkspaceName: input.localWorkspaceName,
          sources: input.sources,
          coverage: input.coverage,
          timeSavedMinutes: minutes,
          status: "draft",
          model: input.modelLabel,
        }),
      });
      return { status: "synced", standupId: data?.standup?.id ?? "" };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Ask Shiplogue Cloud to post a synced stand-up to the workspace targets. */
  async sendStandup(
    standupId: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CloudSendResult> {
    const c = cfg();
    if (!c.cloudEnabled) return { status: "skipped", reason: "disabled" };

    const key = await this.getKey();
    if (!key) return { status: "skipped", reason: "no-key" };

    try {
      const me = await this.meWithKey(key);
      const posting = me.workspace.features?.posting ?? isPaidPlan(me.workspace.plan);
      if (!posting) return { status: "skipped", reason: "not-pro" };

      const { data, status } = await this.requestWithStatus<{
        standup?: { id?: string };
        sent?: { targets?: string[] };
        delivery?: CloudDelivery;
      }>(key, `/api/v1/standups/${encodeURIComponent(standupId)}/send`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({}),
      });

      if (status === 202 || (data.delivery && data.delivery.status !== "sent" && data.delivery.status !== "partial")) {
        const delivery = data.delivery;
        return {
          status: "queued",
          standupId: data.standup?.id ?? standupId,
          deliveryId: delivery?.id ?? "",
          ...(delivery?.targets?.length
            ? { targets: delivery.targets.map((target) => target.target) }
            : {}),
        };
      }

      return {
        status: "sent",
        standupId: data?.standup?.id ?? standupId,
        ...(data?.sent?.targets ? { targets: data.sent.targets } : {}),
      };
    } catch (error) {
      if (error instanceof CloudError && error.status === 402) {
        return { status: "skipped", reason: "not-pro" };
      }
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getDelivery(deliveryId: string): Promise<CloudDelivery | undefined> {
    const key = await this.getKey();
    if (!key) return undefined;
    const data = await this.request<{ delivery?: CloudDelivery }>(
      key,
      `/api/v1/deliveries/${encodeURIComponent(deliveryId)}`,
    );
    return data.delivery;
  }

  /** Poll briefly after a queued send; return undefined when still queued. */
  async waitForDelivery(deliveryId: string, timeoutMs = 10_000): Promise<CloudDelivery | undefined> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const delivery = await this.getDelivery(deliveryId);
      if (!delivery) return undefined;
      if (delivery.status === "sent" || delivery.status === "partial" || delivery.status === "failed") {
        return delivery;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return undefined;
  }

  async listHistory(input: { before?: string; limit?: number } = {}): Promise<CloudHistoryPage> {
    const key = await this.requireKey();
    const params = new URLSearchParams();
    if (input.before) params.set("before", input.before);
    params.set("limit", String(Math.min(50, Math.max(1, input.limit ?? 20))));
    return this.request<CloudHistoryPage>(key, `/api/v1/standups?${params.toString()}`);
  }

  async createRevision(input: {
    standupId: string;
    bodyMarkdown: string;
    model?: string;
    sources?: string[];
    createdAt?: string;
  }): Promise<void> {
    const key = await this.requireKey();
    await this.request(key, `/api/v1/standups/${encodeURIComponent(input.standupId)}/revisions`, {
      method: "POST",
      body: JSON.stringify({
        bodyMarkdown: input.bodyMarkdown,
        model: input.model,
        sources: input.sources,
        createdAt: input.createdAt,
      }),
    });
  }

  private async requireKey(): Promise<string> {
    const key = await this.getKey();
    if (!key) {
      throw new CloudError(
        "No connector key is stored. Run \"Shiplogue: Connect Cloud\" with a key from your dashboard.",
      );
    }
    return key;
  }

  private async meWithKey(key: string): Promise<CloudMe> {
    return this.request<CloudMe>(key, "/api/v1/me");
  }

  private async request<T>(key: string, path: string, init: RequestInit = {}): Promise<T> {
    return (await this.requestWithStatus<T>(key, path, init)).data;
  }

  private async requestWithStatus<T>(
    key: string,
    path: string,
    init: RequestInit = {},
  ): Promise<{ data: T; status: number }> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${key}`);
    headers.set("X-Shiplogue-Platform", currentEditorSource());
    if (init.body) headers.set("Content-Type", "application/json");

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await response.text();
    let payload: any;
    try {
      payload = raw ? JSON.parse(raw) : undefined;
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && typeof payload.error === "string"
          ? payload.error
          : `Cloud request failed (HTTP ${response.status}).`;
      throw new CloudError(detail, response.status);
    }
    return { data: payload as T, status: response.status };
  }
}
