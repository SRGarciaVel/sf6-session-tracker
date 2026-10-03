/**
 * Fixed-window in-memory rate limiter. Per process — good enough for an MVP with a handful of
 * instances (limits become N× looser). Swap for a Postgres/Redis-backed limiter if needed; the
 * call sites only depend on `rateLimit()`.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

interface RateLimitGlobal {
  __sf6RateLimit?: Map<string, Bucket>;
}
const g = globalThis as RateLimitGlobal;
const buckets = (g.__sf6RateLimit ??= new Map<string, Bucket>());

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
    if (buckets.size > 10_000) prune(now);
  }
  bucket.count++;
  return {
    ok: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

export function resetRateLimits(): void {
  buckets.clear();
}
