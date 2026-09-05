import { env, isDemoMode } from "@/lib/env";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { ExecutableError } from "@/lib/errors";
import { MockProvider } from "./mock-provider";
import { OpenAIProvider } from "./openai-provider";
import type { AICompletion, AICompletionRequest, AIProvider, ProviderHealth } from "./types";

const providers: Record<string, AIProvider> = {
  mock: new MockProvider(),
  openai: new OpenAIProvider(),
};

export function getProvider(id?: string): AIProvider {
  const key = id ?? (env.AI_PROVIDER === "openai" && env.OPENAI_API_KEY ? "openai" : "mock");
  return providers[key] ?? providers.mock;
}

export function activeProvider(): AIProvider {
  return getProvider();
}

export function providerInfo() {
  const p = activeProvider();
  return {
    id: p.id,
    label: p.label,
    model: p.defaultModel,
    demoMode: isDemoMode,
    supportsStreaming: p.supportsStreaming,
    supportsStructuredOutput: p.supportsStructuredOutput,
    supportsToolCalling: p.supportsToolCalling,
    hasKey: Boolean(env.OPENAI_API_KEY),
  };
}

export async function providerHealth(): Promise<ProviderHealth> {
  return activeProvider().health();
}

export type TelemetryCtx = { workspaceId: string; runId?: string | null };

/**
 * Single entry point for every model call: retries transient failures,
 * enforces wall-clock timeout, persists usage telemetry, and never throws
 * unhandled — failures surface as structured results the orchestrator can act on.
 */
export async function completeWithTelemetry<T>(
  req: AICompletionRequest,
  ctx: TelemetryCtx,
  opts: { maxAttempts?: number; timeoutMs?: number } = {},
): Promise<AICompletion<T>> {
  const provider = getProvider();
  const maxAttempts = opts.maxAttempts ?? 2;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let lastError: unknown;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts += 1;
    const started = Date.now();
    try {
      const result = await withTimeout(provider.complete<T>(req), timeoutMs);
      result.attempts = attempts;
      await persistCall({ ...ctx, req, completion: result, status: "ok" });
      return result;
    } catch (err) {
      lastError = err;
      const retryable = err instanceof ExecutableError ? err.retryable : false;
      log.warn(`model call failed (${req.purpose}) attempt ${attempts}/${maxAttempts}`, { retryable, message: String(err) });

      const usage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - started,
      };
      await persistCall({ ...ctx, req, completion: null, status: "error", error: String(err), usage });

      if (!retryable || attempts >= maxAttempts) break;
      await new Promise((r) => setTimeout(r, 250 * attempts));
    }
  }

  // Deterministic fallback: keep the pipeline moving, but flag it loudly.
  log.error(`model call exhausted retries for ${req.purpose}; using deterministic fallback`);
  const fallback = await new MockProvider().complete<T>(req);
  fallback.attempts = attempts;
  await persistCall({ ...ctx, req, completion: fallback, status: "fallback" });
  return fallback;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ExecutableError(`Model call timed out after ${ms}ms`, { retryable: true })), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function persistCall(args: {
  workspaceId: string;
  runId?: string | null;
  req: AICompletionRequest;
  completion: AICompletion<unknown> | null;
  status: string;
  error?: string;
  usage?: AICompletion<unknown>["usage"];
}) {
  const { workspaceId, runId, req, completion, status, error } = args;
  const usage = completion?.usage ?? args.usage!;
  try {
    await prisma.modelCall.create({
      data: {
        workspaceId,
        runId: runId ?? null,
        provider: completion?.provider ?? "unknown",
        model: completion?.model ?? req.model ?? "unknown",
        purpose: req.purpose,
        tokensIn: usage.promptTokens,
        tokensOut: usage.completionTokens,
        costUsd: usage.costUsd,
        latencyMs: usage.latencyMs,
        status,
        error: error ?? null,
        simulated: completion?.simulated ?? true,
      },
    });
  } catch (e) {
    log.error("failed to persist model telemetry", e);
  }
}

export type { AICompletion, AICompletionRequest, AIProvider };
