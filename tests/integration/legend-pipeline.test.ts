/**
 * Phase 5.4C QA — the Dynamic Legend pipeline end to end, IN PROCESS, with production code at
 * every stage (no Capcom, no network, no production system):
 *
 *   simulated Buckler (sanitized fixtures, anonymized in memory)
 *     → Companion runCycle (real normalization, ranking lookup, cadence, backoff, wire whitelist)
 *     → real /api/companion/{state,sync} route handlers (strict schema, device auth)
 *     → local PostgreSQL (TEST_DATABASE_URL, verified local)
 *     → buildPlayerLiveState → public overlay payload → Rank Progress projection
 *
 * Scenarios A–H of the QA plan run through it with controlled clocks. Identities are fictitious:
 * the fixture CFN and every player name / CFN in the copies are replaced before any parsing.
 * SSE delivery and the browser renderer are covered by the separate Chromium QA (not here).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
/** Environment guard: only a local database may receive these writes. */
function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
const RUN = isLocalDatabase(TEST_DB);
if (RUN) process.env.DATABASE_URL = TEST_DB;
process.env.SF6_PROVIDER = "companion";
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, gameSession, playerCharacterRating, sf6Player } =
  await import("@/server/db/schema");
const { createPairingCode } = await import("@/server/companion/service");
const { resetRateLimits } = await import("@/server/security/rate-limit");
const pairRoute = await import("@/app/api/companion/pair/route");
const stateRoute = await import("@/app/api/companion/state/route");
const syncRoute = await import("@/app/api/companion/sync/route");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { CompanionSF6DataProvider } = await import("@/server/sf6/providers/companion");
const { buildPlayerLiveState, startSession } = await import("@/server/sessions/service");
const overlays = await import("@/server/overlays/service");
const { loadOverlayPayload } = await import("@/server/overlays/public");
const { DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, resolveRankProgressView } =
  await import("@/domain/overlay/rank-progress");
const { LEGEND_REFERENCE } = await import("@sf6/capcom-core");
const { CompanionBucklerClient } =
  await import("../../apps/companion-extension/src/lib/buckler-client");
const { CompanionStorage, memoryArea } =
  await import("../../apps/companion-extension/src/lib/storage");
const { runCycle } = await import("../../apps/companion-extension/src/lib/sync");
const { TrackerClient } = await import("../../apps/companion-extension/src/lib/tracker-client");
const helpers = await import("../../apps/companion-extension/test/helpers");
type RawResponse = import("../../apps/companion-extension/src/lib/buckler-transport").RawResponse;
type BucklerTransport =
  import("../../apps/companion-extension/src/lib/buckler-transport").BucklerTransport;

const FIXTURE_CFN = helpers.CFN;
const TRACKER = "http://tracker.test"; // in-process only: never a network host
const MIN = 60_000;

/* ───────── fictitious identities (applied to every simulated Buckler answer) ───────── */

/**
 * Replace every CFN / fighter name in a Buckler body with fictitious values (stable mapping):
 * the tracked CFN everywhere it appears, other players' `short_id`s and every `fighter_id`.
 * Timestamps and ratings are untouched.
 */
function anonymizer(simCfn: string) {
  const ids = new Map<string, string>([[FIXTURE_CFN, simCfn]]);
  const names = new Map<string, string>();
  return (text: string) =>
    text
      .split(FIXTURE_CFN)
      .join(simCfn)
      .replace(/"short_id":\s*(\d+)/g, (_, id: string) => {
        if (id === simCfn) return `"short_id":${id}`;
        if (!ids.has(id)) ids.set(id, String(9_990_100_000 + ids.size));
        return `"short_id":${ids.get(id)!}`;
      })
      .replace(/"fighter_id":\s*"((?:[^"\\]|\\.)*)"/g, (_, name: string) => {
        if (!names.has(name)) names.set(name, `SIM-${names.size + 1}`);
        return `"fighter_id":"${names.get(name)}"`;
      });
}

interface CharacterEdit {
  mr?: number;
  position?: number;
  lp?: number;
}

/** play.json copy with edited league_info (production schema, fixture shape). */
function playWith(edits: Record<string, CharacterEdit>): RawResponse {
  const raw = helpers.fixtureJson(`play-${FIXTURE_CFN}.json`) as {
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
    if (!e) continue;
    if (e.mr !== undefined) {
      c.league_info.master_league = 36;
      c.league_info.master_rating = e.mr;
    }
    if (e.position !== undefined) c.league_info.master_rating_ranking = e.position;
    if (e.lp !== undefined) c.league_info.league_point = e.lp;
  }
  return { status: 200, contentType: "application/json", text: JSON.stringify(raw) };
}

