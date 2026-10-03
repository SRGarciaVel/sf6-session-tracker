import { describe, expect, it } from "vitest";
import { checkProviderOutput } from "./contract-check";

const NOW = new Date("2026-10-03T20:00:00Z");
const profile = {
  cfnUserId: "1733837998",
  displayName: "TDF | Tester",
  favoriteCharacterKey: "aki",
  characters: [
    {
      characterKey: "aki",
      characterName: "A.K.I.",
      rank: "Diamond 2",
      rankTier: "diamond-2",
      ratingSystem: "lp",
      leaguePoints: 19704,
      masterRate: null,
    },
    {
      characterKey: "kimberly",
      characterName: "Kimberly",
      rank: "Master",
      rankTier: "master",
      ratingSystem: "mr",
      leaguePoints: 25000,
      masterRate: 1479,
    },
  ],
};
const m = (id: string, minutesAgo: number, extra: Record<string, unknown> = {}) => ({
  externalMatchId: id,
  playedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
  mode: "ranked",
  result: "win",
  characterKey: "aki",
  characterName: "A.K.I.",
  opponent: { name: "Opp", characterKey: "ken", characterName: "Ken" },
  ratingBefore: { system: "lp", value: 19600 },
  ratingAfter: { system: "lp", value: 19704 },
  ...extra,
});
const levels = (r: ReturnType<typeof checkProviderOutput>, level: string) =>
  r.findings.filter((f) => f.level === level).map((f) => f.message);

describe("checkProviderOutput", () => {
  it("valid contract passes with no warnings", () => {
    const r = checkProviderOutput({
      cfnUserId: "1733837998",
      profile,
      matches: [m("a", 1), m("b", 5)],
      now: NOW,
    });
    expect(r.ok).toBe(true);
    expect(levels(r, "ERROR")).toEqual([]);
    expect(levels(r, "WARNING")).toEqual([]);
    expect(r.order).toBe("newest-first");
    expect(levels(r, "PASS").join("|")).toContain("2 characters");
  });

  it("ERROR: match without characterKey, cfnUserId mismatch, invalid ratingSystem", () => {
    const { characterKey: _omit, ...noKey } = m("x", 1);
    void _omit;
    const r = checkProviderOutput({
      cfnUserId: "1111111111",
      profile: { ...profile, characters: [{ ...profile.characters[0], ratingSystem: "xp" }] },
      matches: [noKey],
      now: NOW,
    });
    expect(r.ok).toBe(false);
    const errors = levels(r, "ERROR").join("\n");
    expect(errors).toContain("profile does not match the contract");
    expect(errors).toContain("characterKey missing");
  });

  it("WARNINGs: duplicate keys/ids, incoherent MR+LP, future time, unknown mode, char not in profile", () => {
    const r = checkProviderOutput({
      cfnUserId: "1733837998",
      profile: {
        ...profile,
        characters: [
          ...profile.characters,
          profile.characters[0],
          { ...profile.characters[1], characterKey: "cammy", ratingSystem: "lp", masterRate: 1500 },
        ],
      },
      matches: [
        m("dup", 1),
        m("dup", 2),
        m("future", -30),
        m("u", 3, { mode: "unknown" }),
        m("s", 4, { characterKey: "sagat", characterName: "Sagat" }),
      ],
      now: NOW,
    });
    expect(r.ok).toBe(true); // warnings never fail the check
    const w = levels(r, "WARNING").join("\n");
    expect(w).toContain('duplicate characterKey "aki"');
    expect(w).toContain("MR and LP both active");
    expect(w).toContain("duplicate externalMatchId dup");
    expect(w).toContain("playedAt in the future");
    expect(w).toContain('mode "unknown"');
    expect(w).toContain(
      'characterKey "sagat" used in 1 ranked match(es) but not in profile.characters',
    );
    expect(w).toContain("not in chronological order");
  });
});
