import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { DEFAULT_OVERLAY_CONFIG } from "@/domain/overlay/config";
import { ratingPointEquals, ratingPointOf } from "@/domain/sf6/rating";
import type { NormalizedPlayerProfile } from "@/domain/sf6/types";
import type { Locale } from "@/i18n/locale";
import type { Database, DbExecutor } from "@/server/db/client";
import {
  gameSession,
  match,
  playerCharacterRating,
  sf6Player,
  type Sf6PlayerRow,
} from "@/server/db/schema";
import { createOverlay } from "@/server/overlays/service";
import { publishEvent } from "@/server/realtime/events";
import { characterRowToProfile, type PlayerCharacterRatingRow } from "@/server/sessions/mappers";

export async function findPlayerByUserId(
  db: DbExecutor,
  userId: string,
): Promise<Sf6PlayerRow | null> {
  const [row] = await db.select().from(sf6Player).where(eq(sf6Player.userId, userId)).limit(1);
  return row ?? null;
}

export async function findPlayerById(
  db: DbExecutor,
  playerId: string,
): Promise<Sf6PlayerRow | null> {
  const [row] = await db.select().from(sf6Player).where(eq(sf6Player.id, playerId)).limit(1);
  return row ?? null;
}

/**
 * Register (or replace) the CFN player for a user and create a default overlay.
 * Changing the CFN id keeps the user's overlays (same OBS URLs) but they are re-pointed to the
 * new player record.
 */
export async function upsertPlayerForUser(
  db: Database,
  userId: string,
  profile: NormalizedPlayerProfile,
  overlayDefaults: { name: string; locale: Locale } = {
    name: "Gameplay Overlay",
    locale: DEFAULT_OVERLAY_CONFIG.locale,
  },
  /** When `profile` was observed at the source (see readProfileObservation). */
  observedAt: Date = new Date(),
): Promise<Sf6PlayerRow> {
  return db.transaction(async (tx) => {
    const existing = await findPlayerByUserId(tx, userId);
    if (existing && existing.cfnUserId === profile.cfnUserId) {
      await updatePlayerProfile(tx, existing.id, profile, observedAt);
      return (await findPlayerById(tx, existing.id)) ?? existing;
    }
    if (existing) {
      // Different CFN id → sessions/matches belonged to the old id; overlays (OBS URLs) stay.
      await tx.delete(match).where(eq(match.playerId, existing.id));
      await tx.delete(gameSession).where(eq(gameSession.playerId, existing.id));
      await tx.delete(playerCharacterRating).where(eq(playerCharacterRating.playerId, existing.id));
      const [updated] = await tx
        .update(sf6Player)
        .set({
          cfnUserId: profile.cfnUserId,
          displayName: profile.displayName,
          favoriteCharacterKey: profile.favoriteCharacterKey ?? null,
          profileUpdatedAt: new Date(),
          nextPollAt: null,
          consecutiveFailures: 0,
          lastError: null,
        })
        .where(eq(sf6Player.id, existing.id))
        .returning();
      if (!updated) throw new Error("Failed to update player");
      await upsertCharacterRatings(tx, updated.id, profile, observedAt);
      await publishEvent(tx, { kind: "player", playerId: updated.id });
      return updated;
    }
    const [created] = await tx
      .insert(sf6Player)
      .values({
        userId,
        cfnUserId: profile.cfnUserId,
        displayName: profile.displayName,
        favoriteCharacterKey: profile.favoriteCharacterKey ?? null,
        profileUpdatedAt: new Date(),
      })
      .returning();
    if (!created) throw new Error("Failed to create player");
    await upsertCharacterRatings(tx, created.id, profile, observedAt);
    await createOverlay(tx, created.id, overlayDefaults.name, {
      ...DEFAULT_OVERLAY_CONFIG,
      locale: overlayDefaults.locale,
    });
    return created;
  });
}

/** All known characters of a player (one query). */
export async function listPlayerCharacters(
  db: DbExecutor,
  playerId: string,
): Promise<PlayerCharacterRatingRow[]> {
  return db
    .select()
    .from(playerCharacterRating)
    .where(eq(playerCharacterRating.playerId, playerId))
    .orderBy(asc(playerCharacterRating.characterName));
}

/**
 * Upsert every character of the profile in ONE statement. A row is only overwritten by a
 * snapshot observed at the same time or later (an older, slower poll never wins).
 */
