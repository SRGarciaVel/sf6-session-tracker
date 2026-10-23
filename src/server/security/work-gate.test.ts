import { describe, expect, it } from "vitest";
import { createWorkGate } from "./work-gate";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}
const gate = (c = clock(), over = {}) =>
  createWorkGate({
    maxInFlight: 2,
    maxPerWindow: 3,
    windowMs: 60_000,
    busyRetrySeconds: 5,
    now: c.now,
    ...over,
  });

describe("work gate (bounded admission)", () => {
  it("admits ordinary work and frees the slot on release", () => {
    const g = gate();
    const a = g.tryEnter("u1");
    expect(a.ok).toBe(true);
    expect(g.stats().inFlight).toBe(1);
    if (a.ok) a.release();
    expect(g.stats().inFlight).toBe(0);
    expect(g.tryEnter("u1").ok).toBe(true);
  });

  it("one job in flight per subject; other subjects unaffected", () => {
    const g = gate();
    expect(g.tryEnter("u1").ok).toBe(true);
    expect(g.tryEnter("u1")).toEqual({ ok: false, reason: "subject_busy", retryAfterSeconds: 5 });
    expect(g.tryEnter("u2").ok).toBe(true);
  });

  it("refuses beyond maxInFlight without queueing", () => {
    const g = gate();
    expect(g.tryEnter("u1").ok).toBe(true);
    expect(g.tryEnter("u2").ok).toBe(true);
    expect(g.tryEnter("u3")).toEqual({ ok: false, reason: "capacity", retryAfterSeconds: 5 });
    expect(g.stats().inFlight).toBe(2);
  });

  it("per-window budget, with a retry hint to the window end, reset after the window", () => {
    const c = clock();
    const g = gate(c);
    for (const s of ["a", "b", "c"]) {
      const e = g.tryEnter(s);
      if (e.ok) e.release();
    }
    c.advance(20_000);
    expect(g.tryEnter("d")).toEqual({ ok: false, reason: "capacity", retryAfterSeconds: 40 });
    c.advance(40_000);
    expect(g.tryEnter("d").ok).toBe(true);
  });

  it("release is idempotent (a double release never frees someone else's slot)", () => {
    const g = gate();
    const a = g.tryEnter("u1");
    const b = g.tryEnter("u2");
    if (a.ok) {
      a.release();
      a.release();
    }
    expect(g.stats().inFlight).toBe(1);
    expect(b.ok).toBe(true);
  });
});
