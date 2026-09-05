import type { ZodTypeAny, z } from "zod";

export type AIRole = "system" | "user" | "assistant" | "tool";

export interface AIMessage {
  role: AIRole;
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface AIToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AICompletionRequest<T = unknown> = {
  /** Semantic purpose, e.g. `intent.parse`. Drives telemetry + deterministic fallbacks. */
  purpose: string;
  system?: string;
  messages: AIMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** When provided the response must satisfy this schema; output is validated before return. */
  schema?: ZodTypeAny;
  schemaName?: string;
  tools?: AIToolSpec[];
  metadata?: Record<string, unknown>;
};

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface AICompletion<T = unknown> {
  text: string;
  data?: T;
  toolCalls: AIToolCall[];
  usage: AIUsage;
  model: string;
  provider: string;
  /** True when produced by the deterministic local engine (DEMO MODE). */
  simulated: boolean;
  finishReason: "stop" | "length" | "tool_calls" | "error";
  attempts: number;
}

export interface AIStreamChunk {
  delta: string;
  done: boolean;
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  provider: string;
  usage: AIUsage;
  simulated: boolean;
}

export interface ProviderHealth {
  ok: boolean;
  provider: string;
  model: string;
  detail: string;
  latencyMs: number;
}

export interface AIProvider {
  readonly id: string;
  readonly label: string;
  readonly defaultModel: string;
  readonly supportsStreaming: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsToolCalling: boolean;
  complete<T = unknown>(req: AICompletionRequest): Promise<AICompletion<T>>;
  stream(req: AICompletionRequest): AsyncIterable<AIStreamChunk>;
  embed(texts: string[]): Promise<EmbeddingResult>;
  health(): Promise<ProviderHealth>;
}
