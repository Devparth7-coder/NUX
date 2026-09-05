import { env } from "@/lib/env";
import { coerceToSchema } from "./coerce";
import { costFor, estimateTokens } from "./pricing";
import { localEmbed } from "@/lib/retrieval/embeddings";
import type {
  AICompletion,
  AICompletionRequest,
  AIMessage,
  AIProvider,
  AIStreamChunk,
  EmbeddingResult,
  ProviderHealth,
} from "./types";
import { ExecutableError } from "@/lib/errors";

const BASE = "https://api.openai.com/v1";

export class OpenAIProvider implements AIProvider {
  readonly id = "openai";
  readonly label = "OpenAI";
  readonly defaultModel = env.OPENAI_MODEL;
  readonly supportsStreaming = true;
  readonly supportsStructuredOutput = true;
  readonly supportsToolCalling = true;

  private get key() {
    if (!env.OPENAI_API_KEY) throw new ExecutableError("OPENAI_API_KEY is not configured", { retryable: false });
    return env.OPENAI_API_KEY;
  }

  async complete<T>(req: AICompletionRequest): Promise<AICompletion<T>> {
    const started = Date.now();
    const model = req.model ?? this.defaultModel;
    const messages = req.system ? [{ role: "system" as const, content: req.system }, ...req.messages] : req.messages;

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 2048,
    };
    if (req.schema) body.response_format = { type: "json_object" };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    }

    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new ExecutableError(`OpenAI request failed (${res.status}): ${detail.slice(0, 300)}`, {
        retryable: res.status >= 500 || res.status === 429,
      });
    }

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason: string }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model: string;
    };

    const choice = json.choices[0];
    const text = choice?.message?.content ?? "";
    const usage = json.usage ?? { prompt_tokens: estimateTokens(JSON.stringify(messages)), completion_tokens: estimateTokens(text), total_tokens: 0 };

    let data: T | undefined;
    if (req.schema) {
      const coerced = coerceToSchema<T>(req.schema, text);
      if (!coerced.ok) throw new ExecutableError(`Structured output validation failed: ${coerced.error}`, { retryable: true });
      data = coerced.data;
    }

    return {
      text,
      data,
      toolCalls: (choice?.message?.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        arguments: safeJson(c.function.arguments),
      })),
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens || usage.prompt_tokens + usage.completion_tokens,
        costUsd: costFor(model, usage.prompt_tokens, usage.completion_tokens),
        latencyMs: Date.now() - started,
      },
      model: json.model ?? model,
      provider: this.id,
      simulated: false,
      finishReason: choice?.finish_reason === "tool_calls" ? "tool_calls" : "stop",
      attempts: 1,
    };
  }

  async *stream(req: AICompletionRequest): AsyncIterable<AIStreamChunk> {
    const model = req.model ?? this.defaultModel;
    const messages = req.system ? [{ role: "system" as const, content: req.system }, ...req.messages] : req.messages;
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ model, messages, temperature: req.temperature ?? 0.2, stream: true }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok || !res.body) throw new ExecutableError(`OpenAI stream failed (${res.status})`, { retryable: true });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          yield { delta: "", done: true };
          return;
        }
        try {
          const parsed = JSON.parse(payload) as { choices: Array<{ delta?: { content?: string } }> };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { delta, done: false };
        } catch {
          /* keep-alive or malformed chunk */
        }
      }
    }
    yield { delta: "", done: true };
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const started = Date.now();
    const model = env.OPENAI_EMBEDDING_MODEL;
    const res = await fetch(`${BASE}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ model, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      // Deterministic fallback keeps ingestion working when the API is unreachable.
      const detail = await res.text().catch(() => "");
      const vectors = texts.map((t) => localEmbed(t));
      return {
        vectors,
        model: "local-hashing-512-fallback",
        provider: `${this.id}-fallback`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, latencyMs: Date.now() - started },
        simulated: true,
      };
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[] }>; usage?: { prompt_tokens: number; total_tokens: number } };
    const tokens = json.usage?.total_tokens ?? texts.reduce((a, t) => a + estimateTokens(t), 0);
    return {
      vectors: json.data.map((d) => d.embedding),
      model,
      provider: this.id,
      usage: { promptTokens: tokens, completionTokens: 0, totalTokens: tokens, costUsd: costFor(model, tokens, 0), latencyMs: Date.now() - started },
      simulated: false,
    };
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    if (!env.OPENAI_API_KEY) {
      return { ok: false, provider: this.id, model: this.defaultModel, detail: "OPENAI_API_KEY not configured", latencyMs: 0 };
    }
    try {
      const res = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(10_000) });
      return {
        ok: res.ok,
        provider: this.id,
        model: this.defaultModel,
        detail: res.ok ? "Connected to OpenAI" : `OpenAI responded ${res.status}`,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return { ok: false, provider: this.id, model: this.defaultModel, detail: String(err), latencyMs: Date.now() - started };
    }
  }
}

function safeJson(input: string): Record<string, unknown> {
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type { AIMessage };
