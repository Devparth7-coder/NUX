/** USD per 1M tokens. Used for cost accounting on every model call. */
export const PRICING: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "text-embedding-3-small": { in: 0.02, out: 0 },
  "local-deterministic": { in: 0, out: 0 },
  "nexus-deterministic": { in: 0, out: 0 },
};

export function costFor(model: string, promptTokens: number, completionTokens: number) {
  const p = PRICING[model] ?? PRICING["gpt-4o-mini"];
  return Number(((promptTokens / 1_000_000) * p.in + (completionTokens / 1_000_000) * p.out).toFixed(6));
}

/** Deterministic token estimate for providers that do not report usage. */
export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}
