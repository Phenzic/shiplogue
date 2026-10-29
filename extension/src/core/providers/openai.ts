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

const DEFAULT_BASE = "https://api.openai.com/v1";

function base(cfg: ProviderConfig): string {
  return (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
}

function headers(cfg: ProviderConfig): Record<string, string> {
  if (!cfg.apiKey) {
    throw new ProviderError("No OpenAI API key is configured. Run \"Standup: Set API Key\".", "auth");
  }
  return { authorization: `Bearer ${cfg.apiKey}` };
}

// Chat Completions. `content` is normally a string; newer models may return an
// array of parts, so both shapes are accepted.
export const openaiAdapter: ProviderAdapter = {
  id: "openai" as ActiveProviderType,
  label: PROVIDER_LABELS.openai,

  async listModels(cfg) {
    const data = await getJson(`${base(cfg)}/models`, headers(cfg), undefined, "OpenAI");
    return (data?.data ?? [])
      .map((m: any) => m?.id)
      .filter((id: unknown): id is string => typeof id === "string");
  },

  async generate(req: ProviderRequest, cfg: ProviderConfig): Promise<ProviderResponse> {
    const url = `${base(cfg)}/chat/completions`;
    const messages = [{ role: "user", content: req.prompt }];
    const send = (body: Record<string, unknown>) =>
      postJson(url, headers(cfg), body, req.signal, "OpenAI");

    let data: any;
    try {
      data = await send({
        model: cfg.model,
        messages,
        temperature: req.temperature,
        // Current OpenAI models take max_completion_tokens; max_tokens is
        // deprecated for the newest chat/reasoning models.
        max_completion_tokens: req.maxTokens,
      });
    } catch (e) {
      // Reasoning models reject `temperature` (and some parameter names) with a
      // 400. Retry once with only the required fields instead of failing.
      if (
        e instanceof ProviderError &&
        e.status === 400 &&
        /temperature|max_tokens|max_completion_tokens|unsupported (parameter|value)/i.test(e.message)
      ) {
        data = await send({ model: cfg.model, messages });
      } else {
        throw e;
      }
    }

    const content = data?.choices?.[0]?.message?.content;
    const text = (
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((p: any) => p?.text ?? "").join("")
          : ""
    ).trim();

    if (!text) {
      throw new ProviderError("OpenAI returned an empty response. Try again or pick another model.", "bad_response");
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
