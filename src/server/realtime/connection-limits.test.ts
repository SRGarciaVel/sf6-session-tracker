import { afterEach, describe, expect, it } from "vitest";
import { acquireSseSlots, openSseSlots, resetSseSlots, SSE_LIMITS } from "./connection-limits";

describe("SSE connection caps (SEC-004)", () => {
  afterEach(() => resetSseSlots());

  it("a leaked overlay URL cannot hold more than perOverlay open streams", () => {
    const releases = Array.from({ length: SSE_LIMITS.perOverlay }, (_, i) =>
      acquireSseSlots([
        ["overlay:o1", SSE_LIMITS.perOverlay],
        [`ip:10.0.0.${i}`, SSE_LIMITS.perIp],
      ]),
    );
    expect(releases.every(Boolean)).toBe(true);
    expect(
      acquireSseSlots([
        ["overlay:o1", SSE_LIMITS.perOverlay],
        ["ip:10.0.0.99", 30],
      ]),
    ).toBeNull();
    releases[0]?.();
    expect(
      acquireSseSlots([
        ["overlay:o1", SSE_LIMITS.perOverlay],
        ["ip:10.0.0.99", 30],
      ]),
    ).not.toBeNull();
  });

  it("all-or-nothing: a full IP bucket does not leak a slot in the overlay bucket", () => {
    for (let i = 0; i < 2; i++) acquireSseSlots([["ip:1.1.1.1", 2]]);
    expect(
      acquireSseSlots([
        ["overlay:o2", 10],
        ["ip:1.1.1.1", 2],
      ]),
    ).toBeNull();
    expect(openSseSlots("overlay:o2")).toBe(0);
  });

  it("release is idempotent (abort + stream end both call it)", () => {
    const release = acquireSseSlots([["user:u", SSE_LIMITS.perUser]]);
    release?.();
    release?.();
    expect(openSseSlots("user:u")).toBe(0);
  });
});
