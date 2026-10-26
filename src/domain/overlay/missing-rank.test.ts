/**
 * Missing rank in completed sessions. Higher Master leagues have no evidence-backed Capcom label,
 * so their snapshots store `rank: null`; an ENDED session used to show «—» for a valid MR. Ended
 * sessions now show the tier of the point's own MR when (and only when) the stored rank is
 * missing — never Legend (no position for ended sessions), stored labels never rewritten, MR and
 * delta untouched. Built through the REAL engine + toLiveSessionState (the server's path).
 *
 * Fixture (anonymized from a reported case): A.K.I., session 1866 → 1903 MR (+37), ended, no
 * stored rank anywhere; the latest profile observation (same MR) is at leaderboard position 7465.
 */
import { describe, expect, it } from "vitest";
import type { SessionStatus } from "@/domain/session/engine";
import { resolveDisplayRank } from "@/domain/sf6/master-tier";
import { akiSession, lp, mr } from "./missing-rank.fixture";
import { toLiveSessionState, type CurrentLeaderboardPosition } from "./state";

const position = (value: number, pos: number | null) =>
  new Map<string, CurrentLeaderboardPosition>([["aki", { system: "mr", value, position: pos }]]);
const aki = (
  status: SessionStatus,
  opts: Parameters<typeof akiSession>[1] = {},
  positions = position(1903, 7465),
) =>
  toLiveSessionState(
    "s1",
    akiSession(status, opts),
    { characters: [], activeCharacterKey: null },
    positions,
  ).characters.find((c) => c.characterKey === "aki");

describe("ended session with missing stored ranks (reported case)", () => {
  it("shows the tier of its own final MR: 1903 ⇒ Ultimate Master (was «—»)", () => {
    const c = aki("ended");
    expect(c?.current?.rank).toBe("Ultimate Master");
    expect(c?.initial?.rank).toBe("Ultimate Master"); // 1866 is Ultimate too
  });
  it("MR and session delta are unchanged", () => {
    const c = aki("ended");
    expect(c?.current).toMatchObject({ system: "mr", value: 1903 });
    expect(c?.initial).toMatchObject({ system: "mr", value: 1866 });
    expect(c?.delta).toBe(37);
  });
  it("ended sessions still carry no leaderboard position (public payload unchanged)", () => {
    expect(aki("ended")?.leaderboardPosition).toBeNull();
  });
  it("each point uses its OWN MR (initial below 1800 ⇒ Grand Master, final ⇒ Ultimate)", () => {
    const c = aki("ended", { initial: mr(1766) });
    expect(c?.initial?.rank).toBe("Grand Master");
    expect(c?.current?.rank).toBe("Ultimate Master");
  });
});

describe("active session with missing stored rank (existing derivation, unchanged)", () => {
  it("1903 MR ⇒ Ultimate Master; a non-Legend position changes nothing", () => {
    const c = aki("active");
    expect(c?.current?.rank).toBe("Ultimate Master");
    expect(c?.leaderboardPosition).toBe(7465);
  });
  it("a confirmed top-500 position of the SAME observation ⇒ Legend (existing rule)", () => {
    expect(aki("active", {}, position(1903, 120))?.current?.rank).toBe("Legend");
  });
  it("a position of a DIFFERENT observation (other MR) never applies", () => {
    expect(aki("active", {}, position(1890, 120))?.current?.rank).toBe("Ultimate Master");
  });
});

describe("Legend is never inferred", () => {
  it("ended: even a top-500 position of the same MR does not relabel a finished session", () => {
    const c = aki("ended", {}, position(1903, 120));
    expect(c?.current?.rank).toBe("Ultimate Master");
    expect(c?.leaderboardPosition).toBeNull();
  });
  it.each([null, 0, -1, 501, 7465, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "invalid / non-Legend position %s ⇒ never Legend (active or ended)",
    (pos) => {
      expect(aki("active", {}, position(1903, pos))?.current?.rank).toBe("Ultimate Master");
      expect(aki("ended", {}, position(1903, pos))?.current?.rank).toBe("Ultimate Master");
    },
  );
  it("a very high MR alone is Ultimate Master, not Legend", () => {
    expect(aki("ended", { final: mr(2400) }, new Map())?.current?.rank).toBe("Ultimate Master");
  });
});

describe("stored ranks stay authoritative for history", () => {
  it("an explicitly stored historical label is never rewritten (ended)", () => {
    const c = aki("ended", { initial: mr(1866, "Master"), final: mr(1903, "Master") });
    expect(c?.initial?.rank).toBe("Master");
    expect(c?.current?.rank).toBe("Master");
  });
  it("a stored label on one point, missing on the other: only the missing one is filled", () => {
    const c = aki("ended", { initial: mr(1866, "Master"), final: mr(1903) });
    expect(c?.initial?.rank).toBe("Master");
    expect(c?.current?.rank).toBe("Ultimate Master");
  });
});

describe("insufficient data keeps the existing fallback", () => {
  it("no rating at all ⇒ no rank (the overlay shows «—»)", () => {
    const c = aki("ended", { initial: null, final: null });
    expect(c?.current ?? null).toBeNull();
    expect(c?.initial ?? null).toBeNull();
  });
  it("MR 0 (Capcom's «no MR yet») ⇒ no rank", () => {
    expect(aki("ended", { initial: mr(0), final: mr(0) })?.current?.rank).toBeNull();
  });
  it("LP with a missing label is not filled (only MR has a documented mapping)", () => {
    const c = aki("ended", { initial: lp(19_000), final: lp(19_500) }, new Map());
    expect(c?.current?.rank).toBeNull();
    expect(c?.current?.value).toBe(19_500);
  });
});

describe("resolveDisplayRank", () => {
  const p = (value: number, rank: string | null = null) => ({ system: "mr" as const, value, rank });
  it("frozen (derive: false) without fillMissing is unchanged: stored label or null", () => {
    expect(resolveDisplayRank(p(1903), { derive: false })).toBeNull();
    expect(resolveDisplayRank(p(1903, "Master"), { derive: false })).toBe("Master");
  });
  it("fillMissing fills only a missing label, through the shared thresholds", () => {
    expect(resolveDisplayRank(p(1903), { derive: false, fillMissing: true })).toBe(
      "Ultimate Master",
    );
    expect(resolveDisplayRank(p(1599), { derive: false, fillMissing: true })).toBe("Master");
    expect(resolveDisplayRank(p(1903, "Master"), { derive: false, fillMissing: true })).toBe(
      "Master",
    );
    expect(resolveDisplayRank(p(0), { derive: false, fillMissing: true })).toBeNull();
  });
  it("derive (current presentation) is unchanged", () => {
    expect(resolveDisplayRank(p(1903, "Master"), { derive: true })).toBe("Ultimate Master");
    expect(resolveDisplayRank(p(1903), { derive: true, leaderboardPosition: 500 })).toBe("Legend");
    expect(resolveDisplayRank(p(1903), { derive: true, leaderboardPosition: 501 })).toBe(
      "Ultimate Master",
    );
  });
});
