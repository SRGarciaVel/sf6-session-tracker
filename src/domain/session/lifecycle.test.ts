import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIFECYCLE_POLICY,
  PRESENCE_MAX_AGE_MS,
  SESSION_ABSOLUTE_CEILING_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_OFFLINE_CLOSE_MS,
  SESSION_OFFLINE_MIN_OBSERVATIONS,
  OBSERVATION_MAX_GAP_MS,
  advanceObservationRun,
  advancePresenceTrack,
  evaluateSessionLifecycle,
  lastActivityAt,
  parseObservationRun,
  parsePresenceTrack,
  presenceHoldsSession,
  type ObservationRun,
  type PresenceTrack,
  type SessionLifecycleInput,
} from "./lifecycle";

const T0 = new Date("2026-10-14T18:00:00.000Z");
const min = (m: number) => new Date(T0.getTime() + m * 60_000);
const sec = (s: number) => new Date(T0.getTime() + s * 1000);
const CODE = { offline: 1, menu: 2, practice: 8, ranked: 11 } as const;

/** Observations every `everySec` seconds from `fromMin` to `toMin` (inclusive) of one code. */
function observe(
  prev: PresenceTrack | null,
  code: number | null,
  fromMin: number,
  toMin: number,
  everySec = 30,
): PresenceTrack | null {
  let track = prev;
  for (let s = fromMin * 60; s <= toMin * 60; s += everySec) {
    track = advancePresenceTrack(track, { code, observedAt: sec(s) }, PRESENCE_MAX_AGE_MS);
  }
  return track;
}

/** A continuous observation run from minute `from` to minute `to`. */
const watched = (from: number, to: number): ObservationRun => ({
  since: min(from).toISOString(),
  observedAt: min(to).toISOString(),
  observations: Math.max(1, Math.round((to - from) * 2) + 1),
});

/** Observation-run fold over syncs every `everySec` seconds in [fromMin, toMin]. */
function syncRun(prev: ObservationRun | null, fromMin: number, toMin: number, everySec = 30) {
  let run = prev;
  for (let s = fromMin * 60; s <= toMin * 60; s += everySec) {
    run = advanceObservationRun(run, sec(s), OBSERVATION_MAX_GAP_MS);
  }
  return run;
}

const input = (over: Partial<SessionLifecycleInput> & { now: Date }): SessionLifecycleInput => ({
  startedAt: T0,
  lastSessionMatchAt: null,
  filterModes: ["ranked"],
  // Default: SST has been observing continuously since the session started.
  observation: { since: T0.toISOString(), observedAt: over.now.toISOString(), observations: 100 },
  presence: null,
  ...over,
});
const decide = (over: Partial<SessionLifecycleInput> & { now: Date }) =>
  evaluateSessionLifecycle(input(over));

describe("constants (approved policy)", () => {
  it("45 min normal idle · 15 min Offline (≥ 3 observations) · 12 h ceiling · 5 min freshness", () => {
    expect(SESSION_IDLE_TIMEOUT_MS).toBe(45 * 60_000);
    expect(SESSION_OFFLINE_CLOSE_MS).toBe(15 * 60_000);
    expect(SESSION_OFFLINE_MIN_OBSERVATIONS).toBe(3);
    expect(SESSION_ABSOLUTE_CEILING_MS).toBe(12 * 3_600_000);
    expect(PRESENCE_MAX_AGE_MS).toBe(5 * 60_000);
    expect(DEFAULT_LIFECYCLE_POLICY).toEqual({
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
      offlineCloseMs: SESSION_OFFLINE_CLOSE_MS,
      offlineMinObservations: 3,
      absoluteCeilingMs: SESSION_ABSOLUTE_CEILING_MS,
      presenceMaxAgeMs: PRESENCE_MAX_AGE_MS,
      observationMaxGapMs: OBSERVATION_MAX_GAP_MS,
    });
    expect(OBSERVATION_MAX_GAP_MS).toBe(5 * 60_000);
  });
});

describe("lastActivityAt — session matches only, played_at clamped", () => {
  it("max(started_at, latest assigned match); no match ⇒ started_at", () => {
    expect(lastActivityAt({ now: min(60), startedAt: T0, lastSessionMatchAt: null })).toEqual(T0);
    expect(lastActivityAt({ now: min(60), startedAt: T0, lastSessionMatchAt: min(20) })).toEqual(
      min(20),
    );
  });
  it("a future played_at is clamped to now; a pre-start one never moves it back", () => {
    expect(lastActivityAt({ now: min(60), startedAt: T0, lastSessionMatchAt: min(90) })).toEqual(
      min(60),
    );
    expect(lastActivityAt({ now: min(60), startedAt: T0, lastSessionMatchAt: min(-5) })).toEqual(
      T0,
    );
  });
});

