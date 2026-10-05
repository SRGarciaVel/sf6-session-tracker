import { describe, expect, it } from "vitest";
import { pairingCodeStatus } from "./pairing";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

describe("pairingCodeStatus", () => {
  it("counts whole minutes up from the server expiry", () => {
    expect(pairingCodeStatus(at(10 * 60_000), NOW)).toEqual({ state: "active", minutesLeft: 10 });
    expect(pairingCodeStatus(at(9 * 60_000 + 1), NOW)).toEqual({
      state: "active",
      minutesLeft: 10,
    });
    expect(pairingCodeStatus(at(60_000), NOW)).toEqual({ state: "active", minutesLeft: 1 });
  });
  it("never shows more than the 10-minute TTL (client clock behind the server)", () => {
    expect(pairingCodeStatus(at(10 * 60_000 + 45_000), NOW)).toEqual({
      state: "active",
      minutesLeft: 10,
    });
  });
  it("last minute, then expired", () => {
    expect(pairingCodeStatus(at(59_999), NOW)).toEqual({ state: "expiring" });
    expect(pairingCodeStatus(at(0), NOW)).toEqual({ state: "expired" });
    expect(pairingCodeStatus(at(-5_000), NOW)).toEqual({ state: "expired" });
  });
});
