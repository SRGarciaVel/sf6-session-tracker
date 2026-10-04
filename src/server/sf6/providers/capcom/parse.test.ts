import { describe, expect, it } from "vitest";
import { ratingDelta } from "@/domain/sf6/rating";
import { normalizedMatchSchema, normalizedProfileSchema, SF6ProviderError } from "../../provider";
import { mapLeagueInfo } from "./league";
import {
  countRoundsWon,
  mapReplayBattleType,
  normalizeCapcomMatches,
  normalizeCapcomProfile,
  parseCapcomBattlelogPayload,
  parseCapcomCardPayload,
  parseCapcomPlayPayload,
  resolveMatchPerspective,
  TrackedPlayerNotInReplayError,
  uploadedAtToDate,
} from "./parse";
import { replaySchema } from "./schemas";
import { CFN, cardFixture, playFixture, replaysOf } from "./test-fixtures";

const NOW = new Date("2026-10-04T00:00:00Z");
const profileOf = (raw: unknown = playFixture()) =>
  normalizeCapcomProfile(parseCapcomPlayPayload(raw), { cfnUserId: CFN });
const matchesOf = (replays: unknown[]) =>
  normalizeCapcomMatches(replays, { trackedCfnId: CFN, now: NOW });
const replay = (page: 1 | 2, id: string) => {
  const found = replaysOf(page).find((r) => r.replay_id === id);
  if (!found) throw new Error(`fixture replay ${id} missing`);
  return replaySchema.parse(found);
};

