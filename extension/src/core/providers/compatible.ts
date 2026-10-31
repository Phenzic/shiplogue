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
      "No base URL is configured. Set shiplogue.provider.baseUrl (for example http://localhost:1234/v1).",
      "bad_response",
    );
  }
  // Tolerate a pasted full endpoint.
  return raw.replace(/\/chat\/completions$/, "");
}

function headers(cfg: ProviderConfig): Record<string, string> {
  return cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {};
}

// `content` is normally a string; newer models may return an array of parts.
function messageText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  return (
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((p: any) => p?.text ?? "").join("")
        : ""
  ).trim();
}

// Reasoning is exposed as `reasoning_content` (DeepSeek, Kimi, vLLM, llama.cpp)
// or `reasoning` (OpenRouter). Both mean the model thought before answering.
function messageReasoning(data: any): string {
  const message = data?.choices?.[0]?.message;
  const reasoning = message?.reasoning_content || message?.reasoning;
  return typeof reasoning === "string" ? reasoning.trim() : "";
}

function finishReason(data: any): string | undefined {
  const reason = data?.choices?.[0]?.finish_reason;
  return typeof reason === "string" ? reason : undefined;
}

// The response had no answer, but the model clearly spent output tokens on
// hidden reasoning instead of failing outright.
function reasoningOnly(data: any): boolean {
  return messageReasoning(data).length > 0 || finishReason(data) === "length";
}

function emptyResponseError(data: any): ProviderError {
  const reason = finishReason(data);
  const reasoningTokens = data?.usage?.completion_tokens_details?.reasoning_tokens;
  const detail = [
    reason ? `finish_reason: ${reason}` : "",
    typeof reasoningTokens === "number" ? `reasoning tokens: ${reasoningTokens}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const suffix = detail ? ` (${detail})` : "";
  return new ProviderError(
    reasoningOnly(data)
      ? `The endpoint spent its whole output budget on reasoning and returned no answer${suffix}. Raise shiplogue.provider.maxOutputTokens, or use a model without thinking mode.`
      : `The endpoint returned an empty response${suffix}.`,
    "bad_response",
  );
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
    const url = `${base(cfg)}/chat/completions`;
    const send = (body: Record<string, unknown>) =>
      postJson(url, headers(cfg), body, req.signal, "the endpoint");

    const body = {
      model: cfg.model,
      messages: [{ role: "user", content: req.prompt }],
      temperature: req.temperature,
      max_tokens: req.maxTokens,
    };

    let data = await send(body);
    let text = messageText(data);

    // Thinking is on by default on some endpoints (DeepSeek, Gemini 2.5,
    // reasoning models served by vLLM/llama.cpp/OpenRouter). The hidden CoT is
    // drawn from the same `max_tokens` budget, so a small budget can be spent
    // entirely on reasoning and return content: null. One recovery request
    // raises the budget and switches thinking off — a stand-up is a formatting
    // task, not a reasoning task, so the CoT is pure cost here. This retry
    // deliberately exceeds `maxOutputTokens`: it only fires when the first
    // request produced no answer at all.
    if (!text && reasoningOnly(data)) {
      const budget = Math.max(Math.ceil(req.maxTokens * 4), 4096);
      let retried: any;
      try {
        retried = await send({ ...body, max_tokens: budget, reasoning_effort: "none" });
      } catch (e) {
        // Not every OpenAI-compatible server knows `reasoning_effort`; a 400
        // (rather than auth/rate-limit/context failures) means fall back to
        // the budget-only retry instead of failing the generation.
        if (e instanceof ProviderError && e.status === 400 && e.code === "bad_response") {
          retried = await send({ ...body, max_tokens: budget });
        } else {
          throw e;
        }
      }
      data = retried;
      text = messageText(data);
    }

    if (!text) {
      throw emptyResponseError(data);
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
