import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEvent } from "@/server/realtime/events";
import { cfnUserIdSchema } from "@/server/sf6/provider";
import { rateLimit, resetRateLimits } from "./rate-limit";
import { generateOverlayToken, isValidOverlayTokenFormat } from "./tokens";

describe("overlay tokens", () => {
  it("are 32-char base64url, unique and validated by format", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateOverlayToken));
    expect(tokens.size).toBe(1000);
    for (const t of tokens) expect(isValidOverlayTokenFormat(t)).toBe(true);
  });

  it("rejects malformed tokens before any DB lookup", () => {
    for (const bad of [
      "",
      "1",
      "abc",
      "../../etc/passwd",
      "a".repeat(33),
      "a".repeat(31) + "!",
      "' or 1=1 --",
    ]) {
      expect(isValidOverlayTokenFormat(bad)).toBe(false);
    }
  });
});

describe("rateLimit", () => {
  afterEach(() => {
    resetRateLimits();
    vi.useRealTimers();
  });

  it("allows up to the limit within the window, then blocks", () => {
    const results = Array.from({ length: 4 }, () => rateLimit("k", 3, 60_000));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3]?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) rateLimit("k2", 3, 1_000);
    expect(rateLimit("k2", 3, 1_000).ok).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(rateLimit("k2", 3, 1_000).ok).toBe(true);
  });
});

describe("input validation", () => {
  it("CFN user id", () => {
    expect(cfnUserIdSchema.safeParse(" 1234567890 ").success).toBe(true);
    for (const bad of ["", "12345", "12a4567890", "1234567890123", "<script>"]) {
      expect(cfnUserIdSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("realtime events are validated", () => {
    const id = "6f1c1f0e-8a7b-4c9d-9e2f-0a1b2c3d4e5f";
    expect(parseEvent(JSON.stringify({ kind: "player", playerId: id }))).toEqual({
      kind: "player",
      playerId: id,
    });
    expect(parseEvent("not json")).toBeNull();
    expect(parseEvent(JSON.stringify({ kind: "player", playerId: "x" }))).toBeNull();
    expect(parseEvent(JSON.stringify({ kind: "drop_tables" }))).toBeNull();
  });
});
