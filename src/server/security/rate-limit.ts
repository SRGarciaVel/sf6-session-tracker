/**
 * Rate limiting behind one interface, with two stores (RATE_LIMIT_STORE):
 *
 *   memory   — per process. Dev/tests only: with N instances (Vercel functions, several Node
 *              processes) every instance has its own counters, so limits become N× looser and an
 *              attacker spreading requests across instances evades them (SEC-003).
 *   postgres — shared by every instance (table rate_limit_bucket, one atomic upsert per check).
 *              Default in production. No extra infrastructure: the app already has Postgres.
 *
 * Fixed window per key. Keys are namespaced by purpose + subject (user / device / IP).
 *
 * Failure mode when the store is unreachable (Postgres down):
 *   failClosed: true  → deny (pairing, auth-adjacent: brute-force targets)
 *   failClosed: false → allow (overlay reads, sync: availability over strictness; the DB they
 *                       need is down anyway, so they fail on their own)
 */
import { sql } from "drizzle-orm";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  consume(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ count: number; resetAt: number }>;
}

/* ───────── memory ───────── */

interface Bucket {
  count: number;
  resetAt: number;
}
interface RateLimitGlobal {
  __sf6RateLimit?: Map<string, Bucket>;
}
const g = globalThis as RateLimitGlobal;
const buckets = (g.__sf6RateLimit ??= new Map<string, Bucket>());

export const memoryStore: RateLimitStore = {
  async consume(key, _limit, windowMs) {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
      if (buckets.size > 10_000) {
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      }
    }
    bucket.count++;
    return { count: bucket.count, resetAt: bucket.resetAt };
  },
};

/* ───────── postgres (distributed) ───────── */

type SqlExecutor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

/** Atomic fixed-window counter: a single INSERT … ON CONFLICT DO UPDATE per check. */
export function postgresStore(db: () => SqlExecutor): RateLimitStore {
  return {
    async consume(key, _limit, windowMs) {
      const interval = `${windowMs} milliseconds`;
      const rows = (await db().execute(sql`
        insert into rate_limit_bucket (key, count, reset_at)
        values (${key}, 1, now() + ${interval}::interval)
        on conflict (key) do update set
          count = case when rate_limit_bucket.reset_at <= now() then 1
                       else rate_limit_bucket.count + 1 end,
          reset_at = case when rate_limit_bucket.reset_at <= now() then now() + ${interval}::interval
                          else rate_limit_bucket.reset_at end
        returning count, extract(epoch from reset_at) * 1000 as reset_ms
      `)) as Array<{ count: number | string; reset_ms: number | string }>;
      const row = rows[0];
      if (!row) throw new Error("rate limit upsert returned no row");
      // Opportunistic housekeeping (~1% of checks): expired buckets are dead weight.
      if (Math.random() < 0.01) {
        void db()
          .execute(sql`delete from rate_limit_bucket where reset_at < now() - interval '1 hour'`)
          .catch(() => undefined);
      }
      return { count: Number(row.count), resetAt: Number(row.reset_ms) };
    },
  };
}

/* ───────── configured limiter ───────── */

let configured: RateLimitStore | null = null;

/** Store selection (lazy, from env). Tests may inject one with setRateLimitStore. */
async function store(): Promise<RateLimitStore> {
  if (configured) return configured;
  const { getEnv } = await import("@/server/env");
  if (getEnv().RATE_LIMIT_STORE === "postgres") {
    const { getDb } = await import("@/server/db/client");
    configured = postgresStore(getDb);
  } else {
    configured = memoryStore;
  }
  return configured;
}

export function setRateLimitStore(next: RateLimitStore | null): void {
  configured = next;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  options: { failClosed?: boolean } = {},
): Promise<RateLimitResult> {
  try {
    const { count, resetAt } = await (await store()).consume(key, limit, windowMs);
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
    };
  } catch {
    // Store unreachable: documented per call site (see header).
    return options.failClosed
      ? { ok: false, remaining: 0, retryAfterSeconds: 30 }
      : { ok: true, remaining: 0, retryAfterSeconds: 0 };
  }
}

/** Tests: clear the in-memory buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}
