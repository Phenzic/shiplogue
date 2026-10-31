import { cfg } from "../config";
import {
  ActiveProviderType,
  PROVIDER_SHORT_LABELS,
  ProviderConfig,
} from "../core/providers";
import { OllamaBackend } from "./ollama";
import { ProviderBackend } from "./providerBackend";
import { getProviderKey } from "./secrets";
import { BackendError, ModelBackend } from "./types";

export type BackendSetting = "auto" | "local" | "provider" | "ollama";

// User-facing selection error (shown verbatim in the panel).
export class BackendUnavailableError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

// A provider is "configured" when the type, model and (except for a local
// OpenAI-compatible endpoint) a stored key are all present.
export async function loadProviderConfig(): Promise<ProviderConfig | undefined> {
  const c = cfg();
  if (c.providerType === "none" || !c.providerModel) {
    return undefined;
  }
  const type = c.providerType as ActiveProviderType;

  if (type === "openai-compatible") {
    if (!c.providerBaseUrl) {
      return undefined;
    }
    const apiKey = await getProviderKey(type);
    return {
      type,
      model: c.providerModel,
      baseUrl: c.providerBaseUrl,
      apiKey,
      maxOutputTokens: c.providerMaxOutputTokens,
    };
  }

  const apiKey = await getProviderKey(type);
  if (!apiKey) {
    return undefined;
  }
  return {
    type,
    model: c.providerModel,
    apiKey,
    // Optional override for proxies and tests; the adapters default to the
    // provider's public endpoint when this is empty.
    baseUrl: c.providerBaseUrl || undefined,
    maxOutputTokens: c.providerMaxOutputTokens,
  };
}

export function providerDisplayName(type: ActiveProviderType): string {
  return PROVIDER_SHORT_LABELS[type];
}

// Selection order for `auto`: bundled local model (R4) → configured provider →
// Ollama. There is deliberately no silent fallback between cloud providers.
export async function resolveBackend(): Promise<ModelBackend> {
  const setting = cfg().modelBackend;

  if (setting === "local") {
    throw new BackendUnavailableError(
      "The bundled local model isn't part of this beta. Set shiplogue.model.backend to 'auto' or 'provider' (your own API key), or use 'ollama'.",
    );
  }

  if (setting === "ollama") {
    return new OllamaBackend();
  }

  const providerConfig = await loadProviderConfig();

  if (setting === "provider") {
    if (!providerConfig) {
      throw new BackendUnavailableError(
        "No provider is configured. Run \"Shiplogue: Set API Key\", or set shiplogue.model.backend to 'auto' to use Ollama.",
      );
    }
    return new ProviderBackend(providerConfig);
  }

  // auto
  if (providerConfig) {
    return new ProviderBackend(providerConfig);
  }
  return new OllamaBackend();
}
