import { describe, expect, it, vi } from "vitest";
import type { NormalizedPlayerProfile, NormalizedSF6Match } from "@/domain/sf6/types";
import { SF6ProviderError, type SF6DataProvider } from "./provider";
import { ResilientProvider } from "./resilient";

const profile: NormalizedPlayerProfile = {
  cfnUserId: "1234567890",
  displayName: "Tester",
  favoriteCharacterKey: "ryu",
  characters: [
    {
      characterKey: "ryu",
      characterName: "Ryu",
      rank: "Master",
      rankTier: "master",
      ratingSystem: "mr",
      leaguePoints: 25000,
      masterRate: 1500,
    },
  ],
};

const goodMatch: NormalizedSF6Match = {
  externalMatchId: "m1",
  playedAt: new Date("2026-10-03T18:00:00Z"),
  mode: "ranked",
  result: "win",
  characterKey: "ryu",
  characterName: "Ryu",
  opponent: { name: "Opp", characterKey: "ken", characterName: "Ken" },
};

function fakeProvider(overrides: Partial<SF6DataProvider> = {}): SF6DataProvider {
  return {
    name: "fake",
    getPlayerProfile: vi.fn(async () => profile),
    getRecentMatches: vi.fn(async () => [goodMatch]),
    ...overrides,
  };
}

describe("ResilientProvider", () => {
  it("single-flight: concurrent identical calls share one upstream request", async () => {
    let resolve!: (m: NormalizedSF6Match[]) => void;
    const inner = fakeProvider({
      getRecentMatches: vi.fn(() => new Promise<NormalizedSF6Match[]>((r) => (resolve = r))),
    });
    const p = new ResilientProvider(inner, { timeoutMs: 1000, cacheTtlMs: 0 });
    const calls = [p.getRecentMatches("1"), p.getRecentMatches("1"), p.getRecentMatches("1")];
    resolve([goodMatch]);
    await Promise.all(calls);
    expect(inner.getRecentMatches).toHaveBeenCalledTimes(1);
  });

  it("caches profiles within the TTL but never caches match lists", async () => {
    const inner = fakeProvider();
    const p = new ResilientProvider(inner, { timeoutMs: 1000, cacheTtlMs: 60_000 });
    await p.getPlayerProfile("1");
    await p.getPlayerProfile("1");
    await p.getRecentMatches("1");
    await p.getRecentMatches("1");
    expect(inner.getPlayerProfile).toHaveBeenCalledTimes(1);
    expect(inner.getRecentMatches).toHaveBeenCalledTimes(2);
  });

  it("times out slow upstream calls with a typed error", async () => {
    const inner = fakeProvider({ getRecentMatches: () => new Promise(() => {}) });
    const p = new ResilientProvider(inner, { timeoutMs: 20, cacheTtlMs: 0 });
    await expect(p.getRecentMatches("1")).rejects.toMatchObject({ code: "timeout" });
  });

  it("wraps unknown errors as 'unavailable' and keeps typed errors", async () => {
    const boom = new ResilientProvider(
      fakeProvider({
        getRecentMatches: async () => {
          throw new Error("socket hang up");
        },
      }),
      { timeoutMs: 1000, cacheTtlMs: 0 },
    );
    await expect(boom.getRecentMatches("1")).rejects.toMatchObject({ code: "unavailable" });

    const notFound = new ResilientProvider(
      fakeProvider({
        getPlayerProfile: async () => {
          throw new SF6ProviderError("not_found", "nope");
        },
      }),
      { timeoutMs: 1000, cacheTtlMs: 0 },
    );
    const err = await notFound.getPlayerProfile("1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SF6ProviderError);
    expect((err as SF6ProviderError).retryable).toBe(false);
  });

  it("drops invalid matches instead of failing the whole batch", async () => {
    const broken = { ...goodMatch, externalMatchId: "", result: "victory" };
    const p = new ResilientProvider(
      fakeProvider({
        getRecentMatches: async () => [goodMatch, broken as unknown as NormalizedSF6Match],
      }),
      { timeoutMs: 1000, cacheTtlMs: 0 },
    );
    process.env.LOG_LEVEL = "error";
    const result = await p.getRecentMatches("1");
    expect(result.map((m) => m.externalMatchId)).toEqual(["m1"]);
  });

  it("rejects an invalid profile", async () => {
    const p = new ResilientProvider(
      fakeProvider({ getPlayerProfile: async () => ({ ...profile, displayName: "" }) }),
      { timeoutMs: 1000, cacheTtlMs: 0 },
    );
    await expect(p.getPlayerProfile("1")).rejects.toMatchObject({ code: "invalid_response" });
  });

  describe("profile observations (session rating consistency)", () => {
    const opts = (userId: string) => ({ scope: { userId } });
    it("a cached hit keeps its ORIGINAL observation time, never the time it is read", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-10-22T20:00:00.000Z"));
        const r = new ResilientProvider(fakeProvider(), { timeoutMs: 1_000, cacheTtlMs: 5_000 });
        const first = await r.getPlayerProfileObservation("1234567890", opts("u1"));
        vi.setSystemTime(new Date("2026-10-22T20:00:04.000Z"));
        const cached = await r.getPlayerProfileObservation("1234567890", opts("u1"));
        expect(cached.observedAt.toISOString()).toBe("2026-10-22T20:00:00.000Z");
        expect(cached.observedAt).toEqual(first.observedAt);
      } finally {
        vi.useRealTimers();
      }
    });
    it("uses the source's own observation time when the inner provider reports one", async () => {
      const at = new Date("2026-10-22T19:59:30.000Z");
      const inner = fakeProvider({
        getPlayerProfileObservation: vi.fn(async () => ({ profile, observedAt: at })),
      });
      const r = new ResilientProvider(inner, { timeoutMs: 1_000, cacheTtlMs: 5_000 });
      expect((await r.getPlayerProfileObservation("1234567890", opts("u1"))).observedAt).toBe(at);
      expect(await r.getPlayerProfile("1234567890", opts("u1"))).toEqual(profile); // same entry
      expect(inner.getPlayerProfileObservation).toHaveBeenCalledTimes(1);
      expect(inner.getPlayerProfile).not.toHaveBeenCalled();
    });
    it("invalidateProfile drops only that account's entry for that CFN", async () => {
      const inner = fakeProvider();
      const r = new ResilientProvider(inner, { timeoutMs: 1_000, cacheTtlMs: 60_000 });
      await r.getPlayerProfile("1234567890", opts("u1"));
      await r.getPlayerProfile("1234567890", opts("u2"));
      await r.getPlayerProfile("1111111111", opts("u1"));
      expect(inner.getPlayerProfile).toHaveBeenCalledTimes(3);
      r.invalidateProfile("1234567890", { userId: "u1" });
      await r.getPlayerProfile("1234567890", opts("u1")); // refetched
      await r.getPlayerProfile("1234567890", opts("u2")); // still cached
      await r.getPlayerProfile("1111111111", opts("u1")); // still cached
      expect(inner.getPlayerProfile).toHaveBeenCalledTimes(4);
    });
  });
});
