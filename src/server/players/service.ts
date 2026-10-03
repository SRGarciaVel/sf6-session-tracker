import { eq, sql } from "drizzle-orm";
import { ratingSnapshotEquals } from "@/domain/sf6/rating";
import type { NormalizedPlayerProfile } from "@/domain/sf6/types";
import type { Database, DbExecutor } from "@/server/db/client";
import { gameSession, match, sf6Player, type Sf6PlayerRow } from "@/server/db/schema";
import { createOverlay } from "@/server/overlays/service";
import { publishEvent } from "@/server/realtime/events";
import { playerRating } from "@/server/sessions/mappers";

export async function findPlayerByUserId(db: DbExecutor, userId: string): Promise<Sf6PlayerRow | null> {
  const [row] = await db.select().from(sf6Player).where(eq(sf6Player.userId, userId)).limit(1);
  return row ?? null;
}

export async function findPlayerById(db: DbExecutor, playerId: string): Promise<Sf6PlayerRow | null> {
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
): Promise<Sf6PlayerRow> {
  return db.transaction(async (tx) => {
    const existing = await findPlayerByUserId(tx, userId);
    if (existing && existing.cfnUserId === profile.cfnUserId) {
      await updatePlayerProfile(tx, existing.id, profile);
      return (await findPlayerById(tx, existing.id)) ?? existing;
    }
    if (existing) {
      // Different CFN id → sessions/matches belonged to the old id; overlays (OBS URLs) stay.
      await tx.delete(match).where(eq(match.playerId, existing.id));
      await tx.delete(gameSession).where(eq(gameSession.playerId, existing.id));
      const [updated] = await tx
        .update(sf6Player)
        .set({
          cfnUserId: profile.cfnUserId,
          displayName: profile.displayName,
          mainCharacter: profile.mainCharacter,
          rank: profile.rank,
          leaguePoints: profile.leaguePoints,
          masterRate: profile.masterRate,
          profileUpdatedAt: new Date(),
          nextPollAt: null,
          consecutiveFailures: 0,
          lastError: null,
        })
        .where(eq(sf6Player.id, existing.id))
        .returning();
      if (!updated) throw new Error("Failed to update player");
      await publishEvent(tx, { kind: "player", playerId: updated.id });
      return updated;
    }
    const [created] = await tx
      .insert(sf6Player)
      .values({
        userId,
        cfnUserId: profile.cfnUserId,
        displayName: profile.displayName,
        mainCharacter: profile.mainCharacter,
        rank: profile.rank,
        leaguePoints: profile.leaguePoints,
        masterRate: profile.masterRate,
        profileUpdatedAt: new Date(),
      })
      .returning();
    if (!created) throw new Error("Failed to create player");
    await createOverlay(tx, created.id, "Gameplay Overlay");
    return created;
  });
}

/** Store the latest profile snapshot. Returns true when rank/LP/MR/name actually changed. */
export async function updatePlayerProfile(
  db: DbExecutor,
  playerId: string,
  profile: NormalizedPlayerProfile,
): Promise<boolean> {
  const [before] = await db
    .select({
      rank: sf6Player.rank,
      leaguePoints: sf6Player.leaguePoints,
      masterRate: sf6Player.masterRate,
      displayName: sf6Player.displayName,
      mainCharacter: sf6Player.mainCharacter,
    })
    .from(sf6Player)
    .where(eq(sf6Player.id, playerId))
    .limit(1);

  await db
    .update(sf6Player)
    .set({
      displayName: profile.displayName,
      mainCharacter: profile.mainCharacter,
      rank: profile.rank,
      leaguePoints: profile.leaguePoints,
      masterRate: profile.masterRate,
      profileUpdatedAt: sql`now()`,
    })
    .where(eq(sf6Player.id, playerId));

  if (!before) return true;
  return (
    !ratingSnapshotEquals(playerRating(before), playerRating(profile)) ||
    before.displayName !== profile.displayName ||
    before.mainCharacter !== profile.mainCharacter
  );
}
