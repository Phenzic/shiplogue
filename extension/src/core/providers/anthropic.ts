import {
  ActiveProviderType,
  PROVIDER_LABELS,
  ProviderAdapter,
  ProviderConfig,
  ProviderError,
  ProviderRequest,
  ProviderResponse,
  getJson,
  postJson,
} from "./types";

const DEFAULT_BASE = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

function base(cfg: ProviderConfig): string {
  return (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
}

function headers(cfg: ProviderConfig): Record<string, string> {
  if (!cfg.apiKey) {
    throw new ProviderError(
      "No Anthropic API key is configured. Run \"Standup: Set API Key\".",
      "auth",
    );
  }
  return {
    "x-api-key": cfg.apiKey,
    "anthropic-version": API_VERSION,
  };
}

// Anthropic Messages API: content is an array of blocks; text blocks are the
// answer, thinking blocks (when enabled) are ignored.
export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic" as ActiveProviderType,
  label: PROVIDER_LABELS.anthropic,

  async listModels(cfg) {
    const data = await getJson(`${base(cfg)}/v1/models?limit=100`, headers(cfg), undefined, "Anthropic");
    return (data?.data ?? [])
      .map((m: any) => m?.id)
      .filter((id: unknown): id is string => typeof id === "string");
  },

  async generate(req: ProviderRequest, cfg: ProviderConfig): Promise<ProviderResponse> {
    const data = await postJson(
      `${base(cfg)}/v1/messages`,
      headers(cfg),
      {
        model: cfg.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        messages: [{ role: "user", content: req.prompt }],
      },
      req.signal,
      "Anthropic",
    );

    const text = (data?.content ?? [])
      .filter((block: any) => block?.type === "text" && typeof block?.text === "string")
      .map((block: any) => block.text)
      .join("")
      .trim();

    if (!text) {
      throw new ProviderError("Anthropic returned an empty response. Try again or pick another model.", "bad_response");
    }
    return {
      text,
      usage: {
        inputTokens: data?.usage?.input_tokens,
        outputTokens: data?.usage?.output_tokens,
      },
    };
  },
};
