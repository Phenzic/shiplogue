import { adapterFor, ProviderConfig } from "../core/providers";
import { BackendRequest, BackendResult, ModelBackend } from "./types";

// Thin ModelBackend wrapper around a provider adapter. Configuration (type,
// model, key) is resolved by the registry so this class stays stateless.
export class ProviderBackend implements ModelBackend {
  readonly kind = "provider" as const;

  constructor(private readonly config: ProviderConfig) {}

  async isReady(): Promise<boolean> {
    return true;
  }

  async generate(req: BackendRequest): Promise<BackendResult> {
    const started = Date.now();
    const adapter = adapterFor(this.config.type);
    // The provider setting is a hard cap; the detail level still controls the
    // request below it (concise 400 / standard 900 / elaborate 1600).
    const maxTokens =
      this.config.maxOutputTokens > 0
        ? Math.min(req.maxTokens, this.config.maxOutputTokens)
        : req.maxTokens;

    const res = await adapter.generate({ ...req, maxTokens }, this.config);
    return {
      text: res.text,
      meta: {
        kind: "provider",
        model: this.config.model,
        provider: this.config.type,
        durationMs: Date.now() - started,
        ...(res.usage ?? {}),
      },
    };
  }
}
