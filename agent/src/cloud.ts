// Cloud client for the agent. Project-key auth only; no model keys here.
import { loadConfig } from "./config";
import { currentAgentStatus } from "./status";
import { gatherActivity } from "./activity";
import { loadDraft, type DraftRecord } from "./drafts/store";
import { dayKey, EventStore } from "./events/store";
import { eventsDir } from "./config";
import { agentVersion } from "./version";
import { parseStandupDocument, type StandupDocument } from "../../extension/src/core/standupDocument";
import type { AgentEvent } from "./types";

const DEFAULT_URL = "https://shiplogue.dev";

export function projectKey(): string | undefined {
  const key = process.env.SHIPLOGUE_PROJECT_KEY || process.env.SHIPLOGUE_CLOUD_TOKEN;
  return key?.trim() || undefined;
}

export function cloudUrl(): string {
  return (process.env.SHIPLOGUE_CLOUD_URL || DEFAULT_URL).replace(/\/+$/, "");
}

function headers(): Record<string, string> {
  const key = projectKey();
  if (!key) throw new Error("SHIPLOGUE_PROJECT_KEY is not configured.");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "X-Shiplogue-Agent-Version": agentVersion(),
    "X-Shiplogue-Schema-Version": "1",
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${cloudUrl()}/api/v1${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : text.slice(0, 300)
    throw new Error(`Shiplogue Cloud ${response.status}: ${message || "request failed"}`)
  }
  return data as T
}

export async function cloudStatus() {
  return request<{ project: { id: string; name: string }; plan: string; targets: unknown[] }>("/agent/status")
}

function reportFromDraft(draft: DraftRecord, stats: Awaited<ReturnType<typeof gatherActivity>>["stats"]) {
  const document: StandupDocument | undefined = parseStandupDocument(draft.markdown)
  return {
    date: draft.date,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    revision: draft.revision,
    source: draft.source || "agent",
    model: draft.backend,
    agentVersion: agentVersion(),
    schemaVersion: 1,
    markdown: draft.markdown,
    plainText: draft.plainText,
    ...(document ? {
      headline: document.headline,
      labels: document.labels,
      yesterday: document.yesterday,
      themes: document.today.map((theme) => ({
        title: theme.title,
        tag: theme.tag,
        summary: theme.summary,
        details: theme.details,
        files: theme.files.map((file) => file.replace(/\\/g, "/").split("/").pop() || file),
      })),
      next: document.next,
      blockers: document.blockers,
    } : {}),
    ...(draft.quality ? { quality: draft.quality } : {}),
    sources: Object.keys(stats.bySource),
    stats: {
      events: stats.events,
      sessions: stats.sessions,
      prompts: stats.prompts,
      responses: stats.responses,
      toolCalls: stats.toolCalls,
      shells: stats.shells,
      fileEdits: stats.fileEdits,
      fileReads: stats.fileReads,
      filesTouched: stats.filesTouched,
      commits: stats.commits,
      commitFiles: stats.commitFiles,
      uncommittedFiles: stats.uncommittedFiles,
      diff: stats.diff,
      github: stats.github,
      tokens: stats.tokens,
      bySource: stats.bySource,
    },
    warnings: draft.warnings ?? [],
  }
}

export async function syncAgentDraft(date?: string) {
  const draft = loadDraft(date)
  if (!draft) throw new Error("No local draft found. Save a stand-up first.")
  const activity = await gatherActivity()
  const report = reportFromDraft(draft, activity.stats)
  const result = await request<{ report: { revision: number } }>("/agent/reports", {
    method: "POST",
    body: JSON.stringify(report),
  })
  return result.report
}

export async function compileAgentDraft(date: string) {
  return request<{ report: { id: string; bodyMarkdown: string } }>(`/agent/reports/${encodeURIComponent(date)}/compile`, {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export async function postAgentDraft(date: string) {
  const draft = loadDraft(date)
  if (!draft) throw new Error("No local draft found. Save a stand-up first.")
  await syncAgentDraft(date)
  await compileAgentDraft(date)
  return request<{ delivery: { id: string; status: string } }>(`/agent/reports/${encodeURIComponent(date)}/post`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
    headers: { "Idempotency-Key": `agent:${date}:${draft.revision}` },
  })
}

export async function syncAgentActivity(date = dayKey(new Date())) {
  const store = new EventStore(eventsDir())
  const events = store.readRange(new Date(`${date}T00:00:00`), new Date(`${date}T23:59:59.999`))
  if (!events.length) return { accepted: 0, duplicates: 0 }
  const payload = events
    .filter((event) => event.kind !== "prompt" && event.kind !== "response")
    .map((event) => ({
      id: event.id,
      source: event.source,
      type: event.kind,
      occurredAt: event.ts,
      title: event.kind === "commit" ? event.meta?.subject ?? "Commit" : event.kind,
      summary: event.file ?? event.command ?? undefined,
      project: event.repo,
      localWorkspaceId: event.workspaceId,
      files: event.file ? [{ path: event.file, ...(event.diff ? { additions: event.diff.added, deletions: event.diff.removed } : {}) }] : [],
      producer: event.source,
      aiAssisted: event.actor === "agent",
      tokens: event.meta ? {
        ...(Number(event.meta.input_tokens) ? { input: Number(event.meta.input_tokens) } : {}),
        ...(Number(event.meta.output_tokens) ? { output: Number(event.meta.output_tokens) } : {}),
        ...(Number(event.meta.cost_usd) ? { costUsd: Number(event.meta.cost_usd) } : {}),
      } : undefined,
      metadata: Object.fromEntries(Object.entries(event.meta ?? {}).filter(([key]) => !key.includes("text") && !key.includes("prompt"))),
    }))
  const result = await request<{ accepted: number; duplicates: number }>("/events", {
    method: "POST",
    body: JSON.stringify({ events: payload }),
  })
  return result
}
