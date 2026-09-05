/**
 * OpenAIProvider — real network-backed provider.
 * Activated when NEXUS_AI_PROVIDER=openai and OPENAI_API_KEY is present.
 * Streaming, tool calling, JSON mode and embeddings are all real.
 *
 * The API key is read server-side only and is never serialised into a response.
 */

import type {
  AICompletionRequest,
  AICompletionResponse,
  AIProvider,
  AIStreamChunk,
  AIUsage,
  AIToolCall,
  EmbeddingResult,
  TokenCost,
} from './types';
import { NexusError } from '../errors';
import { env } from '../env';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

/** USD per 1M tokens. Update as pricing changes. */
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
};

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  readonly label = 'OpenAI';
  readonly mode: 'REAL' = 'REAL';
  readonly supportsStreaming = true;
  readonly supportsTools = true;
  readonly supportsVision = true;

  private get apiKey(): string {
    const key = env.openaiApiKey;
    if (!key) throw new NexusError('PROVIDER_ERROR', 'OPENAI_API_KEY is not configured');
    return key;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const started = Date.now();
    const model = request.model ?? env.aiModel;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 60_000);
    request.signal?.addEventListener('abort', () => controller.abort());

    try {
      const body: Record<string, unknown> = {
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 2048,
        stream: false,
      };
      if (request.responseFormat === 'json') body.response_format = { type: 'json_object' };
      if (request.tools?.length) {
        body.tools = request.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }

      const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new NexusError('PROVIDER_ERROR', `OpenAI request failed (${res.status})`, {
          details: detail.slice(0, 500),
          retryable: res.status >= 500 || res.status === 429,
        });
      }

      const data = (await res.json()) as {
        choices: {
          message: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
          finish_reason?: string;
        }[];
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      const choice = data.choices[0];
      const text = choice?.message?.content ?? '';
      const usage: AIUsage = {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      };

      let json: unknown;
      if (request.responseFormat === 'json') {
        try {
          json = JSON.parse(text);
        } catch {
          throw new NexusError('PROVIDER_ERROR', 'Model returned invalid JSON');
        }
      }

      const toolCalls: AIToolCall[] | undefined = choice?.message?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeJsonParseArgs(tc.function.arguments),
      }));

      return {
        text,
        json,
        toolCalls,
        usage,
        latencyMs: Date.now() - started,
        model,
        provider: this.id,
        mode: 'REAL',
        finishReason: mapFinishReason(choice?.finish_reason),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(request: AICompletionRequest): AsyncIterable<AIStreamChunk> {
    const model = request.model ?? env.aiModel;
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 2048,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: request.signal,
    });

    if (!res.ok || !res.body) {
      throw new NexusError('PROVIDER_ERROR', `OpenAI stream failed (${res.status})`, { retryable: res.status >= 500 });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') {
          yield { delta: '', done: true };
          return;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
          };
          const delta = parsed.choices?.[0]?.delta?.content ?? '';
          if (delta) yield { delta, done: false };
          if (parsed.usage) {
            yield {
              delta: '',
              done: false,
              usage: {
                promptTokens: parsed.usage.prompt_tokens,
                completionTokens: parsed.usage.completion_tokens,
                totalTokens: parsed.usage.total_tokens,
              },
            };
          }
        } catch {
          /* ignore malformed keep-alive chunks */
        }
      }
    }
    yield { delta: '', done: true };
  }

  async embed(texts: string[], model = 'text-embedding-3-small'): Promise<EmbeddingResult> {
    const started = Date.now();
    const res = await fetch(EMBEDDINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok) throw new NexusError('PROVIDER_ERROR', `Embedding request failed (${res.status})`);
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    return {
      vectors: data.data.map((d) => Float32Array.from(d.embedding)),
      model,
      provider: this.id,
      mode: 'REAL',
      latencyMs: Date.now() - started,
      dimensions: data.data[0]?.embedding.length ?? 0,
    };
  }

  estimateCost(usage: AIUsage, model = env.aiModel): TokenCost {
    const price = PRICING[model] ?? PRICING['gpt-4o-mini']!;
    const inputUsd = (usage.promptTokens / 1_000_000) * price.input;
    const outputUsd = (usage.completionTokens / 1_000_000) * price.output;
    return { inputUsd, outputUsd, totalUsd: inputUsd + outputUsd };
  }

  async health() {
    if (!env.openaiApiKey) return { ok: false, detail: 'OPENAI_API_KEY missing — provider inactive.' };
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${env.openaiApiKey}` },
      });
      return { ok: res.ok, detail: res.ok ? 'Connected to OpenAI.' : `Status ${res.status}` };
    } catch (e) {
      return { ok: false, detail: String(e) };
    }
  }
}

function safeJsonParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapFinishReason(reason?: string): AICompletionResponse['finishReason'] {
  if (reason === 'length') return 'length';
  if (reason === 'tool_calls') return 'tool_calls';
  if (reason === 'stop') return 'stop';
  return 'stop';
}
