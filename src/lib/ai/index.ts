/**
 * AI provider registry + facade.
 *
 * Retry, timeout, token accounting and latency tracking live here so no agent
 * has to reimplement them. Swap providers by changing NEXUS_AI_PROVIDER.
 */

import type {
  AICompletionRequest,
  AICompletionResponse,
  AIProvider,
  AIStreamChunk,
  EmbeddingResult,
} from './types';
import { MockProvider } from './mock';
import { OpenAIProvider } from './openai';
import { env, isDemoMode } from '../env';
import { NexusError, toNexusError } from '../errors';
import { createLogger } from '../logger';
import { embedLocal, EMBED_DIMENSIONS, serializeEmbedding } from '../retrieval/embed';

const log = createLogger('ai');

const providers: Record<string, AIProvider> = {
  mock: new MockProvider(),
  openai: new OpenAIProvider(),
};

export function getProvider(): AIProvider {
  return providers[env.aiProvider] ?? providers.mock!;
}

export function listProviders() {
  return Object.values(providers).map((p) => ({
    id: p.id,
    label: p.label,
    mode: p.mode,
    supportsStreaming: p.supportsStreaming,
    supportsTools: p.supportsTools,
    supportsVision: p.supportsVision,
    active: p.id === getProvider().id,
  }));
}

export function isDemo(): boolean {
  return isDemoMode();
}

/** Retry with exponential backoff. Only retryable failures are retried. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 400): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const nexus = toNexusError(err);
      const retryable = nexus instanceof NexusError && nexus.retryable;
      if (attempt >= attempts || !retryable) break;
      log.warn('retrying', { attempt, error: nexus.message });
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 1)));
    }
  }
  throw lastError;
}

export async function complete(request: AICompletionRequest): Promise<AICompletionResponse> {
  const provider = getProvider();
  const started = Date.now();
  try {
    const response = await withRetry(() => provider.complete(request));
    log.info('completion', {
      task: request.task ?? 'generic',
      provider: response.provider,
      mode: response.mode,
      latencyMs: response.latencyMs,
      totalTokens: response.usage.totalTokens,
    });
    return response;
  } catch (err) {
    const e = toNexusError(err);
    log.error('completion failed', { error: e.message, totalMs: Date.now() - started });
    throw e;
  }
}

export async function* stream(request: AICompletionRequest): AsyncIterable<AIStreamChunk> {
  const provider = getProvider();
  if (!provider.supportsStreaming) {
    const response = await provider.complete(request);
    yield { delta: response.text, done: true, usage: response.usage };
    return;
  }
  yield* provider.stream(request);
}

/**
 * Embeddings. Uses the configured provider when it is real; otherwise falls back
 * to the local deterministic model, which is always available and offline.
 */
export async function embed(texts: string[], model?: string): Promise<EmbeddingResult> {
  const provider = getProvider();
  if (provider.mode === 'REAL' && env.embedProvider !== 'local') {
    try {
      return await withRetry(() => provider.embed(texts, model), 2);
    } catch (err) {
      log.warn('remote embedding failed, using local model', { error: String(err) });
    }
  }
  const started = Date.now();
  return {
    vectors: texts.map((t) => embedLocal(t, EMBED_DIMENSIONS)),
    model: model ?? env.embedModel,
    provider: 'local',
    mode: 'DEMO',
    latencyMs: Date.now() - started,
    dimensions: EMBED_DIMENSIONS,
  };
}

/** Synchronous single-text embedding for ingestion hot paths. */
export function embedSync(text: string): Float32Array {
  return embedLocal(text, EMBED_DIMENSIONS);
}

export function embedSyncSerialized(text: string): string {
  return serializeEmbedding(embedLocal(text, EMBED_DIMENSIONS));
}

export type { AICompletionRequest, AICompletionResponse, AIProvider };
