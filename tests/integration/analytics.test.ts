/**
 * Analytics 6.0b read model against a real Postgres (TEST_DATABASE_URL): ownership, range and
 * mode filters, session membership by match.session_id only, history outside sessions, and the
 * narrow projection (no opponent names). Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MatchMode, MatchResult } from "@/domain/sf6/types";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, gameSession, match, sf6Player } = await import("@/server/db/schema");
const { getPlayerAnalytics, loadAnalyticsRows } = await import("@/server/analytics/service");

const NOW = new Date("2026-10-14T18:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const SECRET_OPPONENT = "Opponent-Name-Must-Not-Leak";

describe.skipIf(!TEST_DB)("analytics read model (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  let seq = 0;

  async function newPlayer() {
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "A", email: `${userId}@test.local` });
    const [p] = await db
      .insert(sf6Player)
      .values({ userId, cfnUserId: String(1_000_000_000 + ++seq), displayName: "P" })
      .returning();
    return p!;
  }

  async function newSession(playerId: string, status: "active" | "ended" = "ended") {
    const [s] = await db
      .insert(gameSession)
      .values({
        playerId,
        status,
        startedAt: daysAgo(3),
        endedAt: status === "ended" ? daysAgo(2) : null,
        filter: { modes: ["ranked"] },
      })
      .returning();
    return s!;
  }

  async function addMatch(
    playerId: string,
    o: {
      result: MatchResult;
      at: Date;
      mode?: MatchMode;
      sessionId?: string | null;
      characterKey?: string;
    },
  ) {
    await db.insert(match).values({
      playerId,
      sessionId: o.sessionId ?? null,
      externalMatchId: `a-${++seq}`,
      playedAt: o.at,
      mode: o.mode ?? "ranked",
      result: o.result,
      characterKey: o.characterKey ?? "aki",
      characterName: o.characterKey === "juri" ? "Juri" : "A.K.I.",
      opponentName: SECRET_OPPONENT,
      opponentCharacterKey: "ken",
      opponentCharacter: "Ken",
      ratingBeforeSystem: "lp",
      ratingBeforeValue: 19_000,
    });
  }

  beforeAll(async () => {
    await db.execute(sql`truncate auth_user, mock_cfn_player restart identity cascade`);
  });
  afterAll(async () => {
    await closeDb();
  });

  let me: Awaited<ReturnType<typeof newPlayer>>;
  let other: Awaited<ReturnType<typeof newPlayer>>;
  beforeEach(async () => {
    me = await newPlayer();
    other = await newPlayer();
  });

  const analytics = (
    playerId: string,
    range: "7d" | "30d" | "90d" | "all" = "90d",
    mode: "ranked" | "all" = "ranked",
  ) => getPlayerAnalytics(db, playerId, { range, mode, now: NOW });

  it("a player only ever sees their own matches", async () => {
    await addMatch(me.id, { result: "win", at: daysAgo(1) });
    for (let i = 0; i < 5; i++) await addMatch(other.id, { result: "loss", at: daysAgo(1) });
    const mine = await analytics(me.id);
    expect(mine.summary.overall).toMatchObject({ matches: 1, wins: 1, losses: 0 });
    const theirs = await analytics(other.id);
    expect(theirs.summary.overall).toMatchObject({ matches: 5, losses: 5 });
  });

  it("the selected rolling range is respected", async () => {
    await addMatch(me.id, { result: "win", at: daysAgo(1) });
    await addMatch(me.id, { result: "loss", at: daysAgo(10) });
    await addMatch(me.id, { result: "loss", at: daysAgo(60) });
    await addMatch(me.id, { result: "win", at: daysAgo(200) });
    expect((await analytics(me.id, "7d")).summary.overall.matches).toBe(1);
    expect((await analytics(me.id, "30d")).summary.overall.matches).toBe(2);
    expect((await analytics(me.id, "90d")).summary.overall.matches).toBe(3);
    expect((await analytics(me.id, "all")).summary.overall.matches).toBe(4);
    expect((await analytics(me.id, "7d")).from?.toISOString()).toBe(daysAgo(7).toISOString());
  });

  it("the ranked filter excludes non-ranked / unknown modes; 'all' includes and counts them", async () => {
    await addMatch(me.id, { result: "win", at: daysAgo(1) });
    await addMatch(me.id, { result: "loss", at: daysAgo(1), mode: "unknown" });
    await addMatch(me.id, { result: "loss", at: daysAgo(1), mode: "casual" });
    const ranked = await analytics(me.id, "90d", "ranked");
    expect(ranked.summary.overall.matches).toBe(1);
    expect(ranked.summary.unknownModeMatches).toBe(0);
    const all = await analytics(me.id, "90d", "all");
    expect(all.summary.overall.matches).toBe(3);
    expect(all.summary.unknownModeMatches).toBe(1);
  });

  it("a late match kept as history (session_id NULL) still counts overall, not in sessions", async () => {
    const s = await newSession(me.id);
    await addMatch(me.id, { result: "win", at: daysAgo(3), sessionId: s.id });
    await addMatch(me.id, { result: "win", at: daysAgo(3), sessionId: s.id });
    // Played before the end but ingested after it (#39): history.
    await addMatch(me.id, { result: "loss", at: daysAgo(2.5), sessionId: null });
    const a = await analytics(me.id);
    expect(a.summary.overall).toMatchObject({ matches: 3, wins: 2, losses: 1 });
    expect(a.summary.sessions).toEqual({
      sessions: 1,
      sessionMatches: 2,
      averageMatchesPerSession: 2,
      outsideSessions: 1,
    });
  });

  it("session count uses match.session_id only: zero-match sessions and time overlap don't count", async () => {
    const withMatches = await newSession(me.id);
    await newSession(me.id); // zero matches
    await newSession(me.id, "active"); // active, zero matches
    await addMatch(me.id, { result: "win", at: daysAgo(3), sessionId: withMatches.id });
    // History played INSIDE another session's time window is not attributed to it.
    await addMatch(me.id, { result: "win", at: daysAgo(2.9), sessionId: null });
    const a = await analytics(me.id);
    expect(a.summary.sessions.sessions).toBe(1);
    expect(a.summary.sessions.sessionMatches).toBe(1);
  });

  it("per-character performance comes from the player's own character", async () => {
    await addMatch(me.id, { result: "win", at: daysAgo(1) });
    await addMatch(me.id, { result: "loss", at: daysAgo(1), characterKey: "juri" });
    await addMatch(me.id, { result: "win", at: daysAgo(1), characterKey: "juri" });
    const a = await analytics(me.id);
    expect(a.summary.characters.map((c) => [c.characterKey, c.record.matches, c.usage])).toEqual([
      ["juri", 2, (2 / 3) * 100],
      ["aki", 1, (1 / 3) * 100],
    ]);
  });

  it("the projection is narrow: no opponent names or ratings anywhere in the payload", async () => {
    await addMatch(me.id, { result: "win", at: daysAgo(1) });
    const rows = await loadAnalyticsRows(db, me.id, { from: null, mode: "all" });
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        "characterKey",
        "characterName",
        "externalMatchId",
        "mode",
        "playedAt",
        "result",
        "sessionId",
      ].sort(),
    );
    const payload = JSON.stringify(await analytics(me.id, "all", "all"));
    expect(payload).not.toContain(SECRET_OPPONENT);
    expect(payload).not.toContain("Ken");
    expect(payload).not.toContain("19000");
  });

  it("empty range → zero matches, null win rate, no NaN", async () => {
    await addMatch(me.id, { result: "win", at: daysAgo(100) });
    const a = await analytics(me.id, "7d");
    expect(a.summary.overall).toMatchObject({ matches: 0, winRate: null, sample: "none" });
    expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity/);
  });
});
