/**
 * Bounded admission of the on-demand review report (TEST_DATABASE_URL only): ordinary use still
 * works; repeated and concurrent requests are refused predictably (429 / 503 + Retry-After)
 * before any analytics query; accounts do not interfere with each other; slots are released on
 * success and on failure; refusals reveal nothing but a localized message.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.RATE_LIMIT_STORE = "postgres"; // the shared, cross-instance store used in production
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, match, sf6Player } = await import("@/server/db/schema");
const { getAuth } = await import("@/server/auth/auth");
const { getEnv } = await import("@/server/env");
const { REVIEW_PDF_LIMITS, guardedReviewPdfResponse, resetReviewPdfGate } =
  await import("@/server/analytics/report/review-pdf-response");
const { REPORT_SCENARIOS } = await import("@/server/analytics/report/report-fixtures");
const { createWorkGate } = await import("@/server/security/work-gate");
const route = await import("@/app/(app)/dashboard/analytics/review.pdf/route");
const es = (await import("@/i18n/messages/es.json")).default;
const en = (await import("@/i18n/messages/en.json")).default;

describe.skipIf(!TEST_DB)("review report: bounded admission (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  const origin = TEST_DB ? new URL(getEnv().APP_URL).origin : "";
  const users: string[] = [];
  let seq = 0;

  beforeEach(() => resetReviewPdfGate());
  afterAll(async () => {
    if (users.length) {
      for (const id of users) await db.delete(authUser).where(eq(authUser.id, id));
    }
    await closeDb();
  });

  async function signedIn(locale: "es" | "en" = "es") {
    const email = `${randomUUID()}@test.local`;
    const res = await getAuth().api.signUpEmail({
      body: { email, password: "review-admission-pw-123", name: "PDF" },
      asResponse: true,
    });
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const [user] = await db.select().from(authUser).where(eq(authUser.email, email));
    if (!user || !cookie) throw new Error("sign-up failed");
    users.push(user.id);
    await db.update(authUser).set({ locale }).where(eq(authUser.id, user.id));
    const [player] = await db
      .insert(sf6Player)
      .values({ userId: user.id, cfnUserId: String(3_100_000_000 + ++seq), displayName: "P" })
      .returning();
    const rows = REPORT_SCENARIOS.matchupExposure();
    const last = Math.max(...rows.map((r) => r.playedAt.getTime()));
    const shift = Date.now() - 2 * 86_400_000 - last;
    await db.insert(match).values(
      rows.map((r) => ({
        playerId: player!.id,
        sessionId: null,
        externalMatchId: `${player!.id.slice(0, 8)}-${r.externalMatchId}`,
        playedAt: new Date(r.playedAt.getTime() + shift),
        mode: r.mode,
        result: r.result,
        characterKey: r.characterKey,
        characterName: r.characterName,
        opponentCharacterKey: r.opponentCharacterKey,
        opponentCharacter: r.opponentCharacterName,
      })),
    );
    return { userId: user.id, cookie, locale };
  }

  const get = (cookie: string) =>
    route.GET(
      new Request(`${origin}/dashboard/analytics/review.pdf?range=90d&mode=ranked`, {
        headers: { cookie },
      }),
    );
  const input = (userId: string, locale: "es" | "en" = "es") => ({
    userId,
    locale,
    searchParams: new URLSearchParams("range=90d&mode=ranked"),
  });

  it("ordinary use: one export per account still downloads the PDF", async () => {
    const me = await signedIn();
    const res = await get(me.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("unauthenticated requests are refused before admission (401, gate untouched)", async () => {
    const res = await route.GET(new Request(`${origin}/dashboard/analytics/review.pdf`));
    expect(res.status).toBe(401);
  });

  it("concurrent requests of one account: exactly one is admitted, the rest get 429 + Retry-After", async () => {
    const me = await signedIn();
    // Admission is decided synchronously when the request reaches the guard.
    const results = await Promise.all(
      [1, 2, 3].map(() => guardedReviewPdfResponse(db, input(me.userId))),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 429, 429]);
    for (const r of results.filter((x) => x.status === 429)) {
      expect(r.headers.get("retry-after")).toBe(String(REVIEW_PDF_LIMITS.busyRetrySeconds));
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      expect(await r.text()).toBe(es.Analytics.reviewReport.errors.inProgress);
    }
  });

  it("repeated requests: the per-account quota answers 429 with the time to wait; recovery after the window", async () => {
    const me = await signedIn("en");
    for (let i = 0; i < REVIEW_PDF_LIMITS.perAccount; i++) {
      expect((await get(me.cookie)).status).toBe(200);
      resetReviewPdfGate(); // isolate the account quota from the process budget
    }
    const res = await get(me.cookie);
    expect(res.status).toBe(429);
    const retry = Number(res.headers.get("retry-after"));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(REVIEW_PDF_LIMITS.perAccountWindowMs / 1000);
    expect(await res.text()).toBe(en.Analytics.reviewReport.errors.tooMany);
    // Window over (simulated by expiring the account's bucket): admitted again.
    await db.execute(
      (await import("drizzle-orm"))
        .sql`update rate_limit_bucket set reset_at = now() - interval '1 second' where key = ${`review-pdf:${me.userId}`}`,
    );
    expect((await get(me.cookie)).status).toBe(200);
  });

  it("no cross-account interference: one account's quota and in-flight job never block another", async () => {
    const a = await signedIn();
    const b = await signedIn();
    for (let i = 0; i < REVIEW_PDF_LIMITS.perAccount; i++) {
      await get(a.cookie);
      resetReviewPdfGate();
    }
    expect((await get(a.cookie)).status).toBe(429);
    expect((await get(b.cookie)).status).toBe(200);
  });

  it("process capacity: beyond the in-flight bound other accounts get 503 + Retry-After, no analytics read", async () => {
    const accounts = await Promise.all([signedIn(), signedIn(), signedIn()]);
    const gate = createWorkGate({
      maxInFlight: 2,
      maxPerWindow: 100,
      windowMs: 60_000,
      busyRetrySeconds: 5,
    });
    let reads = 0;
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "select") reads++;
        return Reflect.get(target, prop, receiver);
      },
    });
    // Two renders occupy the process; the third account is refused immediately.
    const first = guardedReviewPdfResponse(db, input(accounts[0]!.userId), gate);
    const second = guardedReviewPdfResponse(db, input(accounts[1]!.userId), gate);
    const third = await guardedReviewPdfResponse(counting, input(accounts[2]!.userId), gate);
    expect(third.status).toBe(503);
    expect(third.headers.get("retry-after")).toBe("5");
    expect(await third.text()).toBe(es.Analytics.reviewReport.errors.busy);
    expect(reads).toBe(0);
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    // Capacity freed: admitted again.
    expect((await guardedReviewPdfResponse(db, input(accounts[2]!.userId), gate)).status).toBe(200);
  });

  it("process budget per window is enforced across accounts", async () => {
    const accounts = await Promise.all([signedIn(), signedIn()]);
    const gate = createWorkGate({
      maxInFlight: 2,
      maxPerWindow: 1,
      windowMs: 60_000,
      busyRetrySeconds: 5,
    });
    expect((await guardedReviewPdfResponse(db, input(accounts[0]!.userId), gate)).status).toBe(200);
    const res = await guardedReviewPdfResponse(db, input(accounts[1]!.userId), gate);
    expect(res.status).toBe(503);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("error recovery: a failing render releases its slot (the account can retry)", async () => {
    const me = await signedIn();
    const gate = createWorkGate({
      maxInFlight: 1,
      maxPerWindow: 100,
      windowMs: 60_000,
      busyRetrySeconds: 5,
    });
    const broken = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "select") throw new Error("simulated database failure");
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(guardedReviewPdfResponse(broken, input(me.userId), gate)).rejects.toThrow();
    expect(gate.stats().inFlight).toBe(0);
    expect((await guardedReviewPdfResponse(db, input(me.userId), gate)).status).toBe(200);
  });

  it("refusals disclose nothing beyond a localized message (no ids, limits or internals)", async () => {
    const me = await signedIn();
    const [, refusedRes] = await Promise.all([
      guardedReviewPdfResponse(db, input(me.userId)),
      guardedReviewPdfResponse(db, input(me.userId)),
    ]);
    const body = await refusedRes.text();
    expect(refusedRes.status).toBe(429);
    expect(body).not.toContain(me.userId);
    expect(body).not.toMatch(/review-pdf|rate|limit|stack|Error|\d/);
    expect(refusedRes.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });
});
