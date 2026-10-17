/**
 * GET /dashboard/analytics/review.pdf (Phase 6.4B) against a real Postgres (TEST_DATABASE_URL):
 * authentication, ownership, the page's filters, response headers, no-signal refusal, account
 * locale, and the SAME analytics queries as the page (no report-specific query).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.RATE_LIMIT_STORE = "memory";
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, match, sf6Player } = await import("@/server/db/schema");
const { getAuth } = await import("@/server/auth/auth");
const { getEnv } = await import("@/server/env");
const { reviewPdfResponse } = await import("@/server/analytics/report/review-pdf-response");
const { REPORT_SCENARIOS } = await import("@/server/analytics/report/report-fixtures");
const route = await import("@/app/(app)/dashboard/analytics/review.pdf/route");

const SECRET_OPPONENT = "Opponent-Name-Must-Not-Leak";

describe.skipIf(!TEST_DB)("review report PDF route (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  const origin = TEST_DB ? new URL(getEnv().APP_URL).origin : "";
  let seq = 0;

  afterAll(async () => {
    await closeDb();
  });

  /** Real Better Auth account + session cookie, with an SF6 player. */
  async function signedIn(locale: string | null = null) {
    const email = `${randomUUID()}@test.local`;
    const res = await getAuth().api.signUpEmail({
      body: { email, password: "review-pdf-test-pw-123", name: "PDF" },
      asResponse: true,
    });
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const [user] = await db.select().from(authUser).where(eq(authUser.email, email));
    if (!user || !cookie) throw new Error("sign-up failed");
    if (locale) await db.update(authUser).set({ locale }).where(eq(authUser.id, user.id));
    const [player] = await db
      .insert(sf6Player)
      .values({ userId: user.id, cfnUserId: String(3_000_000_000 + ++seq), displayName: "P" })
      .returning();
    return { userId: user.id, playerId: player!.id, cookie };
  }

  /** The scenario's rows (2 signals: A.K.I. vs JP + Ken exposure), shifted to `daysAgo`. */
  async function seed(playerId: string, scenario: keyof typeof REPORT_SCENARIOS, daysAgo = 2) {
    const rows = REPORT_SCENARIOS[scenario]();
    const last = Math.max(...rows.map((r) => r.playedAt.getTime()));
    const shift = Date.now() - daysAgo * 86_400_000 - last;
    await db.insert(match).values(
      rows.map((r) => ({
        playerId,
        sessionId: null,
        externalMatchId: `${playerId.slice(0, 8)}-${r.externalMatchId}`,
        playedAt: new Date(r.playedAt.getTime() + shift),
        mode: r.mode,
        result: r.result,
        characterKey: r.characterKey,
        characterName: r.characterName,
        opponentName: SECRET_OPPONENT,
        opponentCharacterKey: r.opponentCharacterKey,
        opponentCharacter: r.opponentCharacterName,
        ratingBeforeSystem: "lp" as const,
        ratingBeforeValue: 19_000,
      })),
    );
  }

  const get = (query: string, headers: Record<string, string> = {}) =>
    route.GET(new Request(`${origin}/dashboard/analytics/review.pdf${query}`, { headers }));
  const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer());
  const today = () => new Date().toISOString().slice(0, 10);

  it("24. unauthenticated → 401, no PDF", async () => {
    const res = await get("?range=90d&mode=ranked");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).not.toContain("pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("26/28–31. valid filters → attachment PDF, private no-store, deterministic safe filename", async () => {
    const me = await signedIn();
    await seed(me.playerId, "matchupExposure");
    const res = await get("?range=90d&mode=ranked&character=aki", { cookie: me.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="sst-review-aki-ranked-90d-${today()}.pdf"`,
    );
    const pdf = await bytes(res);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(Number(res.headers.get("content-length"))).toBe(pdf.length);
    // No ids, e-mail or opponent player name anywhere (filename or document).
    const raw = pdf.toString("latin1");
    expect(raw).not.toContain(SECRET_OPPONENT);
    expect(raw).not.toContain(me.userId);
    expect(raw).not.toContain(me.playerId);
    expect(res.headers.get("content-disposition")).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}/);
  }, 60_000);

  it("27. invalid filters fall back exactly like the Analytics page", async () => {
    const me = await signedIn();
    await seed(me.playerId, "matchupExposure");
    const res = await get("?range=bogus&mode=nope&character=../../etc", { cookie: me.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="sst-review-all-characters-ranked-90d-${today()}.pdf"`,
    );
  }, 60_000);

  it("32. no selected signal → 409 text, never an empty branded PDF (account locale)", async () => {
    const es = await signedIn();
    await seed(es.playerId, "none");
    const res = await get("?range=90d&mode=ranked", { cookie: es.cookie });
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toBe(
      "No hay prioridades de revisión para exportar con estos filtros.",
    );
    // Account preference wins over the cookie; the cookie is used without one.
    const en = await signedIn("en");
    expect(await (await get("", { cookie: `${en.cookie}; NEXT_LOCALE=es` })).text()).toBe(
      "There are no review priorities to export with these filters.",
    );
    const cookieOnly = await signedIn();
    expect(await (await get("", { cookie: `${cookieOnly.cookie}; NEXT_LOCALE=en` })).text()).toBe(
      "There are no review priorities to export with these filters.",
    );
    // Accept-Language alone never decides.
    expect(
      await (await get("", { cookie: cookieOnly.cookie, "accept-language": "en-US" })).text(),
    ).toBe("No hay prioridades de revisión para exportar con estos filtros.");
  }, 60_000);

  it("25/33/34. ownership: only the session's account; smuggled ids / signals are ignored", async () => {
    const a = await signedIn();
    await seed(a.playerId, "matchupExposure");
    const b = await signedIn();
    await seed(b.playerId, "none");
    // B asks for A's report by every means: still B's (no signals) → 409.
    const smuggled = await get(
      `?range=90d&mode=ranked&playerId=${a.playerId}&userId=${a.userId}&signals=${encodeURIComponent('[{"id":"matchup:aki:jp"}]')}`,
      { cookie: b.cookie },
    );
    expect(smuggled.status).toBe(409);
    // A's own report is unaffected by B's matches.
    const mine = await get("?range=90d&mode=ranked", { cookie: a.cookie });
    expect(mine.status).toBe(200);
    // The route only implements GET: there is no body that could carry client metrics.
    expect(Object.keys(route).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["GET"]);
  }, 60_000);

  it("Mutation A guard: client-sent signals / metrics change nothing (server recomputes)", async () => {
    const me = await signedIn();
    await seed(me.playerId, "matchupExposure");
    const plain = await bytes(await get("?range=90d&mode=ranked", { cookie: me.cookie }));
    const tampered = await bytes(
      await get(`?range=90d&mode=ranked&winRate=99&deltaPp=50&review=${encodeURIComponent("{}")}`, {
        cookie: me.cookie,
      }),
    );
    // Same document apart from the creation timestamp: identical size.
    expect(tampered.length).toBe(plain.length);
  }, 60_000);

  it("35. the same range / mode drive the report (data outside the range ⇒ no signals)", async () => {
    const me = await signedIn();
    await seed(me.playerId, "matchupExposure", 20);
    expect((await get("?range=30d&mode=ranked", { cookie: me.cookie })).status).toBe(200);
    expect((await get("?range=7d&mode=ranked", { cookie: me.cookie })).status).toBe(409);
  }, 60_000);

  it("36. no new analytics query: same 3 selects as the page, same 9-column projection", async () => {
    const me = await signedIn();
    await seed(me.playerId, "matchupExposure");
    const selects: Array<string[] | null> = [];
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (prop === "select" && typeof value === "function") {
          return (fields?: Record<string, unknown>) => {
            selects.push(fields ? Object.keys(fields).sort() : null);
            return (value as (f?: unknown) => unknown).call(target, fields);
          };
        }
        if (prop === "insert" || prop === "update" || prop === "delete") {
          throw new Error(`unexpected write: ${String(prop)}`); // no storage
        }
        return value;
      },
    });
    const res = await reviewPdfResponse(counting, {
      userId: me.userId,
      locale: "es",
      searchParams: new URLSearchParams("range=90d&mode=ranked"),
    });
    expect(res.status).toBe(200);
    expect(selects).toHaveLength(3);
    expect(selects[2]).toEqual(
      [
        "characterKey",
        "characterName",
        "externalMatchId",
        "mode",
        "opponentCharacterKey",
        "opponentCharacterName",
        "playedAt",
        "result",
        "sessionId",
      ].sort(),
    );
  }, 60_000);

  it("a user without a player gets 404 (no report)", async () => {
    const res = await reviewPdfResponse(db, {
      userId: randomUUID(),
      locale: "es",
      searchParams: new URLSearchParams(),
    });
    expect(res.status).toBe(404);
  });
});
