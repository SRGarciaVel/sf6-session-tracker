/**
 * Session rating consistency at session boundaries, through the PRODUCTION provider stack
 * (ResilientProvider with its 5 s profile cache → CompanionSF6DataProvider) against a local
 * Postgres (TEST_DATABASE_URL, guarded).
 *
 * Reproduces the stale-profile defect found in Phase 5.6D QA: a profile read (and cached) before
 * a newer Companion sync used to be written at session end/start stamped with the CURRENT time,
 * so the guarded per-character upsert let it replace the newer observation and the session froze
 * the stale value (LIVE 1402 → 1414 +12, RECAP ±0). Every assertion reads the database.
 *
 * Fictitious identity (the fixture CFN and name are replaced before anything is stored).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
const isLocal = (url: string | undefined) => {
  try {
    return !!url && ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};
const RUN = isLocal(TEST_DB);
if (RUN) process.env.DATABASE_URL = TEST_DB;
process.env.SF6_PROVIDER = "companion";
process.env.LOG_LEVEL = "error";

const core = await import("@sf6/capcom-core");
const { readFileSync } = await import("node:fs");
const { getDb, closeDb } = await import("@/server/db/client");
const schema = await import("@/server/db/schema");
const { authUser, companionDevice, gameSession, playerCharacterRating, sessionCharacterBaseline } =
  schema;
const { applyCompanionSync } = await import("@/server/companion/service");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { CompanionSF6DataProvider } = await import("@/server/sf6/providers/companion");
const { ResilientProvider } = await import("@/server/sf6/resilient");
const { buildPlayerLiveState, endSession, startSession, summarizeSessionRow } =
  await import("@/server/sessions/service");

const { DEFAULT_SESSION_FILTER } = await import("@/domain/session/engine");

const FIXTURE_CFN = "1733837998";
const CACHE_TTL_MS = 5_000; // production default (PROVIDER_CACHE_TTL_MS)

/** Real play.json normalization with Ryu's MR and Jamie's LP edited; identity fictitious. */
function profile(cfn: string, ryuMr: number, jamieLp = 23006) {
  const raw = JSON.parse(
    readFileSync(`tests/fixtures/capcom/play-${FIXTURE_CFN}.json`, "utf8"),
  ) as {
    pageProps: {
      play: {
        character_league_infos: Array<{
          character_tool_name: string;
          league_info: Record<string, number>;
        }>;
      };
    };
  };
  for (const c of raw.pageProps.play.character_league_infos) {
    if (c.character_tool_name === "ryu") c.league_info.master_rating = ryuMr;
    if (c.character_tool_name === "jamie") c.league_info.league_point = jamieLp;
  }
  const p = core.normalizeCapcomProfile(core.parseCapcomPlayPayload(raw), {
    cfnUserId: FIXTURE_CFN,
  }).profile;
  return core.toWireProfile({
    ...p,
    cfnUserId: cfn,
    displayName: "SIM",
    favoriteCharacterKey: "ryu",
  });
}

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN)("session ratings at session boundaries (production provider stack)", () => {
  const db = RUN ? getDb() : (null as never);
  const users: string[] = [];
  afterAll(async () => {
    if (users.length) await db.delete(authUser).where(inArray(authUser.id, users));
    await closeDb();
  });

  /** A fictitious account with a paired device, a registered player and a cached provider. */
  async function account() {
    const userId = randomUUID();
    users.push(userId);
    const cfn = `999${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    await db.insert(authUser).values({ id: userId, name: "SIM", email: `${userId}@test.local` });
    const [device] = await db
      .insert(companionDevice)
      .values({ userId, name: "SIM", tokenHash: randomUUID().replace(/-/g, "") })
      .returning();
    let seq = 0;
    const sync = async (body: Record<string, unknown>) => {
      const now = new Date();
      const res = await applyCompanionSync(
        db,
        device!,
        core.companionSyncRequestSchema.parse({
          cfnUserId: cfn,
          observedAt: now.toISOString(),
          profile: null,
          matches: [],
          gapSuspected: false,
          client: { version: "0.4.0", transport: "service_worker" },
          ...body,
        }),
        now,
      );
      expect(res.ok).toBe(true);
      await tick();
      return now;
    };
    const match = (result: "win" | "loss", characterKey: "ryu" | "jamie" = "ryu") =>
      core.toWireMatch({
        externalMatchId: `SIM-${randomUUID().slice(0, 8)}-${++seq}`,
        playedAt: new Date(Date.now() - 5),
        mode: "ranked",
        result,
        characterKey,
        characterName: characterKey === "ryu" ? "Ryu" : "Jamie",
        opponent: { name: "SIM-OPP", characterKey: "ken", characterName: "Ken" },
        ratingBefore: null,
        ratingAfter: null,
      });
    // The same wrapper and TTL as production (getSF6DataProvider).
    const provider = new ResilientProvider(new CompanionSF6DataProvider(db, 300_000), {
      timeoutMs: 5_000,
      cacheTtlMs: CACHE_TTL_MS,
    });
    await sync({ profile: profile(cfn, 1402), battlelogObserved: true });
    const player = await upsertPlayerForUser(
      db,
      userId,
      await provider.getPlayerProfile(cfn, { scope: { userId } }),
    );
    return { userId, cfn, player, provider, sync, match };
  }

  const rows = async (sessionId: string) =>
    Object.fromEntries(
      (
        await db
          .select()
          .from(sessionCharacterBaseline)
          .where(eq(sessionCharacterBaseline.sessionId, sessionId))
      ).map((r) => [r.characterKey, r]),
    );
  const stored = async (playerId: string, key: string) =>
    (
      await db
        .select()
        .from(playerCharacterRating)
        .where(
          and(
            eq(playerCharacterRating.playerId, playerId),
            eq(playerCharacterRating.characterKey, key),
          ),
        )
    )[0]!;
  const summary = async (
    sessionId: string,
    player: Awaited<ReturnType<typeof account>>["player"],
  ) => {
    const [row] = await db.select().from(gameSession).where(eq(gameSession.id, sessionId));
    return summarizeSessionRow(db, row!, player);
  };

  it("REGRESSION: end within the cache window keeps the newer MR and LP (LIVE +12 ⇒ RECAP +12)", async () => {
    const a = await account();
    const session = await startSession(db, a.provider, a.player); // caches the 1402 profile
    await tick();
    const syncedAt = await a.sync({
      matches: [a.match("win"), a.match("loss", "jamie")],
      profile: profile(a.cfn, 1414, 22982),
      battlelogObserved: true,
    });

    // LIVE (what the dashboard showed): Ryu 1402 → 1414 (+12), Jamie 23006 → 22982 (−24).
    const live = (await buildPlayerLiveState(db, a.player.id))!.session.characters;
    expect(live.find((c) => c.characterKey === "ryu")).toMatchObject({
      current: { value: 1414 },
      delta: 12,
    });
    expect(live.find((c) => c.characterKey === "jamie")).toMatchObject({
      current: { value: 22982 },
      delta: -24,
    });

    await endSession(db, a.player.id, a.provider); // < 5 s after the cached read

    const r = await rows(session.id);
    expect(r.ryu).toMatchObject({
      initialMasterRate: 1402,
      finalMasterRate: 1414,
      finalRatingSystem: "mr",
      finalLeaguePoints: null,
    });
    expect(r.jamie).toMatchObject({
      initialLeaguePoints: 23006,
      finalLeaguePoints: 22982,
      finalRatingSystem: "lp",
      finalMasterRate: null,
    });
    const ryu = await stored(a.player.id, "ryu");
    expect(ryu.masterRate).toBe(1414);
    expect(ryu.observedAt.getTime()).toBe(syncedAt.getTime()); // never re-stamped by a stale read
    // RECAP after a refresh reads the frozen finals: +12 MR and −24 LP, never combined.
    const recap = await summary(session.id, a.player);
    expect(recap.status).toBe("ended");
    expect(recap.characters.find((c) => c.characterKey === "ryu")).toMatchObject({ delta: 12 });
    expect(recap.characters.find((c) => c.characterKey === "jamie")).toMatchObject({ delta: -24 });
  });

  it("REGRESSION: start right after a newer profile takes the newer baseline", async () => {
    const a = await account();
    await a.provider.getPlayerProfile(a.cfn, { scope: { userId: a.userId } }); // e.g. a page read
    await a.sync({ profile: profile(a.cfn, 1420), battlelogObserved: true });
    const session = await startSession(db, a.provider, a.player);
    expect((await rows(session.id)).ryu).toMatchObject({ initialMasterRate: 1420 });
    expect((await stored(a.player.id, "ryu")).masterRate).toBe(1420);
  });

  it("REGRESSION: end followed immediately by a new start: no stale final, no stale baseline", async () => {
    const a = await account();
    const first = await startSession(db, a.provider, a.player); // caches 1402
    await tick();
    await a.sync({
      matches: [a.match("loss")],
      profile: profile(a.cfn, 1390),
      battlelogObserved: true,
    });
    await endSession(db, a.player.id, a.provider);
    const second = await startSession(db, a.provider, a.player);
    expect((await rows(first.id)).ryu).toMatchObject({ finalMasterRate: 1390 });
    expect((await rows(second.id)).ryu).toMatchObject({ initialMasterRate: 1390 });
    expect(
      (await summary(first.id, a.player)).characters.find((c) => c.characterKey === "ryu"),
    ).toMatchObject({ delta: -12 });
  });

  it("no new profile after the last match: the final stays unknown (never a fabricated confirmation)", async () => {
    const a = await account();
    const session = await startSession(db, a.provider, a.player);
    await tick();
    const before = (await stored(a.player.id, "ryu")).observedAt.getTime();
    await a.sync({ matches: [a.match("win")], battlelogObserved: true }); // battlelog only
    await endSession(db, a.player.id, a.provider);
    const r = await rows(session.id);
    expect(r.ryu).toMatchObject({ initialMasterRate: 1402, finalMasterRate: null });
    // The pre-match observation keeps its own time: it is not presented as post-match.
    expect((await stored(a.player.id, "ryu")).observedAt.getTime()).toBe(before);
    const recap = await summary(session.id, a.player);
    expect(recap.characters.find((c) => c.characterKey === "ryu")).toMatchObject({
      current: null,
      delta: null,
    });
  });

  it("out of order: battlelog first, the post-match profile later (still inside the cache window)", async () => {
    const a = await account();
    const session = await startSession(db, a.provider, a.player);
    await tick();
    await a.sync({ matches: [a.match("win")], battlelogObserved: true });
    let ryu = (await buildPlayerLiveState(db, a.player.id))!.session.characters.find(
      (c) => c.characterKey === "ryu",
    )!;
    expect(ryu.current).toBeNull(); // pending, nothing invented
    expect(ryu.heldRating).toMatchObject({ current: { value: 1402 } });
    await a.sync({ profile: profile(a.cfn, 1409), battlelogObserved: true });
    ryu = (await buildPlayerLiveState(db, a.player.id))!.session.characters.find(
      (c) => c.characterKey === "ryu",
    )!;
    expect(ryu).toMatchObject({ current: { value: 1409 }, delta: 7 });
    await endSession(db, a.player.id, a.provider);
    expect((await rows(session.id)).ryu).toMatchObject({ finalMasterRate: 1409 });
  });

  it("duplicate profile observations change nothing", async () => {
    const a = await account();
    const session = await startSession(db, a.provider, a.player);
    await tick();
    await a.sync({
      matches: [a.match("win")],
      profile: profile(a.cfn, 1414),
      battlelogObserved: true,
    });
    await a.sync({ profile: profile(a.cfn, 1414), battlelogObserved: true });
    await a.sync({ profile: profile(a.cfn, 1414), battlelogObserved: true });
    await endSession(db, a.player.id, a.provider);
    expect((await rows(session.id)).ryu).toMatchObject({
      initialMasterRate: 1402,
      finalMasterRate: 1414,
    });
  });

  it("concurrent end requests: one close, correct finals, idempotent", async () => {
    const a = await account();
    const session = await startSession(db, a.provider, a.player);
    await tick();
    await a.sync({
      matches: [a.match("win")],
      profile: profile(a.cfn, 1414),
      battlelogObserved: true,
    });
    const results = await Promise.all([
      endSession(db, a.player.id, a.provider),
      endSession(db, a.player.id, a.provider),
      endSession(db, a.player.id, a.provider),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect((await rows(session.id)).ryu).toMatchObject({ finalMasterRate: 1414 });
    expect(await endSession(db, a.player.id, a.provider)).toBeNull(); // already ended
    const [row] = await db.select().from(gameSession).where(eq(gameSession.id, session.id));
    expect(row!.status).toBe("ended");
  });

  it("a stale provider response competing with a fresh database observation loses", async () => {
    const a = await account();
    const session = await startSession(db, a.provider, a.player);
    await tick();
    // The end's final fetch is served from the cache (1402, observed before the sync below)…
    const stale = a.provider.getPlayerProfile(a.cfn, { scope: { userId: a.userId } });
    await a.sync({
      matches: [a.match("win")],
      profile: profile(a.cfn, 1414),
      battlelogObserved: true,
    });
    expect((await stale).characters.find((c) => c.characterKey === "ryu")?.masterRate).toBe(1402);
    // …and racing the next sync of the same value does not let it win either.
    await Promise.all([
      endSession(db, a.player.id, a.provider),
      a.sync({ profile: profile(a.cfn, 1414), battlelogObserved: true }),
    ]);
    expect((await rows(session.id)).ryu).toMatchObject({ finalMasterRate: 1414 });
    expect((await stored(a.player.id, "ryu")).masterRate).toBe(1414);
  });

  it("legacy sessions still end without per-character finals", async () => {
    const a = await account();
    const [legacy] = await db
      .insert(gameSession)
      .values({
        playerId: a.player.id,
        status: "active",
        startedAt: new Date(),
        ratingModel: "legacy",
        filter: DEFAULT_SESSION_FILTER,
      })
      .returning();
    await a.sync({
      matches: [a.match("win")],
      profile: profile(a.cfn, 1414),
      battlelogObserved: true,
    });
    await endSession(db, a.player.id, a.provider);
    expect(Object.keys(await rows(legacy!.id))).toHaveLength(0);
    expect((await summary(legacy!.id, a.player)).status).toBe("ended");
  });
});
