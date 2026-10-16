import { describe, expect, it } from "vitest";
import { formatMinutes, formatSignedDecimal } from "./format";

describe("formatMinutes (analytics gameplay duration)", () => {
  it.each([
    [0, "0 min"],
    [29_999, "0 min"],
    [5 * 60_000, "5 min"],
    [42 * 60_000, "42 min"],
    [60 * 60_000, "1 h 0 min"],
    [84 * 60_000, "1 h 24 min"],
    [84 * 60_000 + 40_000, "1 h 25 min"],
  ])("%i ms → %s", (ms, text) => {
    expect(formatMinutes(ms, "es")).toBe(text);
  });

  it("unavailable → '—'; never seconds or NaN", () => {
    for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatMinutes(v, "en")).toBe("—");
    }
    expect(formatMinutes(-5, "en")).toBe("0 min");
  });
});

describe("formatSignedDecimal (review differences in pp)", () => {
  it("always signed, one decimal, locale separators", () => {
    expect(formatSignedDecimal(-13.84, "es")).toBe("-13,8");
    expect(formatSignedDecimal(10, "es")).toBe("+10");
    expect(formatSignedDecimal(-9.99999999999999, "en")).toBe("-10");
    expect(formatSignedDecimal(12.55, "en")).toBe("+12.6");
  });

  it("never -0 / +0 / NaN", () => {
    expect(formatSignedDecimal(-0.04, "es")).toBe("±0");
    expect(formatSignedDecimal(0, "en")).toBe("±0");
    for (const v of [null, undefined, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(formatSignedDecimal(v, "es")).toBe("—");
    }
  });
});
