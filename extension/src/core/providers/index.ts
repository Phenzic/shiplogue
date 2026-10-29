import { ProviderAdapter, ActiveProviderType } from "./types";
import { anthropicAdapter } from "./anthropic";
import { openaiAdapter } from "./openai";
import { googleAdapter } from "./google";
import { compatibleAdapter } from "./compatible";

const ADAPTERS: Record<ActiveProviderType, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
  "openai-compatible": compatibleAdapter,
};

export function adapterFor(type: ActiveProviderType): ProviderAdapter {
  return ADAPTERS[type];
}

export * from "./types";
export { anthropicAdapter, openaiAdapter, googleAdapter, compatibleAdapter };
