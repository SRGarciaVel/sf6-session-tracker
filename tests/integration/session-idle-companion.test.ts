/**
 * Idle auto-end in Companion mode (real Postgres, TEST_DATABASE_URL): Buckler presence travels
 * Companion sync → companion_snapshot (JSONB) → lifecycle policy. Observation clock =
 * companion_snapshot.matches_observed_at. Syncs go through applyCompanionSync with an injected
 * clock, so an hour of Companion traffic takes no real time. Skipped without TEST_DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
const { readFileSync } = await import("node:fs");
const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, companionSnapshot, gameSession, match, sf6Player } =
  await import("@/server/db/schema");
const { applyCompanionSync, buildCompanionState, createPairingCode, exchangePairingCode } =
  await import("@/server/companion/service");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { getActiveSession, startSession } = await import("@/server/sessions/service");
const { autoEndIdleSessions } = await import("@/server/sessions/lifecycle");
const { CompanionSF6DataProvider } = await import("@/server/sf6/providers/companion");
const { logger } = await import("@/server/logger");

const CFN = "1733837998";
const CODE = { offline: 1, menu: 2, practice: 8, ranked: 11 } as const;
const log = logger.child({ test: "idle-companion" });
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/capcom/${name}`, "utf8"));
const profile = core.toWireProfile(
  core.normalizeCapcomProfile(core.parseCapcomPlayPayload(fixture(`play-${CFN}.json`)), {
    cfnUserId: CFN,
  }).profile,
);

type Presence = number | null | "absent";

describe.skipIf(!TEST_DB)("idle auto-end with Buckler presence (Companion mode)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  let userId: string;
  let playerId: string;
  let device: Awaited<ReturnType<typeof exchangePairingCode>> & object;
  let startedAt: Date;
  let sessionId: string;
  let clockNow = new Date();
  let seq = 0;
  const provider = TEST_DB
    ? new CompanionSF6DataProvider(db, 300_000, () => clockNow)
    : (null as never);

  const at = (minutes: number) => new Date(startedAt.getTime() + minutes * 60_000);
  const run = (minutes: number) => {
    clockNow = at(minutes);
    return autoEndIdleSessions(db, provider, {
      source: "companion",
      now: () => at(minutes),
      log,
    });
  };

  function wireMatch(minutes: number, mode: "ranked" | "casual" = "ranked") {
    seq++;
    return {
      externalMatchId: `cmp-${userId}-${seq}`,
      playedAt: at(minutes).toISOString(),
      mode,
      result: "win" as const,
      characterKey: "aki",
      characterName: "A.K.I.",
      playerControlType: null,
      opponent: { name: null, characterKey: "ken", characterName: "Ken", rank: null },
      ratingBefore: null,
      ratingAfter: null,
    };
  }

  /** One Companion sync at minute `m` (server acceptance time = the injected clock). */
  async function sync(
    minutes: number,
    presence: Presence,
    extra: { matches?: unknown[]; withProfile?: boolean; atDate?: Date } = {},
  ) {
    const now = extra.atDate ?? at(minutes);
    clockNow = now;
    const body = {
      cfnUserId: CFN,
      observedAt: now.toISOString(),
      profile: extra.withProfile === false ? null : profile,
      matches: extra.matches ?? [],
      gapSuspected: false,
      client: { version: "0.4.0", transport: "service_worker" },
      ...(presence === "absent" ? {} : { presence: { onlineStatus: presence } }),
    };
    const parsed = core.companionSyncRequestSchema.parse(body);
    const res = await applyCompanionSync(db, device.device, parsed, now);
    expect(res.ok).toBe(true);
    return res;
  }

  /** Syncs every `every` minutes in [from, to] with one presence code. */
  async function syncs(from: number, to: number, presence: Presence, every = 1) {
    for (let m = from; m <= to + 1e-9; m += every) await sync(m, presence);
  }

  async function status() {
    const [row] = await db.select().from(gameSession).where(eq(gameSession.id, sessionId));
    return row?.status;
  }

  async function storedPresence() {
    const [row] = await db
      .select({ profile: companionSnapshot.profile })
      .from(companionSnapshot)
      .where(and(eq(companionSnapshot.userId, userId), eq(companionSnapshot.cfnUserId, CFN)));
    return row?.profile?.presence ?? null;
  }

  beforeAll(async () => {
    await db.execute(sql`truncate auth_user, mock_cfn_player restart identity cascade`);
  });
  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await db.update(gameSession).set({ status: "ended", endedAt: sql`now()` });
    userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "Test", email: `${userId}@test.local` });
    const { code } = await createPairingCode(db, userId);
    const paired = await exchangePairingCode(db, core.normalizePairingCode(code), "Test browser");
    if (!paired) throw new Error("pairing failed");
    device = paired;
    const player = await upsertPlayerForUser(db, userId, profile);
    playerId = player.id;
    // A: the Companion has delivered a snapshot → Start session.
    clockNow = new Date();
    const first = core.companionSyncRequestSchema.parse({
      cfnUserId: CFN,
      observedAt: clockNow.toISOString(),
      profile,
      matches: [],
      gapSuspected: false,
      presence: { onlineStatus: CODE.menu },
      client: { version: "0.4.0", transport: "service_worker" },
    });
    await applyCompanionSync(db, device.device, first, clockNow);
    const s = await startSession(db, provider, player);
    sessionId = s.id;
    startedAt = s.startedAt;
  });

  it("QA A–G: Menu → 45 min → auto-ends → Companion sees activeSession=false → later match is history → new Start works", async () => {
    // B. Presence Menu, nothing played.
    await syncs(0, 44, CODE.menu);
    expect((await run(44)).ended).toEqual([]);
    expect((await buildCompanionState(db, userId)).activeSession).toBe(true);
    // C/D. Threshold reached in Menu → ends.
    await sync(45, CODE.menu);
    const res = await run(45);
    expect(res.ended[0]?.decision).toMatchObject({ policy: "normal-idle", presenceState: "menu" });
    expect(await status()).toBe("ended");
    // E. The Companion's next state check says no active session (it slows down by itself).
    expect((await buildCompanionState(db, userId)).activeSession).toBe(false);
    // F. A later match synced by the Companion is stored as history only.
    const later = wireMatch(50);
    const r = await sync(50, CODE.ranked, { matches: [later] });
    expect(r.ok && r.inserted).toBe(1);
    const [row] = await db
      .select({ sessionId: match.sessionId })
      .from(match)
      .where(and(eq(match.playerId, playerId), eq(match.externalMatchId, later.externalMatchId)));
    expect(row?.sessionId).toBeNull();
    // G. An explicit Start creates a new session.
    const [p] = await db.select().from(sf6Player).where(eq(sf6Player.id, playerId));
    const next = await startSession(db, provider, p!);
    expect(next.id).not.toBe(sessionId);
    expect((await getActiveSession(db, playerId))?.id).toBe(next.id);
  });

  it("4. fresh Practice keeps the session active far beyond 45 min without a counted match", async () => {
    await syncs(0, 120, CODE.practice, 2);
    for (const m of [46, 90, 120]) expect((await run(m)).ended).toEqual([]);
    expect(await status()).toBe("active");
  });

  it("5. fresh Ranked Match keeps the session active far beyond 45 min", async () => {
    await syncs(0, 100, CODE.ranked, 2);
    expect((await run(100)).ended).toEqual([]);
    expect(await status()).toBe("active");
  });

  it("Practice → Menu on the way to Ranked does not close at once; 45 min after Practice it does", async () => {
    await syncs(0, 90, CODE.practice, 2);
    await syncs(91, 95, CODE.menu);
    expect((await run(95)).ended).toEqual([]);
    await syncs(96, 135, CODE.menu, 3);
    expect((await run(135)).ended[0]?.decision).toMatchObject({ policy: "normal-idle" });
  });

  it("6/8. Offline: < 15 min stays active; ≥ 15 min continuous (≥ 3 observations) ends early", async () => {
    await sync(5, CODE.ranked, { matches: [wireMatch(4)] });
    await syncs(6, 19, CODE.menu);
    await syncs(20, 34, CODE.offline);
    expect((await run(34)).ended).toEqual([]);
    await sync(35, CODE.offline);
    const res = await run(35);
    expect(res.ended[0]?.decision).toMatchObject({ policy: "offline", presenceState: "offline" });
    expect(await status()).toBe("ended");
  });

  it("9. Offline interrupted by Menu restarts the Offline window", async () => {
    await syncs(0, 10, CODE.offline);
    await sync(11, CODE.menu);
    await syncs(12, 26, CODE.offline);
    expect((await run(26)).ended).toEqual([]); // 14 min since the interruption
    await sync(27, CODE.offline);
    expect((await run(27)).ended[0]?.decision).toMatchObject({ policy: "offline" });
  });

  it("23. NEW server + OLD Companion (no presence key): tracking works; plain 45 min fallback", async () => {
    const m = wireMatch(3);
    const r = await sync(3, "absent", { matches: [m] });
    expect(r.ok && r.inserted).toBe(1);
    const [row] = await db
      .select({ sessionId: match.sessionId })
      .from(match)
      .where(and(eq(match.playerId, playerId), eq(match.externalMatchId, m.externalMatchId)));
    expect(row?.sessionId).toBe(sessionId);
    await syncs(4, 47, "absent", 4);
    expect((await run(47)).ended).toEqual([]);
    await sync(48, "absent");
    const res = await run(48);
    expect(res.ended[0]?.decision).toMatchObject({ policy: "normal-idle" });
  });

  it("24. an unknown future presence code is treated like no information", async () => {
    await syncs(0, 45, 4, 3); // 4 = some Battle Hub state, not mapped without evidence
    await sync(45, 4);
    expect((await run(45)).ended[0]?.decision).toMatchObject({
      policy: "normal-idle",
      presenceState: "unknown",
    });
  });

  it("11. stale Practice (Companion keeps syncing without presence) ends 45 min after it was last seen", async () => {
    await syncs(0, 30, CODE.practice, 2);
    await syncs(31, 74, "absent", 3);
    await sync(74, "absent");
    expect((await run(74)).ended).toEqual([]);
    await sync(75, "absent");
    expect((await run(75)).ended[0]?.decision).toMatchObject({
      policy: "normal-idle",
      presenceState: "unknown",
    });
  });

  it("12/13. stale Ranked with the Companion gone: not observed → only the 12 h ceiling ends it", async () => {
    await syncs(0, 30, CODE.ranked, 2);
    expect((await run(200)).ended).toEqual([]);
    expect((await run(12 * 60 - 1)).ended).toEqual([]);
    expect((await run(12 * 60)).ended[0]?.decision).toMatchObject({ policy: "absolute-ceiling" });
  });

  it("13. the 12 h ceiling ends the session even with fresh Practice", async () => {
    await sync(12 * 60, CODE.practice);
    expect((await run(12 * 60)).ended[0]?.decision).toMatchObject({
      policy: "absolute-ceiling",
      presenceState: "practice",
    });
  });

  it("25. a non-qualifying (casual) match neither counts nor resets the timer", async () => {
    await syncs(0, 29, CODE.menu, 3); // continuous observation from the start
    await sync(30, CODE.menu, { matches: [wireMatch(30, "casual")] });
    await syncs(31, 45, CODE.menu, 2);
    await sync(45, CODE.menu);
    expect((await run(45)).ended[0]?.decision).toMatchObject({
      policy: "normal-idle",
      lastActivityAt: startedAt,
    });
  });

  it("presence is stored additively in the snapshot JSON and never served as profile", async () => {
    await sync(1, CODE.practice);
    expect(await storedPresence()).toMatchObject({
      state: "practice",
      code: 8,
      observations: 1,
    });
    const served = await provider.getPlayerProfile(CFN, { scope: { userId } });
    expect(served).not.toHaveProperty("presence");
    expect(served).toEqual(profile);
    // A battlelog-only sync (no profile) still advances presence, keeping the stored profile.
    await sync(2, CODE.practice, { withProfile: false });
    expect(await storedPresence()).toMatchObject({ observations: 2 });
    expect(await provider.getPlayerProfile(CFN, { scope: { userId } })).toEqual(profile);
  });

  describe("continuous observation after a Companion gap", () => {
    async function storedObservation() {
      const [row] = await db
        .select({ profile: companionSnapshot.profile })
        .from(companionSnapshot)
        .where(and(eq(companionSnapshot.userId, userId), eq(companionSnapshot.cfnUserId, CFN)));
      return row?.profile?.observation ?? null;
    }

    it("1–3. observed until 5, gone 2 h, back in Menu at 125 → active; 169 → active; 170 → close", async () => {
      await syncs(0, 5, CODE.menu);
      await sync(125, CODE.menu);
      expect(await storedObservation()).toMatchObject({
        since: at(125).toISOString(),
        observations: 1,
      });
      expect((await run(125)).ended).toEqual([]);
      await syncs(126, 169, CODE.menu);
      expect((await run(169)).ended).toEqual([]);
      expect(await status()).toBe("active");
      await sync(170, CODE.menu);
      expect((await run(170)).ended[0]?.decision).toMatchObject({ policy: "normal-idle" });
    });

    it("4/5. back directly in Practice → active; Practice → Menu → 45 min from the last Practice", async () => {
      await syncs(0, 5, CODE.menu);
      await syncs(125, 200, CODE.practice, 2);
      await sync(200, CODE.practice); // last Practice observation at exactly 200
      expect((await run(200)).ended).toEqual([]);
      await syncs(201, 244, CODE.menu);
      expect((await run(244)).ended).toEqual([]);
      await sync(245, CODE.menu);
      expect((await run(245)).ended[0]?.decision).toMatchObject({ policy: "normal-idle" });
    });

    it("6/7. OLD Companion (no presence): first sync after 2 h does not close; 45 min later it does", async () => {
      await sync(3, "absent", { matches: [wireMatch(2)] });
      await syncs(4, 5, "absent");
      await sync(125, "absent");
      expect((await run(125)).ended).toEqual([]);
      await syncs(126, 169, "absent", 2);
      await sync(169, "absent");
      expect((await run(169)).ended).toEqual([]);
      await sync(170, "absent");
      expect((await run(170)).ended[0]?.decision).toMatchObject({
        policy: "normal-idle",
        presenceState: "unknown",
      });
    });

    it("9. normal sync cadence (≤ 5 min apart) keeps one observation run", async () => {
      await syncs(0, 40, "absent", 4);
      const run40 = (await storedObservation()) as { since: string; observedAt: string };
      // One run since the first sync (made just before Start), 10+ observations, never reset.
      expect(Date.parse(run40.since)).toBeLessThanOrEqual(at(0).getTime());
      expect(run40.observedAt).toBe(at(40).toISOString());
    });
  });
});
