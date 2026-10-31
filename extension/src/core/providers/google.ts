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

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

function base(cfg: ProviderConfig): string {
  return (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
}

function headers(cfg: ProviderConfig): Record<string, string> {
  if (!cfg.apiKey) {
    throw new ProviderError("No Google API key is configured. Run \"Shiplogue: Set API Key\".", "auth");
  }
  // Header auth keeps the key out of URLs and logs.
  return { "x-goog-api-key": cfg.apiKey };
}

// Model ids may come back from the list endpoint as "models/gemini-…".
function pathModel(model: string): string {
  return model.replace(/^models\//, "");
}

export const googleAdapter: ProviderAdapter = {
  id: "google" as ActiveProviderType,
  label: PROVIDER_LABELS.google,

  async listModels(cfg) {
    const data = await getJson(`${base(cfg)}/models?pageSize=1000`, headers(cfg), undefined, "Google Gemini");
    return (data?.models ?? [])
      .filter(
        (m: any) =>
          Array.isArray(m?.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes("generateContent"),
      )
      .map((m: any) => String(m?.name ?? "").replace(/^models\//, ""))
      .filter((id: string) => id.length > 0);
  },

  async generate(req: ProviderRequest, cfg: ProviderConfig): Promise<ProviderResponse> {
    const data = await postJson(
      `${base(cfg)}/models/${encodeURIComponent(pathModel(cfg.model))}:generateContent`,
      headers(cfg),
      {
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        generationConfig: {
          temperature: req.temperature,
          maxOutputTokens: req.maxTokens,
        },
      },
      req.signal,
      "Google Gemini",
    );

    const text = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("")
      .trim();

    if (!text) {
      throw new ProviderError(
        "Google Gemini returned an empty response. The model may have blocked it or hit its output limit.",
        "bad_response",
      );
    }
    return {
      text,
      usage: {
        inputTokens: data?.usageMetadata?.promptTokenCount,
        outputTokens: data?.usageMetadata?.candidatesTokenCount,
      },
    };
  },
};