describe("normal observed inactivity (45 min)", () => {
  it("1. regular matches never close the session", () => {
    for (let m = 3; m <= 600; m += 3) {
      expect(decide({ now: min(m), lastSessionMatchAt: min(m - 3) }).action).toBe("keep");
    }
  });

  it("2. 44:59 observed idle → active; 3. 45:00 → end (normal-idle)", () => {
    const last = min(10);
    const at = (s: number) => new Date(last.getTime() + s * 1000);
    expect(decide({ now: at(45 * 60 - 1), lastSessionMatchAt: last })).toMatchObject({
      action: "keep",
      reason: "awaiting-timeout",
    });
    expect(decide({ now: at(45 * 60), lastSessionMatchAt: last })).toMatchObject({
      action: "end",
      policy: "normal-idle",
      idleMs: 45 * 60_000,
    });
  });

  it("3. Menu at 45 min does not hold the session (neither holds nor accelerates)", () => {
    const presence = observe(null, CODE.menu, 0, 45);
    expect(decide({ now: min(45), presence })).toMatchObject({
      action: "end",
      policy: "normal-idle",
      presenceState: "menu",
    });
    expect(decide({ now: min(44), presence: observe(null, CODE.menu, 0, 44) }).action).toBe("keep");
  });

  it("14. zero-match session counts from started_at", () => {
    expect(decide({ now: min(44) }).action).toBe("keep");
    expect(decide({ now: min(45) })).toMatchObject({ action: "end", policy: "normal-idle" });
  });

  it("requires OBSERVATION: idle 45 min but SST stopped observing at 30 min → keep", () => {
    expect(decide({ now: min(50), observation: watched(0, 30) })).toMatchObject({
      action: "keep",
      reason: "not-observed",
    });
    expect(decide({ now: min(50), observation: null })).toMatchObject({
      action: "keep",
      reason: "not-observed",
    });
  });

  it("an observation covering the 45 min is enough even if it is not current", () => {
    expect(decide({ now: min(70), observation: watched(0, 46) })).toMatchObject({
      action: "end",
      policy: "normal-idle",
    });
  });

  it("10. unknown presence (future code / absent) with valid observation → normal close", () => {
    expect(decide({ now: min(45), presence: observe(null, 99, 0, 45) })).toMatchObject({
      action: "end",
      policy: "normal-idle",
      presenceState: "unknown",
    });
    expect(decide({ now: min(45), presence: observe(null, null, 0, 45) }).action).toBe("end");
  });
});

describe("playing presence holds the session (Practice, Ranked Match)", () => {
  it("4. fresh Practice at 45+ min → active (any filter)", () => {
    const presence = observe(null, CODE.practice, 0, 120);
    expect(decide({ now: min(120), presence })).toMatchObject({
      action: "keep",
      reason: "presence-playing",
      presenceState: "practice",
    });
    expect(decide({ now: min(120), presence, filterModes: ["casual"] }).action).toBe("keep");
  });

  it("5. fresh Ranked Match at 45+ min → active for a ranked session", () => {
    const presence = observe(null, CODE.ranked, 0, 120);
    expect(decide({ now: min(120), presence })).toMatchObject({
      action: "keep",
      reason: "presence-playing",
    });
  });

  it("25. Ranked Match does not hold a session whose filter does not count ranked", () => {
    expect(presenceHoldsSession("ranked-match", ["ranked"])).toBe(true);
    expect(presenceHoldsSession("ranked-match", ["casual"])).toBe(false);
    expect(presenceHoldsSession("practice", [])).toBe(true);
    expect(presenceHoldsSession("menu", ["ranked"])).toBe(false);
    expect(presenceHoldsSession("offline", ["ranked"])).toBe(false);
    expect(presenceHoldsSession("unknown", ["ranked"])).toBe(false);
  });

  it("presence never moves lastActivityAt (diagnostics keep the match-based idle)", () => {
    const d = decide({
      now: min(120),
      lastSessionMatchAt: min(5),
      presence: observe(null, CODE.ranked, 0, 120),
    });
    expect(d.lastActivityAt).toEqual(min(5));
    expect(d.idleMs).toBe(115 * 60_000);
  });

  it("leaving a long Practice block for the Menu does not close the session at once", () => {
    let presence = observe(null, CODE.practice, 0, 120); // 2 h of Practice, no match
    presence = observe(presence, CODE.menu, 121, 125);
    expect(decide({ now: min(125), presence })).toMatchObject({
      action: "keep",
      reason: "awaiting-timeout",
      presenceState: "menu",
    });
    // 45 min after the last Practice observation, still in Menu → normal close.
    presence = observe(presence, CODE.menu, 126, 165);
    expect(decide({ now: min(165), presence })).toMatchObject({
      action: "end",
      policy: "normal-idle",
    });
  });

  it("11. stale Practice does not protect: with observation it closes 45 min after it was last seen", () => {
    const presence = observe(null, CODE.practice, 0, 60); // Companion stops reporting presence
    expect(decide({ now: min(64), presence }).action).toBe("keep"); // still fresh (< 5 min)
    // Matches keep being observed (old Companion / presence missing), presence goes stale.
    expect(decide({ now: min(70), presence, observation: watched(0, 70) })).toMatchObject({
      action: "keep",
      reason: "awaiting-timeout",
      presenceState: "unknown",
    });
    expect(decide({ now: min(105), presence, observation: watched(0, 105) })).toMatchObject({
      action: "end",
      policy: "normal-idle",
      presenceState: "unknown",
    });
  });

  it("12. stale Ranked Match: same rule, and without observation only the ceiling remains", () => {
    const presence = observe(null, CODE.ranked, 0, 30);
    expect(decide({ now: min(80), presence, observation: watched(0, 80) })).toMatchObject({
      action: "end",
      policy: "normal-idle",
    });
    expect(decide({ now: min(300), presence, observation: watched(0, 30) })).toMatchObject({
      action: "keep",
      reason: "not-observed",
    });
  });
});

