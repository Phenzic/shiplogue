// Pure provider contracts. No `vscode` imports: M0 moves this directory into the
// shared core so the MCP server and the extension use the same adapters.

export type ProviderType = "none" | "anthropic" | "openai" | "google" | "openai-compatible";
export type ActiveProviderType = Exclude<ProviderType, "none">;

export const PROVIDER_LABELS: Record<ActiveProviderType, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  "openai-compatible": "OpenAI-compatible (OpenRouter, Groq, LM Studio, …)",
};

// Compact form for panel badges and one-line status.
export const PROVIDER_SHORT_LABELS: Record<ActiveProviderType, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  "openai-compatible": "OpenAI-compatible",
};

export interface ProviderConfig {
  type: ActiveProviderType;
  model: string;
  // Optional only for a local OpenAI-compatible endpoint.
  apiKey?: string;
  // Override the endpoint base. Exposed in settings only for
  // `openai-compatible`; tests use it for the hosted adapters.
  baseUrl?: string;
  // Hard cap on generated tokens; 0 = use the detail level's budget.
  maxOutputTokens: number;
}

export interface ProviderRequest {
  prompt: string;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProviderResponse {
  text: string;
  usage?: ProviderUsage;
}

export type ProviderErrorCode =
  | "auth"
  | "rate_limit"
  | "quota"
  | "context_length"
  | "unavailable"
  | "bad_response";

// Every message here is shown to the user. It must never include the key, an
// Authorization header, or a URL containing credentials.
export class ProviderError extends Error {
  readonly userFacing = true;
  constructor(
    message: string,
    readonly code: ProviderErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderAdapter {
  id: ActiveProviderType;
  label: string;
  listModels(cfg: ProviderConfig): Promise<string[]>;
  generate(req: ProviderRequest, cfg: ProviderConfig): Promise<ProviderResponse>;
}

// Defense in depth: adapters never interpolate the key into a message, but if a
// provider echoes something back we strip anything key-shaped before display.
export function redactSecrets(text: string): string {
  return String(text ?? "")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(x-api-key["':\s]+)[^\s"',}]+/gi, "$1[redacted]");
}

export function mapHttpError(
  status: number,
  label: string,
  detail?: string,
): ProviderError {
  const hint = detail ? ` ${redactSecrets(detail).slice(0, 200)}` : "";
  if (status === 401) {
    return new ProviderError(
      `${label} rejected the API key. Run "Shiplogue: Set API Key" to replace it.${hint}`,
      "auth",
      status,
    );
  }
  if (status === 402) {
    return new ProviderError(`${label} reports no remaining quota/credit.${hint}`, "quota", status);
  }
  if (status === 403) {
    return new ProviderError(
      `${label} refused the request (403). Check the key's permissions, billing or region.${hint}`,
      "auth",
      status,
    );
  }
  if (status === 404) {
    return new ProviderError(
      `${label} could not find that model. Run "Shiplogue: Set API Key" to pick another one.${hint}`,
      "bad_response",
      status,
    );
  }
  if (status === 429) {
    return new ProviderError(`${label} is rate limiting this key. Retry later.${hint}`, "rate_limit", status);
  }
  if (status === 413 || /context.{0,20}(length|window|too long)/i.test(detail ?? "")) {
    return new ProviderError(
      `The request is longer than ${label}'s context window. Lower shiplogue.detail or shiplogue.lookbackHours.${hint}`,
      "context_length",
      status,
    );
  }
  if (status >= 500) {
    return new ProviderError(`${label} is unavailable right now (${status}). Try again shortly.${hint}`, "unavailable", status);
  }
  return new ProviderError(`${label} returned ${status}.${hint}`, "bad_response", status);
}

// Combine the caller's cancellation with a per-request timeout. Kept local so
// the adapters stay dependency-free and work on Node 20.
export function requestSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; cleanup: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const forward = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      forward();
    } else {
      signal.addEventListener("abort", forward);
    }
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    },
  };
}

// Shared request helper: one place for timeouts, JSON parsing and status checks.
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal | undefined,
  label: string,
  timeoutMs = 120_000,
): Promise<any> {
  const { signal: combined, timedOut, cleanup } = requestSignal(signal, timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (e: any) {
      // The caller's cancellation propagates unchanged.
      if (signal?.aborted) {
        throw e;
      }
      if (timedOut()) {
        throw new ProviderError(
          `${label} did not respond within ${Math.round(timeoutMs / 1000)}s. Try again or pick a faster model.`,
          "unavailable",
        );
      }
      throw new ProviderError(
        `Couldn't reach ${label}. Check your connection and the configured endpoint.`,
        "unavailable",
      );
    }

    const raw = await res.text();
    let data: any;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { __raw: raw.slice(0, 200) };
    }

    if (!res.ok) {
      const detail =
        data?.error?.message ?? data?.error?.status ?? data?.message ?? data?.__raw ?? res.statusText;
      throw mapHttpError(res.status, label, typeof detail === "string" ? detail : undefined);
    }
    return data;
  } finally {
    cleanup();
  }
}

export async function getJson(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  label: string,
  timeoutMs = 20_000,
): Promise<any> {
  const { signal: combined, timedOut, cleanup } = requestSignal(signal, timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: combined });
    } catch (e: any) {
      if (signal?.aborted) {
        throw e;
      }
      if (timedOut()) {
        throw new ProviderError(
          `${label} did not respond within ${Math.round(timeoutMs / 1000)}s.`,
          "unavailable",
        );
      }
      throw new ProviderError(`Couldn't reach ${label}.`, "unavailable");
    }
    const raw = await res.text();
    let data: any;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      const detail = data?.error?.message ?? data?.message ?? res.statusText;
      throw mapHttpError(res.status, label, typeof detail === "string" ? detail : undefined);
    }
    return data;
  } finally {
    cleanup();
  }
}
