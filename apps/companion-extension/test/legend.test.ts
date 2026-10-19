/**
 * Phase 5.4C — Companion Legend reference: the ranking endpoint reuses the _next/data machinery
 * (buildId / locale recovery, no retry storms), lookups run only for Ultimate Master profiles at
 * most every 15 min, a failing lookup never fails the sync, and only derived numbers leave.
 */
import { describe, expect, it } from "vitest";
import { COMPANION_POLLING, LEGEND_REFERENCE } from "@sf6/capcom-core";
import type { RawResponse } from "../src/lib/buckler-transport";
import { BucklerError, CompanionBucklerClient } from "../src/lib/buckler-client";
import { CompanionStorage, memoryArea } from "../src/lib/storage";
import { isLegendLookupDue, runCycle } from "../src/lib/sync";
import {
  BUILD_ID,
  CFN,
  LOCALE_REFUSED_400,
  fakeTracker,
  fixtureJson,
  fixtureTransport,
} from "./helpers";

const NOW = new Date("2026-10-19T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

/** play.json where Ryu is Ultimate Master (2189 MR, #530) — else the captured fixture. */
function ultimatePlay(mr = 2189, position = 530): RawResponse {
  const raw = fixtureJson(`play-${CFN}.json`) as {
    pageProps: {
      play: {
        character_league_infos: Array<{
          character_tool_name: string;
          league_info: Record<string, number>;
        }>;
      };
    };
  };
  const ryu = raw.pageProps.play.character_league_infos.find(
    (c) => c.character_tool_name === "ryu",
  )!;
  ryu.league_info.master_rating = mr;
  ryu.league_info.master_rating_ranking = position;
  return { status: 200, contentType: "application/json", text: JSON.stringify(raw) };
}

async function storage(extra: Record<string, unknown> = {}) {
  return new CompanionStorage(
    memoryArea({
      deviceToken: "sf6c_test",
      deviceId: "d1",
      trackerStatus: "connected",
      // Profile due, battlelog recently done (keeps the cycle small and deterministic).
      lastBattlelogAt: ago(10_000),
      ...extra,
    }),
  );
}

const rankingPaths = (paths: string[]) => paths.filter((p) => p.includes("/ranking/master.json"));

describe("ranking endpoint (same _next/data machinery)", () => {
  it("page locale + dynamic buildId + current phase", async () => {
    const t = fixtureTransport("service_worker", {}, { pageLocale: "es-es" });
    const client = new CompanionBucklerClient(t);
    await client.getMasterRankingPage(CFN, 25).catch(() => undefined);
    expect(rankingPaths(t.paths)[0]).toBe(
      `/6/buckler/_next/data/${BUILD_ID}/es-es/ranking/master.json?page=25&season_type=1`,
    );
  });

  it("stale buildId (404): one invalidation + one retry, never a loop", async () => {
    const t = fixtureTransport("service_worker", {
      "ranking/master.json": { status: 404, contentType: "text/html", text: "Not Found" },
    });
    const client = new CompanionBucklerClient(t);
    const err = await client.getMasterRankingPage(CFN, 25).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BucklerError);
    expect((err as BucklerError).kind).toBe("not_found");
    expect(rankingPaths(t.paths)).toHaveLength(2);
    expect(t.paths.filter((p) => p === `/6/buckler/profile/${CFN}`)).toHaveLength(2);
  });

  it("locale mismatch (gSSP redirect to another locale): a single fallback to `en`", async () => {
    const redirectToFr: RawResponse = {
      status: 200,
      contentType: "application/json",
      text: JSON.stringify({
        pageProps: { __N_REDIRECT: "/6/buckler/fr/ranking/master", __N_REDIRECT_STATUS: 307 },
      }),
    };
    const t = fixtureTransport(
      "service_worker",
      { "/es-es/ranking/master.json": redirectToFr },
      { pageLocale: "es-es", servedLocales: ["en"] },
    );
    expect(await new CompanionBucklerClient(t).getMasterRankingPage(CFN, 25)).toBeTruthy();
    expect(rankingPaths(t.paths).map((p) => p.split("/")[6])).toEqual(["es-es", "en"]);
    // A plain 400 on the page's own locale is NOT retried in other languages.
    const t2 = fixtureTransport("service_worker", {}, { pageLocale: "es-es", servedLocales: [] });
    const err = await new CompanionBucklerClient(t2)
      .getMasterRankingPage(CFN, 25)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "invalid_response", status: 400 });
    expect(rankingPaths(t2.paths)).toHaveLength(1);
    expect(LOCALE_REFUSED_400.status).toBe(400);
  });

  it.each([
    [403, "text/html", "Request blocked", "blocked"],
    [429, "application/json", "{}", "rate_limited"],
    [503, "text/html", "down", "unavailable"],
  ])("HTTP %i is classified and never retried", async (status, contentType, text, kind) => {
    const t = fixtureTransport("service_worker", {
      "ranking/master.json": { status, contentType, text },
    });
    const err = await new CompanionBucklerClient(t)
      .getMasterRankingPage(CFN, 25)
      .catch((e: unknown) => e);
    expect((err as BucklerError).kind).toBe(kind);
    expect(rankingPaths(t.paths)).toHaveLength(1);
  });

  it("a page that does not match the schema is invalid (never a silent success)", async () => {
    const t = fixtureTransport("service_worker", {
      "ranking/master.json": {
        status: 200,
        contentType: "application/json",
        text: '{"pageProps":{}}',
      },
    });
    const err = await new CompanionBucklerClient(t)
      .getMasterRankingPage(CFN, 25)
      .catch((e: unknown) => e);
    expect((err as BucklerError).kind).toBe("invalid_response");
  });
});