describe("Capcom profile (play.json / card)", () => {
  it("1. parses the card payload", () => {
    expect(parseCapcomCardPayload(cardFixture())).toEqual({
      cfnUserId: CFN,
      displayName: "TDF | Comunismo",
      favoriteCharacterKey: "aki",
      leagueRankRaw: 31,
      leaguePoints: 19704,
      masterRate: 0,
    });
  });

  it("2. parses the play payload and confirms identity", () => {
    const { profile, seasonId, seasonIds } = profileOf();
    expect(profile.cfnUserId).toBe(CFN);
    expect(profile.displayName).toBe("TDF | Comunismo");
    expect(profile.favoriteCharacterKey).toBe("aki");
    expect(seasonId).toBe(13);
    expect(seasonIds[0]).toBe(13);
    expect(normalizedProfileSchema.safeParse(profile).success).toBe(true);
  });

  it("3. keeps all 32 league entries (31 characters + Random, which has its own league)", () => {
    const { profile, characters } = profileOf();
    expect(profile.characters).toHaveLength(32);
    expect(new Set(profile.characters.map((c) => c.characterKey)).size).toBe(32);
    expect(characters.find((c) => c.characterKey === "random")?.characterId).toBe(254);
  });

  it("4. A.K.I. uses character_tool_name as stable key (not derived from the name)", () => {
    const aki = profileOf().profile.characters.find((c) => c.characterKey === "aki");
    expect(aki?.characterName).toBe("A.K.I.");
    // M. Bison's tool name is "vega": proves the key is never derived from the display name.
    const bison = profileOf().profile.characters.find((c) => c.characterName === "M. Bison");
    expect(bison?.characterKey).toBe("vega");
  });

  it("5. Kimberly is Master → ratingSystem mr with her own MR", () => {
    const kim = profileOf().profile.characters.find((c) => c.characterKey === "kimberly");
    expect(kim).toMatchObject({
      ratingSystem: "mr",
      masterRate: 1479,
      leaguePoints: 26321,
      rank: "Master",
      rankTier: "master",
      phase: null,
    });
  });

  it("6. A.K.I. is LP with Capcom's own rank label", () => {
    const aki = profileOf().profile.characters.find((c) => c.characterKey === "aki");
    expect(aki).toMatchObject({
      ratingSystem: "lp",
      leaguePoints: 19704,
      masterRate: null,
      rank: "Diamond 1",
      rankTier: "diamond-1",
    });
  });

  it("7. rating systems stay separate per character; unknown rank numbers stay null", () => {
    const { profile, warnings, characters } = profileOf();
    const bySystem = (s: string | null) =>
      profile.characters.filter((c) => c.ratingSystem === s).map((c) => c.characterKey);
    expect(bySystem("mr")).toEqual(
      expect.arrayContaining([
        "ryu",
        "kimberly",
        "chunli",
        "honda",
        "gouki",
        "sagat",
        "vega",
        "mai",
        "yasmine",
      ]),
    );
    expect(bySystem("mr")).toHaveLength(9);
    for (const c of profile.characters) {
      if (c.ratingSystem === "lp") expect(c.masterRate).toBeNull();
      if (c.ratingSystem === "mr") expect(c.masterRate).toBeGreaterThan(0);
    }
    const ken = profile.characters.find((c) => c.characterKey === "ken");
    expect(ken).toMatchObject({
      ratingSystem: "lp",
      leaguePoints: 24672,
      rank: null,
      rankTier: null,
    });
    expect(characters.find((c) => c.characterKey === "ken")?.leagueRankRaw).toBe(35);
    expect(warnings.join("\n")).toContain("unknown league_rank 35 (luke, ken)");
  });

  it("8. a character without rating (league_point -1) has no system and no values", () => {
    const { profile, characters } = profileOf();
    expect(profile.characters.find((c) => c.characterKey === "manon")).toMatchObject({
      ratingSystem: null,
      leaguePoints: null,
      masterRate: null,
      rank: null,
    });
    expect(characters.find((c) => c.characterKey === "manon")).toMatchObject({
      leagueRankRaw: 39,
      unrated: true,
    });
    // is_played=false is carried through untouched
    const raw = playFixture() as {
      pageProps: { play: { character_league_infos: { is_played: boolean }[] } };
    };
    raw.pageProps.play.character_league_infos[0]!.is_played = false;
    expect(profileOf(raw).characters[0]?.isPlayed).toBe(false);
  });

  it("9. extra / unknown fields do not break the schemas", () => {
    const raw = playFixture() as {
      pageProps: Record<string, unknown> & { play: Record<string, unknown> };
    };
    raw.pageProps.brand_new_field = { nested: [1, 2, 3] };
    raw.pageProps.play.another_new_list = ["x"];
    expect(profileOf(raw).profile.characters).toHaveLength(32);
  });

  it("10. an incomplete critical payload fails with invalid_response", () => {
    const raw = playFixture() as {
      pageProps: { play: { character_league_infos: Record<string, unknown>[] } };
    };
    delete raw.pageProps.play.character_league_infos[3]!.league_info;
    expect(() => parseCapcomPlayPayload(raw)).toThrowError(SF6ProviderError);
    try {
      parseCapcomPlayPayload(raw);
    } catch (err) {
      expect((err as SF6ProviderError).code).toBe("invalid_response");
      expect((err as Error).message).toContain("character_league_infos.3.league_info");
    }
    expect(() => parseCapcomCardPayload({ sid: CFN })).toThrowError(/card payload/);
    // a play payload of another player is rejected
    const other = playFixture() as { pageProps: { sid: number } };
    other.pageProps.sid = 123456789;
    expect(() => profileOf(other)).toThrowError(/expected 1733837998/);
  });
});

