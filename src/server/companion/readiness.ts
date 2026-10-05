/**
 * Read-only, account-scoped signals for the dashboard's "ready to play?" checklist
 * (domain/companion/readiness.ts). Two indexed selects; never returns tokens or snapshot data.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type { CompanionSignals } from "@/domain/companion/readiness";
import type { DbExecutor } from "@/server/db/client";
import { companionDevice, companionSnapshot } from "@/server/db/schema";
import { getEnv } from "@/server/env";

export async function loadCompanionSignals(
  db: DbExecutor,
  userId: string,
  cfnUserId: string,
  now = new Date(),
): Promise<CompanionSignals> {
  const env = getEnv();
  const [devices, [snapshot]] = await Promise.all([
    db
      .select({ lastSeenAt: companionDevice.lastSeenAt })
      .from(companionDevice)
      .where(and(eq(companionDevice.userId, userId), isNull(companionDevice.revokedAt)))
      .orderBy(desc(companionDevice.lastSeenAt)),
    db
      .select({
        profile: companionSnapshot.profile,
        profileObservedAt: companionSnapshot.profileObservedAt,
        matchesObservedAt: companionSnapshot.matchesObservedAt,
      })
      .from(companionSnapshot)
      .where(and(eq(companionSnapshot.userId, userId), eq(companionSnapshot.cfnUserId, cfnUserId)))
      .limit(1),
  ]);
  const lastSeen = devices
    .map((d) => d.lastSeenAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    required: env.SF6_PROVIDER === "companion",
    deviceCount: devices.length,
    lastSeenAt: lastSeen?.toISOString() ?? null,
    profileObservedAt: snapshot?.profileObservedAt?.toISOString() ?? null,
    matchesObservedAt: snapshot?.matchesObservedAt?.toISOString() ?? null,
    hasProfile: Boolean(snapshot?.profile),
    characterCount: snapshot?.profile?.characters.length ?? 0,
    maxAgeMs: env.COMPANION_SNAPSHOT_MAX_AGE_MS,
    serverTime: now.toISOString(),
  };
}