describe("accelerated Offline close (≥ 15 min continuous, ≥ 3 observations)", () => {
  it("6. fresh Offline but < 15 min → active", () => {
    const presence = observe(null, CODE.offline, 20, 34);
    expect(decide({ now: min(34), lastSessionMatchAt: min(19), presence })).toMatchObject({
      action: "keep",
      presenceState: "offline",
    });
  });

  it("8. Offline ≥ 15 min with ≥ 3 observations → end (before the 45 min)", () => {
    const presence = observe(null, CODE.offline, 20, 35);
    expect(decide({ now: min(35), lastSessionMatchAt: min(19), presence })).toMatchObject({
      action: "end",
      policy: "offline",
      presenceState: "offline",
    });
  });

  it("7. Offline ≥ 15 min but < 3 observations → active", () => {
    // Two observations 5 min apart can't span 15 min within the freshness window: build the
    // edge case directly (a stored track that claims a long run with few samples).
    const presence: PresenceTrack = {
      state: "offline",
      code: 1,
      since: min(20).toISOString(),
      observedAt: min(36).toISOString(),
      observations: 2,
      lastPlayingAt: null,
    };
    expect(decide({ now: min(36), lastSessionMatchAt: min(19), presence }).action).toBe("keep");
    expect(
      decide({
        now: min(36),
        lastSessionMatchAt: min(19),
        presence: { ...presence, observations: 3 },
      }).action,
    ).toBe("end");
  });

  it("9. Offline interrupted by Menu resets the Offline window", () => {
    let presence = observe(null, CODE.offline, 20, 30);
    presence = observe(presence, CODE.menu, 30.5, 31);
    presence = observe(presence, CODE.offline, 31.5, 40);
    expect(presence?.since).toBe(sec(31.5 * 60).toISOString());
    expect(decide({ now: min(40), lastSessionMatchAt: min(19), presence }).action).toBe("keep");
    presence = observe(presence, CODE.offline, 40.5, 46.5);
    expect(decide({ now: min(46.5), lastSessionMatchAt: min(19), presence })).toMatchObject({
      action: "end",
      policy: "offline",
    });
  });

  it("a gap in observation (> freshness window) breaks continuity", () => {
    let presence = observe(null, CODE.offline, 20, 25);
    presence = observe(presence, CODE.offline, 31, 36); // 6 min without any observation
    expect(presence?.since).toBe(min(31).toISOString());
    expect(decide({ now: min(36), lastSessionMatchAt: min(19), presence }).action).toBe("keep");
  });

  it("the Offline run must start after the last session match", () => {
    const presence = observe(null, CODE.offline, 0, 20);
    // A (late-ingested) match played during the Offline run: no acceleration.
    expect(decide({ now: min(20), lastSessionMatchAt: min(5), presence }).action).toBe("keep");
  });

  it("stale Offline never accelerates", () => {
    const presence = observe(null, CODE.offline, 20, 35);
    expect(
      decide({ now: min(41), lastSessionMatchAt: min(19), presence, observation: watched(0, 35) })
        .action,
    ).toBe("keep");
  });
});

