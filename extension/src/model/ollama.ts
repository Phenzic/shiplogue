import { cfg } from "../config";
import {
  BackendError,
  BackendRequest,
  BackendResult,
  ModelBackend,
} from "./types";

// Kept as its own class for backwards compatibility: tests and the e2e suite
// assert `instanceof OllamaError` and match the historical messages.
export class OllamaError extends BackendError {
  constructor(message: string) {
    super(message);
    this.name = "OllamaError";
  }
}

interface OllamaReply {
  response?: string;
  thinking?: string;
  done_reason?: string;
}

// Calls the local Ollama server with the style-guided prompt. Throws
// OllamaError with a friendly message if it can't be reached / model missing.
export class OllamaBackend implements ModelBackend {
  readonly kind = "ollama" as const;

  async isReady(): Promise<boolean> {
    const c = cfg();
    try {
      const res = await fetch(`${c.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: BackendRequest): Promise<BackendResult> {
    const started = Date.now();
    const c = cfg();
    // A user-set numPredict overrides the per-detail budget (reasoning models
    // often need far more room than the defaults).
    const budget = c.ollamaNumPredict > 0 ? c.ollamaNumPredict : req.maxTokens;

    const request = async (numPredict: number, forceThinkOff: boolean): Promise<OllamaReply> => {
      const body: Record<string, unknown> = {
        model: c.ollamaModel,
        prompt: req.prompt,
        stream: false,
        options: { temperature: req.temperature, num_ctx: c.ollamaNumCtx, num_predict: numPredict },
      };
      // "auto" sends nothing (server default); the empty-response retry below
      // forces thinking off so the budget goes to the actual answer.
      const think =
        forceThinkOff || c.ollamaThink === "off" ? false : c.ollamaThink === "on" ? true : undefined;
      if (think !== undefined) {
        body.think = think;
      }

      let res: Response;
      try {
        res = await fetch(`${c.ollamaUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch (e: any) {
        // Cancellation is not a connection problem — let it propagate.
        if (e?.name === "AbortError" || req.signal?.aborted) {
          throw e;
        }
        throw new OllamaError(
          `Couldn't reach Ollama at ${c.ollamaUrl}. Is it running? Start it with \`brew services start ollama\` and make sure you've pulled a model (\`ollama pull ${c.ollamaModel}\`).`,
        );
      }

      if (res.status === 404) {
        throw new OllamaError(
          `Model "${c.ollamaModel}" not found in Ollama. Run \`ollama pull ${c.ollamaModel}\`, or change "standup.ollama.model" in settings.`,
        );
      }
      if (!res.ok) {
        throw new OllamaError(`Ollama returned ${res.status} ${res.statusText}.`);
      }
      return (await res.json()) as OllamaReply;
    };

    const first = await request(budget, false);
    const text = (first.response ?? "").trim();

    // The stand-up template always ends with a **Blockers** section, so a
    // response cut short by num_predict (done_reason "length") without it is
    // incomplete — treat it like the empty-reasoning case and retry.
    const truncated =
      text.length > 0 && first.done_reason === "length" && !text.includes("**Blockers**");
    if (text && !truncated) {
      return this.result(text, c.ollamaModel, started);
    }

    // Reasoning models (gpt-oss, deepseek-r1, …) can spend the whole output
    // budget on `thinking` and return nothing. Retry once with a much larger
    // budget and — under "auto" — thinking disabled.
    const reasoned = (first.thinking ?? "").trim().length > 0 || first.done_reason === "length";
    if ((!text && reasoned) || truncated) {
      const retry = await request(Math.max(budget * 4, 4096), c.ollamaThink === "auto");
      const retryText = (retry.response ?? "").trim();
      if (retryText && (!truncated || retryText.includes("**Blockers**"))) {
        return this.result(retryText, c.ollamaModel, started);
      }
      if (truncated) {
        // Both attempts came back cut short — keep the more complete partial.
        return this.result(retryText.length > text.length ? retryText : text, c.ollamaModel, started);
      }
      throw new OllamaError(
        "Model spent its whole output budget on reasoning and returned nothing. Increase standup.ollama.numPredict or pick a non-reasoning model (e.g. llama3.2).",
      );
    }
    throw new OllamaError("Ollama returned an empty response.");
  }

  private result(text: string, model: string, started: number): BackendResult {
    return {
      text,
      meta: { kind: "ollama", model, durationMs: Date.now() - started },
    };
  }
}
