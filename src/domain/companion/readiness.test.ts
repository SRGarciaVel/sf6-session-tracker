import { describe, expect, it } from "vitest";
import { assessCompanion, COMPANION_QUIET_AFTER_MS, type CompanionSignals } from "./readiness";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const ready: CompanionSignals = {
  required: true,
  deviceCount: 1,
  lastSeenAt: ago(20_000),
  profileObservedAt: ago(40_000),
  matchesObservedAt: ago(30_000),
  hasProfile: true,
  characterCount: 3,
  maxAgeMs: 300_000,
  serverTime: new Date(NOW).toISOString(),
};

describe("assessCompanion", () => {
  it("everything fresh ⇒ ready, no next step", () => {
    expect(assessCompanion(ready, NOW)).toEqual({
      required: true,
      companion: "connected",
      buckler: "fresh",
      profile: "fresh",
      characterDetected: true,
      canStart: true,
      nextStep: null,
    });
  });

  it("not in companion mode ⇒ nothing required, start allowed", () => {
    const r = assessCompanion(
      { ...ready, required: false, deviceCount: 0, lastSeenAt: null, hasProfile: false },
      NOW,
    );
    expect(r.canStart).toBe(true);
    expect(r.nextStep).toBeNull();
  });

  it("never paired ⇒ pair first", () => {
    const r = assessCompanion(
      {
        ...ready,
        deviceCount: 0,
        lastSeenAt: null,
        profileObservedAt: null,
        matchesObservedAt: null,
        hasProfile: false,
        characterCount: 0,
      },
      NOW,
    );
    expect(r).toMatchObject({
      companion: "notPaired",
      buckler: "never",
      profile: "never",
      canStart: false,
      nextStep: "pairCompanion",
    });
  });

  it("paired but silent for too long ⇒ open the companion's browser", () => {
    const r = assessCompanion(
      {
        ...ready,
        lastSeenAt: ago(COMPANION_QUIET_AFTER_MS + 1),
        matchesObservedAt: ago(600_000),
        profileObservedAt: ago(600_000),
      },
      NOW,
    );
    expect(r).toMatchObject({
      companion: "quiet",
      canStart: false,
      nextStep: "openCompanionBrowser",
    });
  });

  it("companion alive but never sent Buckler data ⇒ log in to Buckler", () => {
    const r = assessCompanion(
      { ...ready, profileObservedAt: null, matchesObservedAt: null, hasProfile: false },
      NOW,
    );
    expect(r).toMatchObject({ companion: "connected", buckler: "never", nextStep: "loginBuckler" });
    expect(r.canStart).toBe(false);
  });

  it("companion alive with old data ⇒ sync now; boundary follows the server window", () => {
    const stale = assessCompanion({ ...ready, matchesObservedAt: ago(300_001) }, NOW);
    expect(stale).toMatchObject({ buckler: "stale", canStart: false, nextStep: "syncNow" });
    const edge = assessCompanion({ ...ready, matchesObservedAt: ago(300_000) }, NOW);
    expect(edge.canStart).toBe(true);
  });

  it("a quiet companion with still-fresh data can start (data is what the server checks)", () => {
    const r = assessCompanion({ ...ready, lastSeenAt: ago(COMPANION_QUIET_AFTER_MS + 1) }, NOW);
    expect(r).toMatchObject({ companion: "quiet", canStart: true, nextStep: null });
  });

  it("no characters is informative only", () => {
    const r = assessCompanion({ ...ready, characterCount: 0 }, NOW);
    expect(r).toMatchObject({ characterDetected: false, canStart: true });
  });
});