describe("cycle: cadence, eligibility, failure isolation, data minimization", () => {
  const run = async (
    overrides: Record<string, RawResponse>,
    extra: Record<string, unknown> = {},
  ) => {
    const tracker = fakeTracker({ activeSession: false });
    const st = await storage(extra);
    const transport = fixtureTransport("service_worker", overrides);
    const outcome = await runCycle({
      storage: st,
      tracker: tracker.client(),
      buckler: new CompanionBucklerClient(transport),
      now: () => NOW,
    });
    return { outcome, tracker, transport, store: await st.load() };
  };

  it("captured fixture profile (best MR 1500, Master) ⇒ no ranking request at all", async () => {
    const r = await run({});
    expect(r.outcome).toBe("synced");
    expect(rankingPaths(r.transport.paths)).toEqual([]);
    expect(r.tracker.sent[0]?.legend).toBeUndefined();
    expect(r.store.legendAttemptAt).toBeNull();
  });

  it("Ultimate Master profile ⇒ pages 25 + 26, boundary sent as derived numbers only", async () => {
    const r = await run({ "play.json": ultimatePlay() });
    expect(r.outcome).toBe("synced");
    expect(rankingPaths(r.transport.paths).map((p) => /page=(\d+)/.exec(p)?.[1])).toEqual([
      "25",
      "26",
    ]);
    const sent = r.tracker.sent[0]!;
    expect(sent.legend).toEqual({
      cutoffMr: 2196,
      lastLegendPosition: 497,
      firstNonLegendPosition: 505,
      firstNonLegendMr: 2195,
    });
    expect(
      sent.profile?.characters.find((c) => c.characterKey === "ryu")?.leaderboardPosition,
    ).toBe(530);
    // Nothing from the leaderboard rows leaves the extension.
    const raw = r.tracker.rawBodies.join("\n");
    expect(raw).not.toMatch(/SANITIZED|ranking_fighter_list|fighter_banner|master_league|"rating"/);
    expect(r.store.legendAttemptAt).toBe(NOW.toISOString());
    expect(r.store.legendPageSize).toBe(20);
  });

  it("a recent attempt (< 15 min) ⇒ no ranking request; an older one ⇒ refresh", async () => {
    const fresh = await run({ "play.json": ultimatePlay() }, { legendAttemptAt: ago(14 * 60_000) });
    expect(rankingPaths(fresh.transport.paths)).toEqual([]);
    expect(fresh.tracker.sent[0]?.legend).toBeUndefined();
    const due = await run(
      { "play.json": ultimatePlay() },
      { legendAttemptAt: ago(LEGEND_REFERENCE.refreshMs) },
    );
    expect(rankingPaths(due.transport.paths).length).toBeGreaterThan(0);
  });

  it("no lookup on a cycle without a profile fetch (never on the 30 s battlelog beat)", async () => {
    const r = await run(
      { "play.json": ultimatePlay() },
      { lastProfileAt: ago(5_000), lastBattlelogAt: ago(10 * 60_000) },
    );
    expect(r.outcome).toBe("synced");
    expect(r.transport.paths.some((p) => p.includes("play.json"))).toBe(false);
    expect(rankingPaths(r.transport.paths)).toEqual([]);
  });

  it("ranking 5xx / invalid ⇒ profile + matches still synced, no legend, attempt recorded", async () => {
    for (const failure of [
      { status: 503, contentType: "text/html", text: "down" },
      { status: 200, contentType: "application/json", text: '{"pageProps":{}}' },
    ]) {
      const r = await run({ "play.json": ultimatePlay(), "ranking/master.json": failure });
      expect(r.outcome).toBe("synced");
      expect(r.tracker.sent[0]?.profile).not.toBeNull();
      expect(r.tracker.sent[0]?.legend).toBeUndefined();
      expect(r.store.bucklerStatus).toBe("ok");
      expect(r.store.bucklerBackoffUntil).toBeNull();
      expect(r.store.legendAttemptAt).toBe(NOW.toISOString()); // no retry next cycle
    }
  });

  it("ranking 429 ⇒ this cycle's data is still synced; then Buckler pauses (no storm)", async () => {
    const r = await run({
      "play.json": ultimatePlay(),
      "ranking/master.json": { status: 429, contentType: "application/json", text: "{}" },
    });
    expect(r.outcome).toBe("synced");
    expect(r.tracker.sent).toHaveLength(1);
    expect(r.tracker.sent[0]?.legend).toBeUndefined();
    expect(rankingPaths(r.transport.paths)).toHaveLength(1);
    expect(r.store.bucklerStatus).toBe("rate_limited");
    expect(new Date(r.store.bucklerBackoffUntil!).getTime()).toBe(
      NOW.getTime() + COMPANION_POLLING.bucklerBackoffMs,
    );
  });

  it("boundary not provable within the cap ⇒ nothing sent, never a guess", async () => {
    const legendOnly = (n: number): RawResponse => ({
      status: 200,
      contentType: "application/json",
      text: JSON.stringify({
        pageProps: {
          master_rating_ranking: {
            current_page: n,
            total_page: 1500,
            total_count: 30000,
            // 20 Legend-only rows per page, ordered across pages: the boundary never appears.
            ranking_fighter_list: Array.from({ length: 20 }, (_, i) => ({
              rating: 2400 - (n - 25) * 20 - i,
              master_rating_ranking: 300 + (n - 25) * 20 + i,
              master_league: 37,
            })),
          },
        },
      }),
    });
    const overrides: Record<string, RawResponse> = { "play.json": ultimatePlay() };
    for (let n = 25; n <= 31; n++) overrides[`master.json?page=${n}&`] = legendOnly(n);
    const r = await run(overrides);
    expect(r.outcome).toBe("synced");
    expect(rankingPaths(r.transport.paths)).toHaveLength(LEGEND_REFERENCE.maxPages);
    expect(r.tracker.sent[0]?.legend).toBeUndefined();
  });

  it("isLegendLookupDue: eligibility × 15 min", () => {
    const profile = {
      cfnUserId: CFN,
      displayName: "x",
      characters: [
        {
          characterKey: "ryu",
          characterName: "Ryu",
          rank: null,
          rankTier: null,
          ratingSystem: "mr" as const,
          leaguePoints: 0,
          masterRate: 1900,
          leaderboardPosition: 900,
        },
      ],
    };
    const t = NOW.getTime();
    expect(isLegendLookupDue({ legendAttemptAt: null }, profile, t)).toBe(true);
    expect(isLegendLookupDue({ legendAttemptAt: ago(60_000) }, profile, t)).toBe(false);
    expect(isLegendLookupDue({ legendAttemptAt: null }, null, t)).toBe(false);
    const diamond = {
      ...profile,
      characters: [{ ...profile.characters[0]!, ratingSystem: "lp" as const, masterRate: null }],
    };
    expect(isLegendLookupDue({ legendAttemptAt: null }, diamond, t)).toBe(false);
  });
});
