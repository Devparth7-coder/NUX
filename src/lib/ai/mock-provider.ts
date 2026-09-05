import { deterministicGenerate } from "./deterministic";
import { coerceToSchema } from "./coerce";
import { estimateTokens } from "./pricing";
import { localEmbed } from "@/lib/retrieval/embeddings";
import type {
  AICompletion,
  AICompletionRequest,
  AIProvider,
  AIStreamChunk,
  EmbeddingResult,
  ProviderHealth,
} from "./types";
import { ExecutableError } from "@/lib/errors";

export const MOCK_MODEL = "nexus-deterministic";

/**
 * Deterministic provider used whenever no external model credential exists.
 * Every completion is flagged `simulated: true` so the UI can label DEMO MODE
 * honestly — the surrounding orchestration, retrieval and writes are real.
 */
export class MockProvider implements AIProvider {
  readonly id = "mock";
  readonly label = "NEXUS Deterministic Engine (DEMO MODE)";
  readonly defaultModel = MOCK_MODEL;
  readonly supportsStreaming = true;
  readonly supportsStructuredOutput = true;
  readonly supportsToolCalling = true;

  async complete<T>(req: AICompletionRequest): Promise<AICompletion<T>> {
    const started = Date.now();
    try {
      const raw = deterministicGenerate(req.purpose, req.messages, (req.metadata ?? {}) as Record<string, unknown>);
      const promptChars = (req.system ?? "").length + req.messages.reduce((a, m) => a + m.content.length, 0);

      let text: string;
      let data: T | undefined;

      if (req.schema) {
        const coerced = coerceToSchema<T>(req.schema, raw);
        if (!coerced.ok) throw new ExecutableError(`Structured output validation failed: ${coerced.error}`, { retryable: true });
        data = coerced.data;
        text = JSON.stringify(coerced.data, null, 2);
      } else {
        text = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
        data = raw as T;
      }

      const promptTokens = estimateTokens(String(promptChars));
      const completionTokens = estimateTokens(text);
      return {
        text,
        data,
        toolCalls: [],
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          costUsd: 0,
          latencyMs: Date.now() - started,
        },
        model: req.model ?? this.defaultModel,
        provider: this.id,
        simulated: true,
        finishReason: "stop",
        attempts: 1,
      };
    } catch (err) {
      throw err instanceof ExecutableError ? err : new ExecutableError(String(err), { retryable: false });
    }
  }

  async *stream(req: AICompletionRequest): AsyncIterable<AIStreamChunk> {
    const completion = await this.complete(req);
    const tokens = completion.text.match(/\S+\s*/g) ?? [completion.text];
    for (const token of tokens) {
      await new Promise((r) => setTimeout(r, 8));
      yield { delta: token, done: false };
    }
    yield { delta: "", done: true };
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const started = Date.now();
    const vectors = texts.map((t) => localEmbed(t));
    const tokens = texts.reduce((a, t) => a + estimateTokens(t), 0);
    return {
      vectors,
      model: "local-hashing-512",
      provider: this.id,
      usage: { promptTokens: tokens, completionTokens: 0, totalTokens: tokens, costUsd: 0, latencyMs: Date.now() - started },
      simulated: true,
    };
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    const probe = deterministicGenerate("intent.parse", [{ role: "user", content: "launch NEXUS this week" }], {});
    return {
      ok: Boolean(probe),
      provider: this.id,
      model: this.defaultModel,
      detail: "Deterministic local engine online — no external model credential configured (DEMO MODE).",
      latencyMs: Date.now() - started,
    };
  }
}
