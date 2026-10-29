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

// Covers OpenRouter, Groq, Together, LM Studio, llama.cpp server and any other
// endpoint that speaks the OpenAI Chat Completions shape.
function base(cfg: ProviderConfig): string {
  const raw = (cfg.baseUrl || "").trim().replace(/\/+$/, "");
  if (!raw) {
    throw new ProviderError(
      "No base URL is configured. Set standup.provider.baseUrl (for example http://localhost:1234/v1).",
      "bad_response",
    );
  }
  // Tolerate a pasted full endpoint.
  return raw.replace(/\/chat\/completions$/, "");
}

function headers(cfg: ProviderConfig): Record<string, string> {
  return cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {};
}

export const compatibleAdapter: ProviderAdapter = {
  id: "openai-compatible" as ActiveProviderType,
  label: PROVIDER_LABELS["openai-compatible"],

  async listModels(cfg) {
    const data = await getJson(`${base(cfg)}/models`, headers(cfg), undefined, "the endpoint");
    return (data?.data ?? [])
      .map((m: any) => (typeof m === "string" ? m : m?.id))
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
  },

  async generate(req: ProviderRequest, cfg: ProviderConfig): Promise<ProviderResponse> {
    const data = await postJson(
      `${base(cfg)}/chat/completions`,
      headers(cfg),
      {
        model: cfg.model,
        messages: [{ role: "user", content: req.prompt }],
        temperature: req.temperature,
        max_tokens: req.maxTokens,
      },
      req.signal,
      "the endpoint",
    );

    const content = data?.choices?.[0]?.message?.content;
    const text = (
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((p: any) => p?.text ?? "").join("")
          : ""
    ).trim();

    if (!text) {
      const reasoning = data?.choices?.[0]?.message?.reasoning_content;
      throw new ProviderError(
        reasoning
          ? "The endpoint returned reasoning but no final answer content. If you use a reasoning model (for example deepseek-reasoner), switch to the non-reasoning model (for example deepseek-chat) or raise the output budget."
          : "The endpoint returned an empty response.",
        "bad_response",
      );
    }
    return {
      text,
      usage: {
        inputTokens: data?.usage?.prompt_tokens,
        outputTokens: data?.usage?.completion_tokens,
      },
    };
  },
};
