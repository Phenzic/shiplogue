// Backend contract shared by Ollama, BYOK providers and (R4) the bundled model.

export type BackendKind = "local" | "ollama" | "provider";

export interface BackendRequest {
  prompt: string;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface BackendMeta {
  kind: BackendKind;
  model: string;
  provider?: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface BackendResult {
  text: string;
  meta: BackendMeta;
}

export interface ModelBackend {
  kind: BackendKind;
  isReady(): Promise<boolean>;
  generate(req: BackendRequest): Promise<BackendResult>;
}

// Errors with this marker are safe to show verbatim. Everything else is
// wrapped by the caller as "Something went wrong: …".
export class BackendError extends Error {
  readonly userFacing = true;
  constructor(message: string) {
    super(message);
    this.name = "BackendError";
  }
}
