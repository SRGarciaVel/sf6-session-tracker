/**
 * Distributed rate limiting against a real Postgres (SEC-002 / SEC-003).
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.RATE_LIMIT_STORE = "postgres";
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { postgresStore, rateLimit, setRateLimitStore } =
  await import("@/server/security/rate-limit");
const { getAuth } = await import("@/server/auth/auth");
const { getEnv } = await import("@/server/env");

describe.skipIf(!TEST_DB)("distributed rate limiting (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);

  beforeAll(async () => {
    await db.execute(sql`truncate rate_limit_bucket, auth_rate_limit`);
  });
  afterAll(async () => {
    setRateLimitStore(null);
    await closeDb();
  });

  it("postgres store is atomic: 50 concurrent checks across 'instances' allow exactly the limit", async () => {
    // Two independent store objects = two app instances sharing one database.
    const a = postgresStore(getDb);
    const b = postgresStore(getDb);
    const key = `test:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => (i % 2 ? a : b).consume(key, 10, 60_000)),
    );
    const allowed = results.filter((r) => r.count <= 10).length;
    expect(allowed).toBe(10);
    expect(new Set(results.map((r) => r.count)).size).toBe(50); // every increment counted once
  });

  it("the configured limiter uses Postgres and resets after the window", async () => {
    setRateLimitStore(null); // pick from env → postgres
    const key = `test:${randomUUID()}`;
    expect((await rateLimit(key, 1, 300)).ok).toBe(true);
    expect((await rateLimit(key, 1, 300)).ok).toBe(false);
    const [row] = (await db.execute(
      sql`select count from rate_limit_bucket where key = ${key}`,
    )) as unknown as Array<{ count: number }>;
    expect(Number(row?.count)).toBe(2);
    await new Promise((r) => setTimeout(r, 350));
    expect((await rateLimit(key, 1, 300)).ok).toBe(true);
  });

  it("Better Auth sign-in brute force is limited through the shared database store", async () => {
    const appUrl = getEnv().APP_URL;
    const email = `${randomUUID()}@test.local`;
    const ip = `198.18.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
    const attempt = () =>
      getAuth().handler(
        new Request(`${appUrl}/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: appUrl,
            // Fresh IP per run: buckets persist in Postgres across runs.
            "x-forwarded-for": ip,
          },
          body: JSON.stringify({ email, password: "wrong-password-123" }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]); // Phase 4.6 sign-in rule: 10 per 5 min per IP
    const rows = (await db.execute(
      sql`select count(*)::int as n from auth_rate_limit`,
    )) as unknown as Array<{
      n: number;
    }>;
    expect(rows[0]?.n).toBeGreaterThan(0); // stored in Postgres, not process memory
  });
});