describe("13. absolute ceiling (12 h) — regardless of presence or observation", () => {
  it("closes at 12 h even with fresh Practice / Ranked or no observation", () => {
    const now = new Date(T0.getTime() + SESSION_ABSOLUTE_CEILING_MS);
    for (const presence of [
      observe(null, CODE.practice, 715, 720),
      observe(null, CODE.ranked, 715, 720),
    ]) {
      expect(decide({ now, presence })).toMatchObject({
        action: "end",
        policy: "absolute-ceiling",
      });
    }
    expect(decide({ now, observation: null })).toMatchObject({
      action: "end",
      policy: "absolute-ceiling",
    });
    expect(decide({ now: new Date(now.getTime() - 1), observation: null }).action).toBe("keep");
  });

  it("counted from the last session match", () => {
    expect(
      decide({ now: min(12 * 60 + 30), lastSessionMatchAt: min(31), observation: null }).action,
    ).toBe("keep");
  });
});

describe("advancePresenceTrack / parsePresenceTrack", () => {
  it("same state within the window continues the run; a new state starts one", () => {
    let t = advancePresenceTrack(null, { code: 2, observedAt: min(0) }, PRESENCE_MAX_AGE_MS);
    t = advancePresenceTrack(t, { code: 2, observedAt: min(1) }, PRESENCE_MAX_AGE_MS);
    expect(t).toMatchObject({ state: "menu", since: min(0).toISOString(), observations: 2 });
    t = advancePresenceTrack(t, { code: 8, observedAt: min(2) }, PRESENCE_MAX_AGE_MS);
    expect(t).toMatchObject({
      state: "practice",
      since: min(2).toISOString(),
      observations: 1,
      lastPlayingAt: min(2).toISOString(),
    });
    t = advancePresenceTrack(t, { code: 1, observedAt: min(3) }, PRESENCE_MAX_AGE_MS);
    expect(t.lastPlayingAt).toBe(min(2).toISOString()); // survives the change
  });

  it("24. unknown future codes are their own run (they break Offline continuity)", () => {
    let t = observe(null, CODE.offline, 0, 10);
    t = observe(t, 42, 10.5, 10.5);
    expect(t).toMatchObject({ state: "unknown", code: 42, observations: 1 });
  });

  it("out-of-order observations are ignored", () => {
    const t = observe(null, CODE.menu, 0, 2);
    expect(advancePresenceTrack(t, { code: 1, observedAt: min(1) }, PRESENCE_MAX_AGE_MS)).toBe(t);
  });

  it("round-trips through JSON; malformed stored data ⇒ null; state re-derived from code", () => {
    const t = observe(null, CODE.ranked, 0, 3);
    expect(parsePresenceTrack(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(parsePresenceTrack({ ...t, state: "practice" })?.state).toBe("ranked-match");
    for (const bad of [
      null,
      "x",
      {},
      { ...t, since: "nope" },
      { ...t, observations: 0 },
      { ...t, code: "11" },
      { ...t, lastPlayingAt: 5 },
    ]) {
      expect(parsePresenceTrack(bad)).toBeNull();
    }
  });
});

describe("continuous observation (normal idle needs 45 min inside ONE observation run)", () => {
  // Session match at 0; observed until 5; Companion gone for 2 h; back at 125.
  const reconnect = (backUntil: number) => syncRun(syncRun(null, 0, 5), 125, backUntil);

  it("8. a gap > 5 min restarts the run; 9. polling-cadence gaps (30 s, 120 s, 4:59) do not", () => {
    const run = reconnect(125);
    expect(run).toMatchObject({ since: min(125).toISOString(), observations: 1 });
    expect(syncRun(null, 0, 60, 30)?.since).toBe(T0.toISOString());
    expect(syncRun(null, 0, 60, 120)?.since).toBe(T0.toISOString());
    expect(syncRun(null, 0, 60, 299)?.since).toBe(T0.toISOString());
    expect(syncRun(null, 0, 60, 301)?.observations).toBe(1);
    // Exactly the window continues; out-of-order observations are ignored.
    const a = advanceObservationRun(null, min(0), OBSERVATION_MAX_GAP_MS);
    const b = advanceObservationRun(a, min(5), OBSERVATION_MAX_GAP_MS);
    expect(b).toMatchObject({ since: min(0).toISOString(), observations: 2 });
    expect(advanceObservationRun(b, min(1), OBSERVATION_MAX_GAP_MS)).toBe(b);
  });

  it("1. back after 2 h unobserved, one fresh Menu sync → MUST stay active", () => {
    const presence = observe(observe(null, CODE.menu, 0, 5), CODE.menu, 125, 125);
    expect(
      decide({ now: min(125), lastSessionMatchAt: T0, observation: reconnect(125), presence }),
    ).toMatchObject({ action: "keep", reason: "awaiting-timeout", presenceState: "menu" });
  });

  it("2. continuous observation 125 → 169 → active; 3. at 170 (45 min observed) → normal close", () => {
    let presence = observe(null, CODE.menu, 0, 5);
    presence = observe(presence, CODE.menu, 125, 169);
    expect(
      decide({ now: min(169), lastSessionMatchAt: T0, observation: reconnect(169), presence })
        .action,
    ).toBe("keep");
    presence = observe(presence, CODE.menu, 169.5, 170);
    expect(
      decide({ now: min(170), lastSessionMatchAt: T0, observation: reconnect(170), presence }),
    ).toMatchObject({ action: "end", policy: "normal-idle" });
  });

  it("4. back after a long gap directly in Practice → active; 5. Practice → Menu starts the 45 min", () => {
    let presence = observe(null, CODE.menu, 0, 5);
    presence = observe(presence, CODE.practice, 125, 200);
    const at200 = reconnect(200);
    expect(
      decide({ now: min(200), lastSessionMatchAt: T0, observation: at200, presence }),
    ).toMatchObject({ action: "keep", reason: "presence-playing" });
    presence = observe(presence, CODE.menu, 200.5, 244);
    expect(
      decide({ now: min(244), lastSessionMatchAt: T0, observation: reconnect(244), presence })
        .action,
    ).toBe("keep");
    presence = observe(presence, CODE.menu, 244.5, 245);
    expect(
      decide({ now: min(245), lastSessionMatchAt: T0, observation: reconnect(245), presence }),
    ).toMatchObject({ action: "end", policy: "normal-idle" });
  });

  it("6/7. old Companion (no presence): first sync after 2 h does not close; 45 min later it does", () => {
    expect(
      decide({ now: min(125), lastSessionMatchAt: min(3), observation: reconnect(125) }).action,
    ).toBe("keep");
    expect(
      decide({ now: min(169), lastSessionMatchAt: min(3), observation: reconnect(169) }).action,
    ).toBe("keep");
    expect(
      decide({ now: min(170), lastSessionMatchAt: min(3), observation: reconnect(170) }),
    ).toMatchObject({ action: "end", policy: "normal-idle", presenceState: "unknown" });
  });

  it("observation alone never accelerates: a fresh run still waits 45 min after activity", () => {
    expect(
      decide({ now: min(40), lastSessionMatchAt: T0, observation: syncRun(null, 30, 40) }).action,
    ).toBe("keep");
  });

  it("11. the 12 h ceiling closes with no continuous observation at all", () => {
    const now = new Date(T0.getTime() + SESSION_ABSOLUTE_CEILING_MS);
    for (const observation of [null, syncRun(null, 715, 720)]) {
      expect(decide({ now, observation })).toMatchObject({
        action: "end",
        policy: "absolute-ceiling",
      });
    }
  });

  it("12. Offline continuity is unchanged and independent of the observation run", () => {
    // A fresh observation run (Companion just came back) does not block a proven Offline run…
    const presence = observe(null, CODE.offline, 20, 35);
    expect(
      decide({
        now: min(35),
        lastSessionMatchAt: min(19),
        observation: syncRun(null, 34, 35),
        presence,
      }),
    ).toMatchObject({ action: "end", policy: "offline" });
    // …and the Offline rule still needs its own 15 min.
    expect(
      decide({
        now: min(34),
        lastSessionMatchAt: min(19),
        presence: observe(null, CODE.offline, 20, 34),
      }).action,
    ).toBe("keep");
  });

  it("parseObservationRun: round-trip; malformed ⇒ null", () => {
    const run = syncRun(null, 0, 3);
    expect(parseObservationRun(JSON.parse(JSON.stringify(run)))).toEqual(run);
    for (const bad of [
      null,
      "x",
      {},
      { ...run, since: "nope" },
      { ...run, observations: 0 },
      { ...run, observations: 1.5 },
      { ...run, since: min(10).toISOString(), observedAt: min(5).toISOString() },
    ]) {
      expect(parseObservationRun(bad)).toBeNull();
    }
  });
});
