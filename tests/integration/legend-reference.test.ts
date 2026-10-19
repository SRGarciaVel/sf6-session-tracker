/**
 * Phase 5.4C — Legend reference end-to-end against Postgres (TEST_DATABASE_URL): the Companion
 * sync stores the per-character position (same row / observed_at guard as the MR) and the Legend
 * boundary on the owner's player (server acceptance order); old payloads keep working; the live
 * state and the public Rank Progress payload carry both from rows already read (no extra query).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.SF6_PROVIDER = "companion";
process.env.LOG_LEVEL = "error";

const core = await import("@sf6/capcom-core");
const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, companionDevice, playerCharacterRating, sf6Player } =
  await import("@/server/db/schema");
const { applyCompanionSync } = await import("@/server/companion/service");
const { upsertPlayerForUser, updatePlayerProfile, storeLegendReference } =
  await import("@/server/players/service");
const { buildPlayerLiveState } = await import("@/server/sessions/service");
const service = await import("@/server/overlays/service");
const { loadOverlayPayload } = await import("@/server/overlays/public");
const { DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, resolveRankProgressView } =
  await import("@/domain/overlay/rank-progress");

const CFN = "1733837998";
/** After every setup write (real clock): the observed_at guard must let these syncs win. */
const T0 = new Date(Date.now() + 60 * 60_000);
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/capcom/${name}`, "utf8"));

/** Real play.json normalization, with Ryu / Honda edited into the Legend race. */
function profile(edits: Record<string, { mr: number; position: number }>) {
  const raw = fixture(`play-${CFN}.json`) as {
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
    const e = edits[c.character_tool_name];
    if (e) {
      c.league_info.master_rating = e.mr;
      c.league_info.master_rating_ranking = e.position;
    }
  }
  return core.normalizeCapcomProfile(core.parseCapcomPlayPayload(raw), { cfnUserId: CFN }).profile;
}

const boundary = {
  cutoffMr: 2196,
  lastLegendPosition: 497,
  firstNonLegendPosition: 505,
  firstNonLegendMr: 2195,
};

describe.skipIf(!TEST_DB)("Legend reference (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  afterAll(async () => {
    await closeDb();
  });

  async function setup() {
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "L", email: `${userId}@test.local` });
    // Another account may track the same CFN: rows are per player, so clear any leftover first.
    const player = await upsertPlayerForUser(db, userId, profile({}));
    const [device] = await db
      .insert(companionDevice)
      .values({ userId, name: "QA", tokenHash: randomUUID().replace(/-/g, "") })
      .returning();
    const sync = (body: Record<string, unknown>, now: Date) =>
      applyCompanionSync(
        db,
        device!,
        core.companionSyncRequestSchema.parse({
          cfnUserId: CFN,
          observedAt: now.toISOString(),
          profile: null,
          matches: [],
          gapSuspected: false,
          client: { version: "0.4.0", transport: "service_worker" },
          ...body,
        }),
        now,
      );
    const rating = async (key: string) =>
      (
        await db
          .select()
          .from(playerCharacterRating)
          .where(
            and(
              eq(playerCharacterRating.playerId, player.id),
              eq(playerCharacterRating.characterKey, key),
            ),
          )
      )[0]!;
    const playerRow = async () =>
      (await db.select().from(sf6Player).where(eq(sf6Player.id, player.id)))[0]!;
    return { userId, player, sync, rating, playerRow };
  }

  it("old payload (no positions, no legend) is accepted; existing rows stay valid", async () => {
    const { sync, rating, playerRow } = await setup();
    const old = core.toWireProfile(profile({}));
    for (const c of old.characters)
      delete (c as { leaderboardPosition?: unknown }).leaderboardPosition;
    expect((await sync({ profile: old }, T0)).ok).toBe(true);
    expect((await rating("ryu")).masterRatingRanking).toBeNull();
    expect((await playerRow()).legendCutoffMr).toBeNull();
  });

  it("position persists with its MR; legend stored at server acceptance time", async () => {
    const { sync, rating, playerRow } = await setup();
    const res = await sync(
      {
        profile: core.toWireProfile(profile({ ryu: { mr: 2189, position: 530 } })),
        legend: boundary,
      },
      T0,
    );
    expect(res.ok).toBe(true);
    expect(await rating("ryu")).toMatchObject({ masterRate: 2189, masterRatingRanking: 530 });
    expect((await rating("luke")).masterRatingRanking).toBeNull(); // LP
    expect(await playerRow()).toMatchObject({
      legendCutoffMr: 2196,
      legendCutoffObservedAt: T0,
      legendLastPosition: 497,
      legendFirstNonLegendPosition: 505,
      legendFirstNonLegendMr: 2195,
    });
  });

  it("a later profile without the position CLEARS it; an older one can't overwrite MR or position", async () => {
    const { player, rating, sync } = await setup();
    await sync({ profile: core.toWireProfile(profile({ ryu: { mr: 2189, position: 530 } })) }, T0);
    const later = new Date(T0.getTime() + 60_000);
    await sync({ profile: core.toWireProfile(profile({ ryu: { mr: 2201, position: 0 } })) }, later);
    expect(await rating("ryu")).toMatchObject({ masterRate: 2201, masterRatingRanking: null });
    // A slower, OLDER observation never wins (MR and position move together).
    await updatePlayerProfile(db, player.id, profile({ ryu: { mr: 2100, position: 900 } }), T0);
    expect(await rating("ryu")).toMatchObject({ masterRate: 2201, masterRatingRanking: null });
  });

  it("a client timestamp can't extend freshness: the server stores ITS acceptance time", async () => {
    const { userId, playerRow } = await setup();
    const [device] = await db
      .select()
      .from(companionDevice)
      .where(eq(companionDevice.userId, userId));
    const future = new Date(T0.getTime() + 365 * 86_400_000).toISOString();
    const res = await applyCompanionSync(
      db,
      device!,
      core.companionSyncRequestSchema.parse({
        cfnUserId: CFN,
        observedAt: future, // client-asserted, ignored for ordering / freshness
        profile: null,
        matches: [],
        gapSuspected: false,
        legend: boundary,
        client: { version: "0.4.0", transport: "service_worker" },
      }),
      T0,
    );
    expect(res.ok).toBe(true);
    expect((await playerRow()).legendCutoffObservedAt).toEqual(T0);
  });

  it("legend ordering: an earlier acceptance never overwrites a later one", async () => {
    const { player, playerRow, sync } = await setup();
    const later = new Date(T0.getTime() + 5 * 60_000);
    await sync({ legend: { ...boundary, cutoffMr: 2199, firstNonLegendMr: 2198 } }, later);
    expect(
      await storeLegendReference(db, player.id, boundary, T0), // older acceptance
    ).toBe(false);
    expect((await playerRow()).legendCutoffMr).toBe(2199);
    // A sync without `legend` leaves the stored reference alone (it simply ages).
    await sync({}, new Date(later.getTime() + 60_000));
    expect((await playerRow()).legendCutoffMr).toBe(2199);
  });

  it("live state + public Rank Progress: chase / Legend from rows already read", async () => {
    const { player, sync } = await setup();
    const now = new Date();
    await sync(
      {
        profile: core.toWireProfile(
          profile({ ryu: { mr: 2189, position: 530 }, honda: { mr: 2241, position: 327 } }),
        ),
        legend: boundary,
      },
      now,
    );
    const live = (await buildPlayerLiveState(db, player.id))!;
    expect(live.session.status).toBe("none");
    expect(live.legendCutoff).toMatchObject({ cutoffMr: 2196, observedAt: now.toISOString() });
    const by = (k: string) => live.session.characters.find((c) => c.characterKey === k)!;
    expect(by("ryu")).toMatchObject({
      leaderboardPosition: 530,
      current: { rank: "Ultimate Master" },
    });
    expect(by("honda")).toMatchObject({ leaderboardPosition: 327, current: { rank: "Legend" } });
    expect(by("luke").leaderboardPosition ?? null).toBeNull();

    const rp = await service.createOverlay(db, player.id, "RP", {
      ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG,
      characterKey: "ryu",
    });
    const p = (await loadOverlayPayload(rp.publicToken))!.payload;
    if (p.config.kind !== "rank-progress") throw new Error("kind");
    const nowMs = Date.parse(p.live.generatedAt);
    expect(
      resolveRankProgressView(p.live.session, p.config, {
        legendCutoff: p.live.legendCutoff,
        nowMs,
      }).state,
    ).toMatchObject({ kind: "legend-chase", position: 530, remaining: 7 });
    expect(
      resolveRankProgressView(
        p.live.session,
        { ...p.config, characterKey: "honda" },
        {
          legendCutoff: p.live.legendCutoff,
          nowMs,
        },
      ).state,
    ).toMatchObject({ kind: "legend", position: 327 });
    // The public payload has no leaderboard rows, identities or raw Buckler data.
    expect(JSON.stringify(p)).not.toMatch(/ranking_fighter_list|fighter_id|short_id|master_league/);
    expect(Object.keys(p).sort()).toEqual(["config", "live"]);
  });
});
