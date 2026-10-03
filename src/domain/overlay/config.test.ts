import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  applyThemeDefaults,
  hexToRgba,
  overlayConfigSchema,
  parseOverlayConfig,
} from "./config";
import { formatDelta, formatWinRate } from "@/domain/format";

describe("overlay config", () => {
  it("default config is valid", () => {
    expect(overlayConfigSchema.parse(DEFAULT_OVERLAY_CONFIG)).toEqual(DEFAULT_OVERLAY_CONFIG);
  });

  it("lenient parse fills missing keys from defaults", () => {
    const parsed = parseOverlayConfig({ theme: "minimal", fields: { rank: true } });
    expect(parsed.theme).toBe("minimal");
    expect(parsed.fields.rank).toBe(true);
    expect(parsed.fields.wins).toBe(true);
  });

  it("falls back to defaults on invalid/hostile input", () => {
    expect(parseOverlayConfig({ textColor: "red;}</style><script>" })).toEqual(
      DEFAULT_OVERLAY_CONFIG,
    );
    expect(parseOverlayConfig("nope")).toEqual(DEFAULT_OVERLAY_CONFIG);
    expect(parseOverlayConfig(null)).toEqual(DEFAULT_OVERLAY_CONFIG);
  });

  it("strict schema rejects out-of-range values", () => {
    expect(overlayConfigSchema.safeParse({ ...DEFAULT_OVERLAY_CONFIG, scale: 9 }).success).toBe(
      false,
    );
  });

  it("theme switch applies theme defaults", () => {
    const c = applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "minimal");
    expect(c.theme).toBe("minimal");
    expect(c.preset).toBe("compact");
  });

  it("hexToRgba clamps alpha", () => {
    expect(hexToRgba("#ff0080", 2)).toBe("rgba(255, 0, 128, 1)");
  });
});

describe("formatters", () => {
  it("win rate", () => {
    expect(formatWinRate(70.6)).toBe("70.6%");
    expect(formatWinRate(60)).toBe("60%");
    expect(formatWinRate(Number.NaN)).toBe("0%");
  });

  it("deltas", () => {
    expect(formatDelta(24)).toBe("+24");
    expect(formatDelta(-18)).toBe("−18");
    expect(formatDelta(0)).toBe("±0");
    expect(formatDelta(null)).toBe("—");
    expect(formatDelta(1620)).toBe("+1,620");
  });
});

describe("public overlay state", () => {
  it("never exposes the internal session id", async () => {
    const { sampleLiveState, toPublicLiveState } = await import("./state");
    const live = sampleLiveState();
    live.session.sessionId = "6f1c1f0e-8a7b-4c9d-9e2f-0a1b2c3d4e5f";
    expect(JSON.stringify(toPublicLiveState(live))).not.toContain(live.session.sessionId);
  });
});
