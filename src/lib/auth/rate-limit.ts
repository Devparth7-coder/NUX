/** Sliding-window rate limiter. In-process; swap for Redis in multi-node deploys. */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  const allowed = bucket.hits.length < limit;
  if (allowed) bucket.hits.push(now);
  buckets.set(key, bucket);

  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (!v.hits.length) buckets.delete(k);
  }

  return {
    allowed,
    remaining: Math.max(0, limit - bucket.hits.length),
    resetAt: now + windowMs,
  };
}