/**
 * Simulated Buckler: the sanitized fixtures at their real paths (helpers.fixtureTransport, which
 * also serves ranking-master-page-25/26 with dynamic buildId + page locale + season_type=1),
 * requested for the fictitious CFN and anonymized before the Companion parses anything.
 */
function simulatedBuckler(simCfn: string) {
  let overrides: Record<string, RawResponse> = {};
  const paths: string[] = [];
  const anonymize = anonymizer(simCfn);
  const transport: BucklerTransport = {
    kind: "service_worker",
    async fetchText(path, headers) {
      if (!path.startsWith("/6/buckler/")) throw new Error(`unexpected Buckler path ${path}`);
      paths.push(path);
      const inner = helpers.fixtureTransport("service_worker", overrides);
      const res = await inner.fetchText(path.split(simCfn).join(FIXTURE_CFN), headers);
      return { ...res, text: anonymize(res.text) };
    },
  };
  return {
    transport,
    paths,
    ranking: () => paths.filter((p) => p.includes("/ranking/master.json")),
    set(next: Record<string, RawResponse>) {
      overrides = next;
    },
  };
}

describe.skipIf(!RUN)("Dynamic Legend pipeline (in-process, local DB)", () => {
  const db = RUN ? getDb() : (null as never);
  const createdUsers: string[] = [];

  beforeAll(() => {
    // Guard (again, at run time): a local test database and an in-process tracker only.
    expect(isLocalDatabase(process.env.DATABASE_URL)).toBe(true);
    expect(new URL(TRACKER).hostname).toBe("tracker.test");
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(async () => {
    if (createdUsers.length) await db.delete(authUser).where(inArray(authUser.id, createdUsers));
    await closeDb();
  });

  /** A fictitious account with a paired Companion running the real cycle against the routes. */
  async function setup(simCfn: string) {
    const userId = randomUUID();
    createdUsers.push(userId);
    await db.insert(authUser).values({ id: userId, name: "SIM", email: `${userId}@test.local` });
    const { code } = await createPairingCode(db, userId);
    resetRateLimits();
    const pair = await pairRoute.POST(
      new Request(`${TRACKER}/api/companion/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, deviceName: "SIM browser" }),
      }),
    );
    expect(pair.status).toBe(200);
    const { deviceToken } = (await pair.json()) as { deviceToken: string };

    const sent: string[] = [];
    const trackerFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== TRACKER) throw new Error(`refusing a non-local tracker: ${url.origin}`);
      const request = new Request(url, init);
      resetRateLimits(); // the 1/5 s device limiter is covered elsewhere
      if (url.pathname === "/api/companion/state") return stateRoute.GET(request);
      if (url.pathname === "/api/companion/sync") {
        sent.push(String(init?.body ?? ""));
        return syncRoute.POST(request);
      }
      return new Response("{}", { status: 404 });
    };
    const buckler = simulatedBuckler(simCfn);
    const area = memoryArea({
      deviceToken,
      deviceId: "sim",
      trackerStatus: "connected",
      manualCfnUserId: simCfn,
    });
    /** One Companion cycle at a controlled clock. A fresh storage/client each time = restart-safe. */
    const cycle = async (
      at: number,
      play: RawResponse,
      extra: Record<string, RawResponse> = {},
    ) => {
      buckler.set({ "play.json": play, ...extra });
      // One monotonic clock for the Companion AND the server's acceptance time (`new Date()` in the
      // route): the real wall clock of a dev VM can step backwards by ~100 ms (observed under
      // WSL2), which the acceptance-ordered observed_at guard then rightly treats as an older
      // observation. Only Date is faked; Postgres I/O keeps real timers.
      vi.setSystemTime(at);
      const outcome = await runCycle(
        {
          storage: new CompanionStorage(area),
          tracker: new TrackerClient(TRACKER, deviceToken, trackerFetch),
          buckler: new CompanionBucklerClient(buckler.transport),
          now: () => new Date(at),
        },
        true, // "Sync now": play + battlelog due (the ranking cadence still applies)
      );
      if (outcome !== "synced") {
        const st = await new CompanionStorage(area).load();
        throw new Error(`cycle: ${outcome} (${st.lastError})`);
      }
      return outcome;
    };
    const store = () => new CompanionStorage(area).load();
    const lastLegend = () => {
      const body = JSON.parse(sent[sent.length - 1] ?? "{}") as { legend?: unknown };
      return body.legend;
    };
    /** Onboarding through the real path (Companion snapshot → provider → upsertPlayerForUser). */
    const register = async () => {
      const provider = new CompanionSF6DataProvider(db, 300_000);
      const profile = await provider.getPlayerProfile(simCfn, { scope: { userId } });
      return upsertPlayerForUser(db, userId, profile);
    };
    return { userId, buckler, cycle, store, sent, lastLegend, register };
  }

  async function project(playerId: string, characterKey: string, nowMs?: number) {
    const [ov] = (await overlays.listOverlays(db, playerId)).filter(
      (o) => o.config.kind === "rank-progress",
    );
    const overlay =
      ov ??
      (await overlays.createOverlay(db, playerId, "SIM RP", DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG));
    const p = (await loadOverlayPayload(overlay.publicToken))!.payload;
    if (p.config.kind !== "rank-progress") throw new Error("kind");
    return {
      payload: p,
      view: resolveRankProgressView(
        p.live.session,
        { ...p.config, characterKey },
        {
          legendCutoff: p.live.legendCutoff ?? null,
          nowMs: nowMs ?? Date.parse(p.live.generatedAt),
        },
      ),
    };
  }
  const ratingRow = async (playerId: string, key: string) =>
    (
      await db
        .select()
        .from(playerCharacterRating)
        .where(eq(playerCharacterRating.playerId, playerId))
    ).find((r) => r.characterKey === key)!;
  const playerRow = async (playerId: string) =>
    (await db.select().from(sf6Player).where(eq(sf6Player.id, playerId)))[0]!;

  it("scenarios G → A → B → C → D → E and H, cadence, restart, failures, privacy", async () => {
    const SIM = "9990000001";
    const s = await setup(SIM);
    const t0 = Date.now();

    // G · 1750 MR (Grand Master): no ranking request; onboarding through the real snapshot path.
    expect(await s.cycle(t0, playWith({ ryu: { mr: 1750, position: 9000 } }))).toBe("synced");
    expect(s.buckler.ranking()).toEqual([]);
    const player = await s.register();
    expect(player.cfnUserId).toBe(SIM);
    await s.cycle(t0 + MIN, playWith({ ryu: { mr: 1750, position: 9000 } }));
    let { view, payload } = await project(player.id, "ryu");
    expect(payload.live.session.status).toBe("none"); // no SST session
    expect(view.state).toMatchObject({
      kind: "progress",
      current: { value: 1750, label: "Grand Master" },
      target: { value: 1800, label: "Ultimate Master" },
      remaining: 50,
    });
    expect(s.buckler.ranking()).toEqual([]);

    // A · 2189 #530: first eligible lookup (pages 25 + 26), derived boundary synced and stored.
    expect(await s.cycle(t0 + 2 * MIN, playWith({ ryu: { mr: 2189, position: 530 } }))).toBe(
      "synced",
    );
    expect(s.buckler.ranking()).toHaveLength(2);
    expect(s.buckler.ranking()[0]).toMatch(
      /^\/6\/buckler\/_next\/data\/[A-Za-z0-9_-]+\/en\/ranking\/master\.json\?page=25&season_type=1$/,
    );
    expect(s.lastLegend()).toEqual({
      cutoffMr: 2196,
      lastLegendPosition: 497,
      firstNonLegendPosition: 505,
      firstNonLegendMr: 2195,
    });
    expect(await ratingRow(player.id, "ryu")).toMatchObject({
      masterRate: 2189,
      masterRatingRanking: 530,
    });
    const stored = await playerRow(player.id);
    expect(stored).toMatchObject({ legendCutoffMr: 2196, legendLastPosition: 497 });
    expect(Math.abs(stored.legendCutoffObservedAt!.getTime() - Date.now())).toBeLessThan(MIN); // server time
    ({ view } = await project(player.id, "ryu"));
    expect(view.state).toMatchObject({
      kind: "legend-chase",
      position: 530,
      remaining: 7,
      start: { value: 1800 },
      cutoff: { value: 2196 },
    });
    if (view.state.kind === "legend-chase") {
      expect(view.state.progress).toBeCloseTo((2189 - 1800) / (2196 - 1800), 12);
    }

    // B · 2196 #505 at the cutoff: NOT Legend, no bar; cadence: no ranking request (< 15 min).
    await s.cycle(t0 + 4 * MIN, playWith({ ryu: { mr: 2196, position: 505 } }));
    expect(s.buckler.ranking()).toHaveLength(2);
    expect(s.lastLegend()).toBeUndefined();
    ({ view } = await project(player.id, "ryu"));
    expect(view.state).toMatchObject({
      kind: "legend-boundary",
      position: 505,
      cutoff: { value: 2196 },
    });
    expect(view.state).not.toHaveProperty("remaining");

    // C · 2241 #327: authoritative Legend, terminal; independent of cutoff freshness.
    await s.cycle(t0 + 6 * MIN, playWith({ ryu: { mr: 2241, position: 327 } }));
    ({ view } = await project(player.id, "ryu"));
    expect(view.state).toEqual({
      kind: "legend",
      system: "mr",
      current: { value: 2241, label: "Legend" },
      position: 327,
    });
    const muchLater = (await playerRow(player.id)).legendCutoffObservedAt!.getTime() + 120 * MIN;
    expect((await project(player.id, "ryu", muchLater)).view.state.kind).toBe("legend");

    // D · 2200 with the position missing (0) in a LATER profile: cleared, never Legend by MR.
    await s.cycle(t0 + 8 * MIN, playWith({ ryu: { mr: 2200, position: 0 } }));
    expect(await ratingRow(player.id, "ryu")).toMatchObject({
      masterRate: 2200,
      masterRatingRanking: null,
    });
    ({ view } = await project(player.id, "ryu"));
    expect(view.state).toMatchObject({ kind: "legend-boundary", position: null });

    // Restart (fresh storage instance over the same persisted area): attempt time survives.
    expect((await s.store()).legendAttemptAt).toBe(new Date(t0 + 2 * MIN).toISOString());
    await s.cycle(t0 + 10 * MIN, playWith({ ryu: { mr: 2200, position: 600 } }));
    expect(s.buckler.ranking()).toHaveLength(2);

    // Refresh due (≥ 15 min after the attempt) but ranking 5xx: one request, sync still lands.
    await s.cycle(t0 + 17 * MIN, playWith({ ryu: { mr: 2134, position: 700 } }), {
      "ranking/master.json": { status: 503, contentType: "text/html", text: "down" },
    });
    expect(s.buckler.ranking()).toHaveLength(3);
    expect(s.lastLegend()).toBeUndefined();
    expect(await ratingRow(player.id, "ryu")).toMatchObject({
      masterRate: 2134,
      masterRatingRanking: 700,
    });
    expect((await s.store()).bucklerStatus).toBe("ok");
    expect((await playerRow(player.id)).legendCutoffMr).toBe(2196); // previous reference kept

    // E · 2134 #700: chase while the reference is fresh; stale after 30 min ⇒ 5.4B fallback.
    const observed = (await playerRow(player.id)).legendCutoffObservedAt!.getTime();
    expect((await project(player.id, "ryu", observed + 10 * MIN)).view.state).toMatchObject({
      kind: "legend-chase",
      remaining: 62,
    });
    expect((await project(player.id, "ryu", observed + 31 * MIN)).view.state).toEqual({
      kind: "ultimate-master",
      system: "mr",
      current: { value: 2134, label: "Ultimate Master" },
      position: 700,
    });

    // Ranking-only login refusal: Buckler NOT paused, ranking backs off 1 h.
    const loginWall: RawResponse = {
      status: 403,
      contentType: "text/html",
      text: '<script id="__NEXT_DATA__" type="application/json">{"page":"/ranking/master"}</script>',
    };
    await s.cycle(t0 + 33 * MIN, playWith({ ryu: { mr: 2134, position: 700 } }), {
      "ranking/master.json": loginWall,
    });
    expect(s.buckler.ranking()).toHaveLength(4);
    let st = await s.store();
    expect(st.bucklerBackoffUntil).toBeNull();
    expect(st.legendBackoffUntil).toBe(
      new Date(t0 + 33 * MIN + LEGEND_REFERENCE.refusalBackoffMs).toISOString(),
    );
    await s.cycle(t0 + 50 * MIN, playWith({ ryu: { mr: 2134, position: 700 } }));
    expect(s.buckler.ranking()).toHaveLength(4); // backoff respected (> 15 min, < 1 h)

    // A fresh reference after the backoff replaces the expired one ⇒ chase again.
    await s.cycle(t0 + 94 * MIN, playWith({ ryu: { mr: 2189, position: 530 } }));
    expect(s.buckler.ranking()).toHaveLength(6);
    st = await s.store();
    expect(st.legendBackoffUntil).toBeNull();
    expect((await project(player.id, "ryu")).view.state.kind).toBe("legend-chase");

    // H · LP character (Luke 22000 LP, a stray ranking number on it): LP progress, no position.
    await s.cycle(
      t0 + 96 * MIN,
      playWith({ ryu: { mr: 2189, position: 530 }, luke: { lp: 22000, position: 1234 } }),
    );
    expect(await ratingRow(player.id, "luke")).toMatchObject({
      ratingSystem: "lp",
      leaguePoints: 22000,
      masterRatingRanking: null,
    });
    ({ view, payload } = await project(player.id, "luke"));
    expect(view.state).toMatchObject({
      kind: "progress",
      system: "lp",
      current: { value: 22000, label: "Diamond 3" },
      target: { value: 22600, label: "Diamond 4" },
      remaining: 600,
    });
    expect(
      payload.live.session.characters.find((c) => c.characterKey === "luke")?.leaderboardPosition ??
        null,
    ).toBeNull();

    // Character identity: Ryu keeps HIS position and MR; never mixed with another character.
    const ryu = payload.live.session.characters.find((c) => c.characterKey === "ryu")!;
    expect(ryu).toMatchObject({ leaderboardPosition: 530, current: { value: 2189 } });

    // Privacy: what left the Companion, and what was stored, carries no leaderboard rows,
    // no other player identity, no credential.
    const wire = s.sent.join("\n");
    expect(wire).not.toMatch(
      /ranking_fighter_list|SANITIZED|master_league|"rating"|cookie|authorization/i,
    );
    for (const body of s.sent) {
      const legend = (JSON.parse(body) as { legend?: Record<string, unknown> }).legend;
      if (legend)
        expect(Object.keys(legend).sort()).toEqual([
          "cutoffMr",
          "firstNonLegendMr",
          "firstNonLegendPosition",
          "lastLegendPosition",
        ]);
    }
    expect(JSON.stringify(await playerRow(player.id))).not.toMatch(
      /SANITIZED|fighter|ranking_fighter_list/,
    );
    expect(JSON.stringify(payload)).not.toMatch(/ranking_fighter_list|fighter_id|short_id/);
  });

  it("with an active SST session the same observation keeps its position", async () => {
    const SIM = "9990000002";
    const s = await setup(SIM);
    const t0 = Date.now();
    await s.cycle(t0, playWith({ ryu: { mr: 2189, position: 530 } }));
    const player = await s.register();
    await s.cycle(t0 + 16 * MIN, playWith({ ryu: { mr: 2189, position: 530 } }));
    await startSession(db, new CompanionSF6DataProvider(db, 300_000), player);
    const live = (await buildPlayerLiveState(db, player.id))!;
    expect(live.session.status).toBe("active");
    const ryu = live.session.characters.find((c) => c.characterKey === "ryu")!;
    expect(ryu).toMatchObject({
      current: { value: 2189, rank: "Ultimate Master" },
      leaderboardPosition: 530,
    });
    expect((await project(player.id, "ryu")).view.state).toMatchObject({
      kind: "legend-chase",
      remaining: 7,
    });
    const sessions = await db.select().from(gameSession).where(eq(gameSession.playerId, player.id));
    expect(sessions.map((x) => x.status)).toEqual(["active"]);
  });

  it("F · no reference ever (ranking unavailable): Ultimate Master, Top 500 required, no number", async () => {
    const SIM = "9990000003";
    const s = await setup(SIM);
    const t0 = Date.now();
    const down = { "ranking/master.json": { status: 503, contentType: "text/html", text: "down" } };
    await s.cycle(t0, playWith({ ryu: { mr: 2134, position: 700 } }), down);
    const player = await s.register();
    await s.cycle(t0 + 16 * MIN, playWith({ ryu: { mr: 2134, position: 700 } }), down);
    const { view, payload } = await project(player.id, "ryu");
    expect(payload.live.legendCutoff ?? null).toBeNull();
    expect(view.state).toEqual({
      kind: "ultimate-master",
      system: "mr",
      current: { value: 2134, label: "Ultimate Master" },
      position: 700,
    });
  });
});
