/**
 * M2B — new-match detection: only genuine arrivals (stable ids + a growing engine count in the
 * same session) are events; hydration, duplicates, reconnects, reordering and session switches
 * are not.
 */
import { describe, expect, it } from "vitest";
import { detectArrival, seedArrivals, type ArrivalSnapshot } from "./motion";

const snap = (over: Partial<ArrivalSnapshot> & { ids: string[] }): ArrivalSnapshot => ({
  sessionId: "s1",
  totalGames: over.ids.length,
  wins: 0,
  losses: 0,
  ...over,
});

describe("detectArrival", () => {
  it("the first snapshot (page load, return to the dashboard, hydration) is the baseline", () => {
    const tracker = seedArrivals(snap({ ids: ["a", "b"], wins: 1, losses: 1 }));
    // The same snapshot again is not an event.
    expect(detectArrival(tracker, snap({ ids: ["a", "b"], wins: 1, losses: 1 })).arrival).toBe(
      null,
    );
  });

  it("one new match: its id, and the side whose engine count grew", () => {
    const t0 = seedArrivals(snap({ ids: ["a"], wins: 1 }));
    const { arrival, tracker } = detectArrival(t0, snap({ ids: ["a", "b"], wins: 1, losses: 1 }));
    expect(arrival).toEqual({ ids: ["b"], win: false, loss: true });
    // Seen from now on: the next identical snapshot (e.g. after an SSE reconnect) is quiet.
    expect(detectArrival(tracker, snap({ ids: ["a", "b"], wins: 1, losses: 1 })).arrival).toBe(
      null,
    );
  });

  it("duplicate snapshots and reconnect resyncs never re-announce", () => {
    let tracker = seedArrivals(snap({ ids: ["a"], wins: 1 }));
    const next = snap({ ids: ["a", "b"], wins: 2 });
    const first = detectArrival(tracker, next);
    expect(first.arrival?.ids).toEqual(["b"]);
    tracker = first.tracker;
    for (let i = 0; i < 3; i++) {
      const again = detectArrival(tracker, next);
      expect(again.arrival).toBe(null);
      tracker = again.tracker;
    }
  });

  it("a batch is ONE event carrying every new id (both sides when both grew)", () => {
    const t0 = seedArrivals(snap({ ids: ["a"], wins: 1 }));
    const { arrival } = detectArrival(t0, snap({ ids: ["a", "b", "c", "d"], wins: 2, losses: 2 }));
    expect(arrival).toEqual({ ids: ["b", "c", "d"], win: true, loss: true });
  });

  it("an out-of-order match (inserted before newer ones) is still new", () => {
    const t0 = seedArrivals(snap({ ids: ["a", "c"], wins: 2 }));
    const { arrival } = detectArrival(t0, snap({ ids: ["a", "b", "c"], wins: 2, losses: 1 }));
    expect(arrival?.ids).toEqual(["b"]);
  });

  it("reordered data with the same matches is not an event", () => {
    const t0 = seedArrivals(snap({ ids: ["a", "b", "c"], wins: 2, losses: 1 }));
    expect(detectArrival(t0, snap({ ids: ["c", "a", "b"], wins: 2, losses: 1 })).arrival).toBe(
      null,
    );
  });

  it("an array change alone is not a match: no count growth ⇒ no event", () => {
    // A sliding/corrected window brings an id this view never saw, but the engine added nothing.
    const t0 = seedArrivals(snap({ ids: ["b", "c"], totalGames: 12, wins: 6 }));
    const { arrival, tracker } = detectArrival(
      t0,
      snap({ ids: ["a", "b", "c"], totalGames: 12, wins: 6 }),
    );
    expect(arrival).toBe(null);
    expect(tracker.seen.has("a")).toBe(true);
  });

  it("never more new ids than games added (newest of the unseen ones)", () => {
    const t0 = seedArrivals(snap({ ids: ["c"], totalGames: 3, wins: 3 }));
    const { arrival } = detectArrival(
      t0,
      snap({ ids: ["a", "b", "c", "d"], totalGames: 4, wins: 4 }),
    );
    expect(arrival?.ids).toEqual(["d"]);
  });

  it("a growing count without ids (older payload) still accents the scoreboard side", () => {
    const t0 = seedArrivals(snap({ ids: [], totalGames: 1, wins: 1 }));
    expect(detectArrival(t0, snap({ ids: [], totalGames: 2, wins: 2 })).arrival).toEqual({
      ids: [],
      win: true,
      loss: false,
    });
  });

  it("a different session re-seeds the view (its matches are not arrivals)", () => {
    const t0 = seedArrivals(snap({ ids: ["a"], wins: 1 }));
    const { arrival, tracker } = detectArrival(
      t0,
      snap({ sessionId: "s2", ids: ["x", "y"], wins: 2 }),
    );
    expect(arrival).toBe(null);
    expect(tracker.sessionId).toBe("s2");
    expect(
      detectArrival(tracker, snap({ sessionId: "s2", ids: ["x", "y", "z"], wins: 3 })).arrival?.ids,
    ).toEqual(["z"]);
  });
});