async function upsertCharacterRatings(
  db: DbExecutor,
  playerId: string,
  profile: NormalizedPlayerProfile,
  observedAt: Date,
): Promise<void> {
  // A duplicated characterKey would make the batched upsert fail; keep the first occurrence.
  const seen = new Set<string>();
  const characters = profile.characters.filter((c) => {
    if (seen.has(c.characterKey)) return false;
    seen.add(c.characterKey);
    return true;
  });
  if (characters.length === 0) return;
  await db
    .insert(playerCharacterRating)
    .values(
      characters.map((c) => ({
        playerId,
        characterKey: c.characterKey,
        characterName: c.characterName,
        rank: c.rank,
        rankTier: c.rankTier,
        ratingSystem: c.ratingSystem,
        leaguePoints: c.leaguePoints,
        masterRate: c.masterRate,
        phase: c.phase ?? null,
        // Same observation as the MR: a profile without it CLEARS it (never a stale position).
        masterRatingRanking: c.ratingSystem === "mr" ? (c.leaderboardPosition ?? null) : null,
        observedAt,
      })),
    )
    .onConflictDoUpdate({
      target: [playerCharacterRating.playerId, playerCharacterRating.characterKey],
      set: {
        characterName: sql`excluded.character_name`,
        rank: sql`excluded.rank`,
        rankTier: sql`excluded.rank_tier`,
        ratingSystem: sql`excluded.rating_system`,
        leaguePoints: sql`excluded.league_points`,
        masterRate: sql`excluded.master_rate`,
        phase: sql`excluded.phase`,
        masterRatingRanking: sql`excluded.master_rating_ranking`,
        observedAt: sql`excluded.observed_at`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${playerCharacterRating.observedAt} <= excluded.observed_at`,
    });
}

/**
 * Store the latest profile snapshot (name, favorite character, per-character ratings).
 * Returns true when anything visible changed.
 */
export async function updatePlayerProfile(
  db: DbExecutor,
  playerId: string,
  profile: NormalizedPlayerProfile,
  observedAt: Date = new Date(),
): Promise<boolean> {
  const [before] = await db
    .select({
      displayName: sf6Player.displayName,
      favoriteCharacterKey: sf6Player.favoriteCharacterKey,
    })
    .from(sf6Player)
    .where(eq(sf6Player.id, playerId))
    .limit(1);
  const beforeChars = new Map(
    (await listPlayerCharacters(db, playerId)).map((r) => [
      r.characterKey,
      characterRowToProfile(r),
    ]),
  );

  await db
    .update(sf6Player)
    .set({
      displayName: profile.displayName,
      favoriteCharacterKey: profile.favoriteCharacterKey ?? null,
      profileUpdatedAt: sql`now()`,
    })
    .where(eq(sf6Player.id, playerId));
  await upsertCharacterRatings(db, playerId, profile, observedAt);

  if (!before) return true;
  const charsChanged = profile.characters.some((c) => {
    const prev = beforeChars.get(c.characterKey);
    return (
      !prev ||
      prev.characterName !== c.characterName ||
      !ratingPointEquals(ratingPointOf(prev), ratingPointOf(c)) ||
      (prev.leaderboardPosition ?? null) !==
        (c.ratingSystem === "mr" ? (c.leaderboardPosition ?? null) : null)
    );
  });
  return (
    charsChanged ||
    before.displayName !== profile.displayName ||
    before.favoriteCharacterKey !== (profile.favoriteCharacterKey ?? null)
  );
}

/** Legend boundary as reported by the Companion (derived numbers only; see capcom-core legend.ts). */
export interface LegendReferenceInput {
  cutoffMr: number;
  lastLegendPosition: number;
  firstNonLegendPosition: number;
  firstNonLegendMr: number;
}

/**
 * Store the latest Legend boundary on the player (Phase 5.4C). Ordered by SERVER acceptance time:
 * a reference accepted earlier never overwrites a later one (two devices / a slow request).
 * Returns true when it was stored.
 */
export async function storeLegendReference(
  db: DbExecutor,
  playerId: string,
  reference: LegendReferenceInput,
  acceptedAt: Date,
): Promise<boolean> {
  const updated = await db
    .update(sf6Player)
    .set({
      legendCutoffMr: reference.cutoffMr,
      legendCutoffObservedAt: acceptedAt,
      legendLastPosition: reference.lastLegendPosition,
      legendFirstNonLegendPosition: reference.firstNonLegendPosition,
      legendFirstNonLegendMr: reference.firstNonLegendMr,
    })
    .where(
      and(
        eq(sf6Player.id, playerId),
        or(
          isNull(sf6Player.legendCutoffObservedAt),
          lt(sf6Player.legendCutoffObservedAt, acceptedAt),
        ),
      ),
    )
    .returning({ id: sf6Player.id });
  return updated.length === 1;
}