describe("Capcom battlelog → NormalizedSF6Match", () => {
  it("11. replay_id → externalMatchId; all page-1 replays valid against the contract", () => {
    const { matches, rejected } = matchesOf(replaysOf(1));
    expect(rejected).toEqual([]);
    expect(matches).toHaveLength(10);
    expect(matches[0]?.externalMatchId).toBe("VGPTB9UCN");
    for (const m of matches) expect(normalizedMatchSchema.safeParse(m).success).toBe(true);
  });

  it("12. uploaded_at (Unix seconds) → UTC Date with second precision", () => {
    expect(uploadedAtToDate(1790996001)?.toISOString()).toBe("2026-10-03T02:53:21.000Z");
    expect(uploadedAtToDate(1790996002)!.getTime() - uploadedAtToDate(1790996001)!.getTime()).toBe(
      1000,
    );
    expect(uploadedAtToDate(undefined)).toBeNull();
    expect(uploadedAtToDate(0)).toBeNull();
    expect(uploadedAtToDate(1790996001.5)).toBeNull();
    expect(matchesOf(replaysOf(1)).matches[0]?.playedAt.toISOString()).toBe(
      "2026-10-03T02:53:21.000Z",
    );

    const missing = { ...replaysOf(1)[0], uploaded_at: undefined };
    const r1 = matchesOf([missing]);
    expect(r1.matches).toEqual([]);
    expect(r1.rejected[0]).toMatchObject({ replayId: "VGPTB9UCN" });

    const future = { ...replaysOf(1)[0], uploaded_at: Math.floor(NOW.getTime() / 1000) + 3600 };
    const r2 = matchesOf([future]);
    expect(r2.matches).toHaveLength(1); // kept, but flagged
    expect(r2.warnings.join()).toContain("uploaded_at in the future");
  });

  it("13. tracked player as P1", () => {
    const p = resolveMatchPerspective(replay(1, "VGPTB9UCN"), CFN);
    expect(p.side).toBe("P1");
    expect(p.tracked.character_tool_name).toBe("aki");
  });

  it("14. tracked player as P2 (never assumes player1)", () => {
    const p = resolveMatchPerspective(replay(2, "NT4WT4JTE"), CFN);
    expect(p.side).toBe("P2");
    expect(p.tracked.player.short_id).toBe(1733837998);
    expect(p.opponent.player.fighter_id).toBe("Kuroki");
    const m = matchesOf(replaysOf(2)).matches.find((x) => x.externalMatchId === "NT4WT4JTE");
    expect(m).toMatchObject({ characterKey: "aki", result: "win" });
    expect(m?.opponent).toMatchObject({
      name: "Kuroki",
      characterKey: "vega",
      characterName: "M. Bison",
    });
  });

  it("15+16. correct rival and own character", () => {
    const m = matchesOf(replaysOf(1)).matches[0];
    expect(m).toMatchObject({
      characterKey: "aki",
      characterName: "A.K.I.",
      mode: "ranked",
      playerControlType: "classic",
      opponent: { name: "Lukanight", characterKey: "chunli", characterName: "Chun-Li", rank: null },
    });
  });

  it("17+18. result win / loss from round_results (Capcom's own rule: count rounds > 0)", () => {
    expect(countRoundsWon([1, 0, 1])).toBe(2);
    expect(countRoundsWon([0, 6, 1])).toBe(2);
    expect(countRoundsWon([0, 0])).toBe(0);
    const byId = new Map(matchesOf(replaysOf(1)).matches.map((m) => [m.externalMatchId, m.result]));
    expect(byId.get("VGPTB9UCN")).toBe("win"); // [1,0,1] vs [0,1,0]
    expect(byId.get("87KAHLBF5")).toBe("win"); // [0,6,1] vs [1,0,0]
    expect(byId.get("Y5BPN463L")).toBe("loss"); // [0,1,0] vs [1,0,5]
    expect(byId.get("5RGTMSFGM")).toBe("loss"); // [0,0] vs [1,5]
    const draw = replay(1, "VGPTB9UCN");
    draw.player2_info.round_results = [1, 1, 0];
    draw.player1_info.round_results = [0, 1, 1];
    expect(resolveMatchPerspective(draw, CFN).result).toBe("draw");
  });

  it("19. back-to-back rematches against the same rival keep distinct ids", () => {
    const { matches } = matchesOf(replaysOf(1));
    const vsLuka = matches.filter((m) => m.opponent.name === "Lukanight");
    expect(vsLuka.map((m) => m.externalMatchId)).toEqual(["VGPTB9UCN", "XGSCNHR6N"]);
    // even if Capcom reported both in the same minute, identity is the replay_id, not the time
    const sameMinute = [replaysOf(1)[0], { ...replaysOf(1)[1], uploaded_at: 1790996001 - 20 }];
    expect(new Set(matchesOf(sameMinute).matches.map((m) => m.externalMatchId)).size).toBe(2);
  });

  it("20. duplicate replay_id is detected and kept once", () => {
    const first = replaysOf(1)[0];
    const r = matchesOf([first, structuredClone(first)]);
    expect(r.matches).toHaveLength(1);
    expect(r.warnings.join()).toContain("duplicate replay_id VGPTB9UCN");
  });

  it("21. unknown replay_battle_type → mode unknown + warning", () => {
    expect(mapReplayBattleType(1)).toEqual({ mode: "ranked", known: true });
    expect(mapReplayBattleType(4)).toEqual({ mode: "unknown", known: false });
    const r = matchesOf([
      { ...replaysOf(1)[0], replay_battle_type: 99, replay_battle_type_name: "???" },
    ]);
    expect(r.matches[0]?.mode).toBe("unknown");
    expect(r.warnings.join()).toContain("unknown replay_battle_type 99");
  });

  it("22. tracked CFN absent → explicit error and the replay is rejected", () => {
    expect(() => resolveMatchPerspective(replay(1, "VGPTB9UCN"), "999999999")).toThrowError(
      TrackedPlayerNotInReplayError,
    );
    const r = normalizeCapcomMatches(replaysOf(1).slice(0, 2), {
      trackedCfnId: "999999999",
      now: NOW,
    });
    expect(r.matches).toEqual([]);
    expect(r.rejected).toHaveLength(2);
    expect(r.warnings.join()).toContain("not in replay");
  });

  it("invalid character_tool_name rejects the replay instead of deriving a key", () => {
    const bad = structuredClone(replaysOf(1)[0]) as { player1_info: Record<string, unknown> };
    bad.player1_info.character_tool_name = "A.K.I.";
    const r = matchesOf([bad]);
    expect(r.matches).toEqual([]);
    expect(r.warnings.join()).toContain('invalid character_tool_name "A.K.I."');
  });

  it("ratingBefore = replay LP (evidence: the LP chain across 20 real replays)", () => {
    const { matches, details } = matchesOf([...replaysOf(1), ...replaysOf(2)]);
    expect(matches[0]?.ratingBefore).toEqual({
      system: "lp",
      value: 19633,
      rank: "Diamond 1",
      rankTier: "diamond-1",
      phase: null,
    });
    expect(matches.every((m) => m.ratingAfter === null)).toBe(true);
    // newest first: value(older) + result ⇒ value(newer)
    for (let i = 0; i + 1 < matches.length; i++) {
      const newer = matches[i]!;
      const older = matches[i + 1]!;
      if (!older.ratingBefore || !newer.ratingBefore) continue;
      const delta = ratingDelta(older.ratingBefore, newer.ratingBefore)!;
      if (older.result === "win") expect(delta).toBeGreaterThan(0);
      else expect(delta).toBeLessThan(0);
    }
    // newest replay (win, 19633) + gain = current profile LP 19704
    const aki = profileOf().profile.characters.find((c) => c.characterKey === "aki")!;
    expect(aki.leaguePoints! - matches[0]!.ratingBefore!.value).toBeGreaterThan(0);
    // pre-placement replay: league_point -1 → no ratingBefore, raw kept
    const placement = matches.find((m) => m.externalMatchId === "JUHDNH5FD");
    expect(placement?.ratingBefore).toBeNull();
    expect(
      details.find((d) => d.externalMatchId === "JUHDNH5FD")?.ratingAtMatchRaw.leaguePoint,
    ).toBe(-1);
  });

  it("Master replays get no ratingBefore (MR semantics not captured yet)", () => {
    const master = structuredClone(replaysOf(1)[0]) as { player1_info: Record<string, unknown> };
    Object.assign(master.player1_info, { master_league: 36, master_rating: 1500, league_rank: 36 });
    const r = matchesOf([master]);
    expect(r.matches[0]?.ratingBefore).toBeNull();
    expect(r.details[0]?.ratingAtMatchRaw.masterRating).toBe(1500);
  });

  it("battlelog envelope: page numbers and owner", () => {
    const page = parseCapcomBattlelogPayload({
      pageProps: { sid: 1, current_page: 1, total_page: 10, replay_list: [] },
    });
    expect(page).toEqual({ cfnUserId: "1", currentPage: 1, totalPage: 10, replays: [] });
    expect(() => parseCapcomBattlelogPayload({ pageProps: { sid: 1 } })).toThrowError(
      /battlelog payload/,
    );
  });

  it("league mapping table is evidence-only", () => {
    const li = {
      league_point: 1000,
      league_rank: 5,
      master_league: 0,
      master_rating: 0,
      master_rating_ranking: 0,
    };
    expect(mapLeagueInfo(li)).toMatchObject({ ratingSystem: "lp", rank: null, rankKnown: false });
    expect(mapLeagueInfo(li, new Map([[5, "Rookie 5"]]))).toMatchObject({
      rank: "Rookie 5",
      rankTier: "rookie-5",
    });
    expect(mapLeagueInfo({ ...li, master_league: 37, master_rating: 1700 })).toMatchObject({
      ratingSystem: "mr",
      masterRate: 1700,
      rank: null,
      rankKnown: false,
    });
  });
});
