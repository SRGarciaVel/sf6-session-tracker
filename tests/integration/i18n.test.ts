/**
 * Language is presentation-only: persisting it, or switching an overlay's language mid-session,
 * must not touch sessions, stats, baselines, tokens or trackers.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.LOG_LEVEL = "error";

const { getDb, getSql, closeDb } = await import("@/server/db/client");
const { authUser, gameSession, sf6Player } = await import("@/server/db/schema");
const { getOverlayByToken, listOverlays, updateOverlay } =
  await import("@/server/overlays/service");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { buildPlayerLiveState, startSession } = await import("@/server/sessions/service");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");
const { ResilientProvider } = await import("@/server/sf6/resilient");
const { claimDuePlayers, pollPlayer } = await import("@/server/tracking/tracker");
const { getUserLocale, setUserLocale } = await import("@/server/users/locale");
const { EVENTS_CHANNEL } = await import("@/server/realtime/events");
const { logger } = await import("@/server/logger");

describe.skipIf(!TEST_DB)("i18n persistence (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);

  afterAll(async () => {
    await closeDb();
  });

  async function newUser() {
    const id = randomUUID();
    await db.insert(authUser).values({ id, name: "i18n", email: `${id}@test.local` });
    return id;
  }

  it("user language is null until chosen, then persists on the account", async () => {
    const userId = await newUser();
    expect(await getUserLocale(db, userId)).toBeNull();
    await setUserLocale(db, userId, "en");
    expect(await getUserLocale(db, userId)).toBe("en");
    await setUserLocale(db, userId, "es");
    expect(await getUserLocale(db, userId)).toBe("es");
  });

  it("the first overlay inherits the user's language", async () => {
    const userId = await newUser();
    const mock = new MockSF6DataProvider(db);
    const profile = await mock.getPlayerProfile("5550001112");
    const player = await upsertPlayerForUser(db, userId, profile, {
      name: "Tournament",
      locale: "en",
    });
    const [overlay] = await listOverlays(db, player.id);
    expect(overlay?.config.locale).toBe("en");
    expect(overlay?.name).toBe("Tournament");
  });

  it("changing an overlay's language mid-session changes nothing but the language", async () => {
    const userId = await newUser();
    const mock = new MockSF6DataProvider(db);
    const provider = new ResilientProvider(mock, { timeoutMs: 5_000, cacheTtlMs: 0 });
    const cfn = String(6_000_000_000 + Math.floor(Math.random() * 999_999_999));
    const player = await upsertPlayerForUser(db, userId, await provider.getPlayerProfile(cfn));
    const session = await startSession(db, provider, player);

    // Play two matches through the real tracker pipeline.
    await mock.simulateMatch(cfn, { result: "win" });
    await mock.simulateMatch(cfn, { result: "loss" });
    await db.execute(sql`update sf6_player set next_poll_at = now() where id = ${player.id}`);
    const claimed = (await claimDuePlayers(db, "i18n-test", 50, 60_000)).filter(
      (c) => c.id === player.id,
    );
    for (const c of claimed) {
      await pollPlayer(
        db,
        provider,
        c,
        {
          polling: {
            intervalMs: 20_000,
            jitterMs: 0,
            backoffBaseMs: 30_000,
            backoffMaxMs: 120_000,
          },
          leaseMs: 60_000,
          profileRefreshMs: 300_000,
          startGraceMs: 0,
        },
        "i18n-test",
        logger,
      );
    }

    const [overlay] = await listOverlays(db, player.id);
    if (!overlay) throw new Error("no overlay");
    expect(overlay.config.locale).toBe("es");
    const before = await buildPlayerLiveState(db, player.id);
    const [trackerBefore] = await db.select().from(sf6Player).where(eq(sf6Player.id, player.id));
    const sessionsBefore = await db
      .select()
      .from(gameSession)
      .where(eq(gameSession.playerId, player.id));

    // Open overlays learn about the change through the existing realtime bus.
    const received: string[] = [];
    const listener = await getSql().listen(EVENTS_CHANNEL, (payload) => received.push(payload));

    await updateOverlay(db, overlay, { config: { ...overlay.config, locale: "en" } });

    const after = await buildPlayerLiveState(db, player.id);
    const [trackerAfter] = await db.select().from(sf6Player).where(eq(sf6Player.id, player.id));
    const sessionsAfter = await db
      .select()
      .from(gameSession)
      .where(eq(gameSession.playerId, player.id));
    const reloaded = await getOverlayByToken(db, overlay.publicToken);

    // Same URL, new language.
    expect(reloaded?.id).toBe(overlay.id);
    expect(reloaded?.publicToken).toBe(overlay.publicToken);
    expect(reloaded?.config.locale).toBe("en");
    // Stats, MR/LP and session untouched.
    expect(after?.session).toEqual(before?.session);
    expect(after?.session).toMatchObject({
      status: "active",
      wins: 1,
      losses: 1,
      sessionId: session.id,
    });
    // Baseline and session rows untouched; no new session.
    expect(sessionsAfter).toEqual(sessionsBefore);
    // Tracker bookkeeping untouched (no extra tracker / poll scheduled).
    expect(trackerAfter?.nextPollAt).toEqual(trackerBefore?.nextPollAt);
    expect(trackerAfter?.leaseOwner).toEqual(trackerBefore?.leaseOwner);

    await new Promise((r) => setTimeout(r, 200));
    await listener.unlisten();
    expect(
      received.map((p) => JSON.parse(p) as { kind: string; overlayId?: string }),
    ).toContainEqual(expect.objectContaining({ kind: "overlay", overlayId: overlay.id }));
  });
});
