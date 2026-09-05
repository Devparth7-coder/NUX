/**
 * AI provider contract.
 *
 * NEXUS never hard-codes a single vendor. Everything that needs a language model
 * or an embedding goes through these interfaces, so OpenAI / Anthropic / Ollama /
 * a future provider can be swapped in `src/lib/ai/index.ts` without touching
 * pipeline code.
 */

import type { ExecutionMode } from '@/types';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AICompletionTask =
  | 'generic'
  | 'intent_refine'
  | 'plan_narrative'
  | 'research_summary'
  | 'knowledge_synthesis'
  | 'review_report'
  | 'artifact_document'
  | 'creative_copy'
  | 'analysis_insight'
  | 'memory_extract'
  | 'task_generation';

export interface AICompletionRequest {
  task?: AICompletionTask;
  messages: AIMessage[];
  /** Structured values injected into the prompt, and used by deterministic providers. */
  variables?: Record<string, unknown>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  jsonSchema?: Record<string, unknown>;
  tools?: AIToolSpec[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AICompletionResponse {
  text: string;
  json?: unknown;
  toolCalls?: AIToolCall[];
  usage: AIUsage;
  latencyMs: number;
  model: string;
  provider: string;
  mode: ExecutionMode;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
}

export interface AIStreamChunk {
  delta: string;
  done: boolean;
  usage?: AIUsage;
}

export interface EmbeddingResult {
  vectors: Float32Array[];
  model: string;
  provider: string;
  mode: ExecutionMode;
  latencyMs: number;
  dimensions: number;
}

export interface TokenCost {
  inputUsd: number;
  outputUsd: number;
  totalUsd: number;
}

export interface AIProvider {
  readonly id: string;
  readonly label: string;
  readonly mode: ExecutionMode;
  readonly supportsStreaming: boolean;
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  complete(request: AICompletionRequest): Promise<AICompletionResponse>;
  stream(request: AICompletionRequest): AsyncIterable<AIStreamChunk>;
  embed(texts: string[], model?: string): Promise<EmbeddingResult>;
  estimateCost(usage: AIUsage, model?: string): TokenCost;
  health(): Promise<{ ok: boolean; detail: string }>;
}
