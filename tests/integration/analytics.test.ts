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
const service = await import("@/server/analytics/service");
const { getPlayerAnalyticsForUser } = service;

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
      /** Opponent character key; null = no usable opponent data. Default "ken". */
      opponent?: string | null;
    },
  ) {
    const opponent = o.opponent === undefined ? "ken" : o.opponent;
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
      opponentCharacterKey: opponent,
      opponentCharacter: opponent === null ? null : opponent[0]!.toUpperCase() + opponent.slice(1),
      ratingBeforeSystem: "lp",
      ratingBeforeValue: 19_000,
    });
  }

  /** addMatch, returning the new row's id (for membership assertions). */
  async function addMatchReturningId(
    playerId: string,
    o: { result: MatchResult; at: Date; sessionId: string | null },
  ): Promise<string> {
    await addMatch(playerId, o);
    const [row] = await db
      .select({ id: match.id })
      .from(match)
      .where(sql`${match.playerId} = ${playerId} and ${match.externalMatchId} = ${`a-${seq}`}`);
    return row!.id;
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

  /** Through the PUBLIC entry point, as the page does: by the owning USER id. */
  async function analytics(
    owner: { userId: string },
    range: "7d" | "30d" | "90d" | "all" = "90d",
    mode: "ranked" | "all" = "ranked",
    character: string | null = null,
  ) {
    const a = await getPlayerAnalyticsForUser(db, owner.userId, {
      range,
      mode,
      character,
      now: NOW,
    });
    if (!a) throw new Error("no player for user");
    return a;
  }

  it("a player only ever sees their own matches", async () => {
    await addMatch(me.id, { result: "win", at: daysAgo(1) });
    for (let i = 0; i < 5; i++) await addMatch(other.id, { result: "loss", at: daysAgo(1) });
    const mine = await analytics(me);
    expect(mine.summary.overall).toMatchObject({ matches: 1, wins: 1, losses: 0 });
    const theirs = await analytics(other);
    expect(theirs.summary.overall).toMatchObject({ matches: 5, losses: 5 });
  });

  it("the selected rolling range is respected", async () => {
    await addMatch(me.id, { result: "win", at: daysAgo(1) });
    await addMatch(me.id, { result: "loss", at: daysAgo(10) });
    await addMatch(me.id, { result: "loss", at: daysAgo(60) });
    await addMatch(me.id, { result: "win", at: daysAgo(200) });
    expect((await analytics(me, "7d")).summary.overall.matches).toBe(1);
    expect((await analytics(me, "30d")).summary.overall.matches).toBe(2);
    expect((await analytics(me, "90d")).summary.overall.matches).toBe(3);
    expect((await analytics(me, "all")).summary.overall.matches).toBe(4);
    expect((await analytics(me, "7d")).from?.toISOString()).toBe(daysAgo(7).toISOString());
  });

  it("the ranked filter excludes non-ranked / unknown modes; 'all' includes and counts them", async () => {
    await addMatch(me.id, { result: "win", at: daysAgo(1) });
    await addMatch(me.id, { result: "loss", at: daysAgo(1), mode: "unknown" });
    await addMatch(me.id, { result: "loss", at: daysAgo(1), mode: "casual" });
    const ranked = await analytics(me, "90d", "ranked");
    expect(ranked.summary.overall.matches).toBe(1);
    expect(ranked.summary.unknownModeMatches).toBe(0);
    const all = await analytics(me, "90d", "all");
    expect(all.summary.overall.matches).toBe(3);
    expect(all.summary.unknownModeMatches).toBe(1);
  });

  it("a late match kept as history (session_id NULL) still counts overall, not in sessions", async () => {
    const s = await newSession(me.id);
    await addMatch(me.id, { result: "win", at: daysAgo(3), sessionId: s.id });
    await addMatch(me.id, { result: "win", at: daysAgo(3), sessionId: s.id });
    // Played before the end but ingested after it (#39): history.
    await addMatch(me.id, { result: "loss", at: daysAgo(2.5), sessionId: null });
    const a = await analytics(me);
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
    const a = await analytics(me);
    expect(a.summary.sessions.sessions).toBe(1);
    expect(a.summary.sessions.sessionMatches).toBe(1);
  });

  it("per-character performance comes from the player's own character", async () => {
    await addMatch(me.id, { result: "win", at: daysAgo(1) });
    await addMatch(me.id, { result: "loss", at: daysAgo(1), characterKey: "juri" });
    await addMatch(me.id, { result: "win", at: daysAgo(1), characterKey: "juri" });
    const a = await analytics(me);
    expect(a.summary.characters.map((c) => [c.characterKey, c.record.matches, c.usage])).toEqual([
      ["juri", 2, (2 / 3) * 100],
      ["aki", 1, (1 / 3) * 100],
    ]);
  });

  it("the projection is narrow: no opponent names or ratings anywhere in the payload", async () => {
    await addMatch(me.id, { result: "win", at: daysAgo(1) });
    const payload = JSON.stringify(await analytics(me, "all", "all"));
    expect(payload).not.toContain(SECRET_OPPONENT);
    // The opponent CHARACTER ("Ken") is matchup data; the opponent's NAME never is.
    expect(payload).toContain('"opponentName":"Ken"');
    expect(payload).not.toContain("19000");
  });

  it("empty range → zero matches, null win rate, no NaN", async () => {
    await addMatch(me.id, { result: "win", at: daysAgo(100) });
    const a = await analytics(me, "7d");
    expect(a.summary.overall).toMatchObject({ matches: 0, winRate: null, sample: "none" });
    expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity/);
  });

  describe("ownership is enforced by the public entry point", () => {
    it("the service exports no player-id API (the raw loader is private)", () => {
      expect(Object.keys(service).sort()).toEqual(["getPlayerAnalyticsForUser"]);
    });

    it("user A gets only A's analytics; B's data never appears", async () => {
      await addMatch(me.id, { result: "win", at: daysAgo(1) });
      for (let i = 0; i < 4; i++) {
        await addMatch(other.id, { result: "loss", at: daysAgo(1), characterKey: "juri" });
      }
      const a = await analytics(me);
      expect(a.summary.overall).toMatchObject({ matches: 1, wins: 1, losses: 0 });
      expect(a.summary.characters.map((c) => c.characterKey)).toEqual(["aki"]);
    });

    it("a player id is not a user id: passing B's player id resolves nothing", async () => {
      await addMatch(other.id, { result: "loss", at: daysAgo(1) });
      expect(
        await getPlayerAnalyticsForUser(db, other.id, { range: "all", mode: "all", now: NOW }),
      ).toBeNull();
    });

    it("extra input cannot redirect the query to another player", async () => {
      await addMatch(me.id, { result: "win", at: daysAgo(1) });
      await addMatch(other.id, { result: "loss", at: daysAgo(1) });
      // A request-shaped object smuggling B's ids: only range/mode are read, A is resolved.
      const smuggled = {
        range: "all",
        mode: "all",
        now: NOW,
        playerId: other.id,
        userId: other.userId,
      } as unknown as Parameters<typeof getPlayerAnalyticsForUser>[2];
      const a = await getPlayerAnalyticsForUser(db, me.userId, smuggled);
      expect(a?.summary.overall).toMatchObject({ matches: 1, wins: 1 });
    });

    it("a user without a player gets null (the page sends them to onboarding)", async () => {
      const userId = randomUUID();
      await db.insert(authUser).values({ id: userId, name: "N", email: `${userId}@test.local` });
      expect(
        await getPlayerAnalyticsForUser(db, userId, { range: "90d", mode: "ranked", now: NOW }),
      ).toBeNull();
    });
  });

  describe("matchups (6.1)", () => {
    const pairs = (a: Awaited<ReturnType<typeof analytics>>) =>
      a.summary.matchups.matchups.map((m) => [
        `${m.characterKey}>${m.opponentKey}`,
        m.record.wins,
        m.record.losses,
      ]);

    it("user A never receives B's matchups or B's characters as filter options", async () => {
      await addMatch(me.id, { result: "win", at: daysAgo(1), opponent: "ken" });
      await addMatch(other.id, {
        result: "loss",
        at: daysAgo(1),
        opponent: "jp",
        characterKey: "juri",
      });
      const a = await analytics(me);
      expect(pairs(a)).toEqual([["aki>ken", 1, 0]]);
      expect(a.characters.map((c) => c.characterKey)).toEqual(["aki"]);
      // B's character as a filter is not A's own → falls back to all.
      const smuggled = await analytics(me, "90d", "ranked", "juri");
      expect(smuggled.character).toBeNull();
      expect(smuggled.summary.overall.matches).toBe(1);
    });

    it("range and mode both narrow the matchups", async () => {
      await addMatch(me.id, { result: "win", at: daysAgo(1), opponent: "ken" });
      await addMatch(me.id, { result: "loss", at: daysAgo(20), opponent: "jp" });
      await addMatch(me.id, { result: "loss", at: daysAgo(1), opponent: "guile", mode: "unknown" });
      expect(pairs(await analytics(me, "7d"))).toEqual([["aki>ken", 1, 0]]);
      expect(pairs(await analytics(me, "30d")).map((p) => p[0])).toEqual(["aki>jp", "aki>ken"]);
      expect(
        pairs(await analytics(me, "30d", "all"))
          .map((p) => p[0])
          .sort(),
      ).toEqual(["aki>guile", "aki>jp", "aki>ken"]);
    });

    it("the own-character filter applies to ALL dataset analytics; the overview stays cross-character", async () => {
      const s = await newSession(me.id);
      await addMatch(me.id, { result: "win", at: daysAgo(3), sessionId: s.id, opponent: "ken" });
      await addMatch(me.id, { result: "win", at: daysAgo(3), sessionId: s.id, opponent: "ken" });
      await addMatch(me.id, {
        result: "loss",
        at: daysAgo(1),
        characterKey: "juri",
        opponent: "jp",
      });
      await addMatch(me.id, {
        result: "draw",
        at: daysAgo(1),
        characterKey: "juri",
        opponent: "jp",
      });
      const juri = await analytics(me, "90d", "ranked", "juri");
      expect(juri.character).toBe("juri");
      expect(juri.summary.overall).toMatchObject({ matches: 2, wins: 0, losses: 1, draws: 1 });
      expect(juri.summary.recent[0]?.results).toEqual(["draw", "loss"]);
      expect(juri.summary.sessions).toMatchObject({ sessions: 0, outsideSessions: 2 });
      expect(pairs(juri)).toEqual([["juri>jp", 0, 1]]);
      expect(juri.summary.matchups.opponents.map((o) => o.opponentKey)).toEqual(["jp"]);
      expect(juri.summary.characters.map((c) => c.characterKey)).toEqual(["aki", "juri"]);
      const all = await analytics(me);
      expect(all.character).toBeNull();
      expect(all.summary.overall.matches).toBe(4);
      expect(all.summary.sessions).toMatchObject({ sessions: 1, sessionMatches: 2 });
      expect(all.characters.map((c) => c.characterKey)).toEqual(["aki", "juri"]);
    });

    it("an unknown / malformed character filter falls back to all", async () => {
      await addMatch(me.id, { result: "win", at: daysAgo(1) });
      for (const c of ["ryu", "not-mine"]) {
        const a = await analytics(me, "90d", "ranked", c);
        expect(a.character).toBeNull();
        expect(a.summary.overall.matches).toBe(1);
      }
    });

    it("a character the player only used outside the range is selectable (empty dataset, no fallback)", async () => {
      await addMatch(me.id, { result: "win", at: daysAgo(1) });
      await addMatch(me.id, { result: "loss", at: daysAgo(200), characterKey: "juri" });
      const a = await analytics(me, "7d", "ranked", "juri");
      expect(a.character).toBe("juri");
      expect(a.summary.overall.matches).toBe(0);
      expect(a.characters.map((c) => c.characterName)).toEqual(["A.K.I.", "Juri"]);
    });

    it("late history (session_id NULL) is part of the matchups; no session is made up for it", async () => {
      const s = await newSession(me.id);
      await addMatch(me.id, { result: "win", at: daysAgo(3), sessionId: s.id, opponent: "ken" });
      await addMatch(me.id, { result: "loss", at: daysAgo(2.5), sessionId: null, opponent: "ken" });
      const a = await analytics(me);
      expect(pairs(a)).toEqual([["aki>ken", 1, 1]]);
      expect(a.summary.sessions).toMatchObject({
        sessions: 1,
        sessionMatches: 1,
        outsideSessions: 1,
      });
    });

    it("mirror matches are included", async () => {
      await addMatch(me.id, { result: "win", at: daysAgo(1), opponent: "aki" });
      expect(pairs(await analytics(me))).toEqual([["aki>aki", 1, 0]]);
    });

    it("rows without opponent character data are excluded from matchups and counted", async () => {
      await addMatch(me.id, { result: "win", at: daysAgo(1), opponent: "ken" });
      await addMatch(me.id, { result: "win", at: daysAgo(1), opponent: null });
      await addMatch(me.id, { result: "loss", at: daysAgo(1), opponent: null });
      const a = await analytics(me);
      expect(a.summary.overall.matches).toBe(3);
      expect(a.summary.matchups).toMatchObject({ considered: 1, unavailable: 2 });
      expect(pairs(a)).toEqual([["aki>ken", 1, 0]]);
    });

    it("highlights need 10 decided matches (end to end)", async () => {
      for (let i = 0; i < 9; i++) await addMatch(me.id, { result: "win", at: daysAgo(1) });
      expect((await analytics(me)).summary.matchups.highlights.strongest).toBeNull();
      await addMatch(me.id, { result: "loss", at: daysAgo(1) });
      const h = (await analytics(me)).summary.matchups.highlights;
      expect(h.strongest?.record).toMatchObject({ decided: 10, wins: 9 });
      expect(JSON.stringify(h)).not.toContain(SECRET_OPPONENT);
    });
  });

  describe("session performance (6.2)", () => {
    const minutesAfter = (base: Date, m: number) => new Date(base.getTime() + m * 60_000);
    const base = daysAgo(1);
    const sp = (a: Awaited<ReturnType<typeof analytics>>) => a.summary.sessionPerformance;

    it("ownership: A never receives B's session analytics", async () => {
      const mine = await newSession(me.id);
      const theirs = await newSession(other.id);
      await addMatch(me.id, { result: "win", at: base, sessionId: mine.id });
      for (let i = 0; i < 5; i++) {
        await addMatch(other.id, {
          result: "loss",
          at: minutesAfter(base, i * 4),
          sessionId: theirs.id,
        });
      }
      expect(sp(await analytics(me))).toMatchObject({ segments: 1, sessions: 1, matches: 1 });
      expect(sp(await analytics(me)).streaks.longestLoss).toBe(0);
    });

    it("range, mode and character all narrow the session dataset", async () => {
      const s = await newSession(me.id);
      await addMatch(me.id, { result: "win", at: base, sessionId: s.id });
      await addMatch(me.id, {
        result: "win",
        at: minutesAfter(base, 4),
        sessionId: s.id,
        mode: "unknown",
      });
      await addMatch(me.id, {
        result: "loss",
        at: minutesAfter(base, 8),
        sessionId: s.id,
        characterKey: "juri",
      });
      const old = await newSession(me.id);
      await addMatch(me.id, { result: "loss", at: daysAgo(20), sessionId: old.id });
      expect(sp(await analytics(me, "7d"))).toMatchObject({ sessions: 1, matches: 2 });
      expect(sp(await analytics(me, "30d"))).toMatchObject({ sessions: 2, matches: 3 });
      expect(sp(await analytics(me, "7d", "all"))).toMatchObject({ matches: 3 });
      expect(sp(await analytics(me, "7d", "all", "juri"))).toMatchObject({
        matches: 1,
        streaks: { longestLoss: 1, longestWin: 0 },
      });
    });

    it("session_id NULL is excluded from session analytics but counts globally", async () => {
      const s = await newSession(me.id);
      await addMatch(me.id, { result: "loss", at: base, sessionId: s.id });
      await addMatch(me.id, { result: "win", at: minutesAfter(base, 4), sessionId: null });
      const a = await analytics(me);
      expect(a.summary.overall.matches).toBe(2);
      expect(sp(a)).toMatchObject({ matches: 1, recovery: { lossesWithNextMatch: 0, rate: null } });
    });

    it("two real sessions never combine, even minutes apart", async () => {
      const s1 = await newSession(me.id);
      const s2 = await newSession(me.id);
      await addMatch(me.id, { result: "win", at: base, sessionId: s1.id });
      await addMatch(me.id, { result: "win", at: minutesAfter(base, 3), sessionId: s2.id });
      expect(sp(await analytics(me))).toMatchObject({
        segments: 2,
        sessions: 2,
        streaks: { longestWin: 1 },
      });
    });

    it("inside one session: a 44 min gap stays one segment; a 45 min gap splits (analytics only)", async () => {
      const s = await newSession(me.id);
      await addMatch(me.id, { result: "win", at: base, sessionId: s.id });
      await addMatch(me.id, { result: "win", at: minutesAfter(base, 44), sessionId: s.id });
      await addMatch(me.id, { result: "win", at: minutesAfter(base, 89), sessionId: s.id });
      const a = sp(await analytics(me));
      expect(a).toMatchObject({
        segments: 2,
        sessions: 1,
        splitSessions: 1,
        streaks: { longestWin: 2 },
      });
      // Nothing was written: still one DB session, matches untouched.
      const rows = await db.execute<{ n: number }>(
        sql`select count(distinct session_id)::int as n from match where player_id = ${me.id}`,
      );
      expect(Number(rows[0]?.n)).toBe(1);
    });

    it("an analytics segment boundary is NOT a real session boundary (active session, ≥ 45 min gap)", async () => {
      // A modern session can legitimately contain a ≥ 45 min gap (e.g. held open by fresh Practice
      // presence). The real session stays ONE active session; analytics sees two segments.
      const active = await newSession(me.id, "active");
      const a1 = await addMatchReturningId(me.id, {
        result: "win",
        at: base,
        sessionId: active.id,
      });
      const a2 = await addMatchReturningId(me.id, {
        result: "win",
        at: minutesAfter(base, 45),
        sessionId: active.id,
      });
      const before = await db
        .select()
        .from(gameSession)
        .where(sql`${gameSession.id} = ${active.id}`);

      const a = sp(await analytics(me));
      expect(a).toMatchObject({
        segments: 2,
        sessions: 1,
        splitSessions: 1,
        matches: 2,
        streaks: { longestWin: 1 }, // the streak does not bridge the segments
      });
      expect(a.duration.medianMs).toBe(0); // two one-match segments

      // Real session and memberships untouched: still ONE active session holding both matches.
      const after = await db
        .select()
        .from(gameSession)
        .where(sql`${gameSession.id} = ${active.id}`);
      expect(after).toEqual(before);
      expect(after[0]?.status).toBe("active");
      const members = await db
        .select({ id: match.id, sessionId: match.sessionId })
        .from(match)
        .where(sql`${match.id} in (${a1}, ${a2})`);
      expect(members.map((m) => m.sessionId)).toEqual([active.id, active.id]);
      const sessions = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(gameSession)
        .where(sql`${gameSession.playerId} = ${me.id}`);
      expect(sessions[0]?.n).toBe(1);
    });

    it("an ACTIVE session is included; started_at / ended_at never alter gameplay duration", async () => {
      const active = await newSession(me.id, "active");
      await addMatch(me.id, { result: "win", at: base, sessionId: active.id });
      await addMatch(me.id, { result: "loss", at: minutesAfter(base, 10), sessionId: active.id });
      // An ended session whose started_at/ended_at span days.
      const [wide] = await db
        .insert(gameSession)
        .values({
          playerId: me.id,
          status: "ended",
          startedAt: daysAgo(5),
          endedAt: daysAgo(1.5),
          filter: { modes: ["ranked"] },
        })
        .returning();
      await addMatch(me.id, { result: "win", at: daysAgo(4), sessionId: wide!.id });
      await addMatch(me.id, {
        result: "win",
        at: minutesAfter(daysAgo(4), 6),
        sessionId: wide!.id,
      });
      const a = sp(await analytics(me));
      expect(a).toMatchObject({ segments: 2, sessions: 2 });
      expect(a.duration.medianMs).toBe(8 * 60_000); // (10 + 6) / 2 min — from matches only
    });

    it("zero-match DB sessions do not count; payload has no opponent names or ratings", async () => {
      await newSession(me.id); // no matches
      await newSession(me.id, "active"); // no matches
      const s = await newSession(me.id);
      await addMatch(me.id, { result: "win", at: base, sessionId: s.id });
      const a = await analytics(me);
      expect(sp(a)).toMatchObject({ segments: 1, sessions: 1 });
      const payload = JSON.stringify(sp(a));
      expect(payload).not.toContain(SECRET_OPPONENT);
      expect(payload).not.toContain("19000");
    });
  });
});
