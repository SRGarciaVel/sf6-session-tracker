import { describe, expect, it } from "vitest";
import { compareExtensionVersions, isValidExtensionVersion } from "../src/version";

describe("extension versions", () => {
  it("valid Chromium versions only", () => {
    for (const v of ["0", "0.1.0", "1.2.3.4", "65535.0.0"])
      expect(isValidExtensionVersion(v)).toBe(true);
    for (const v of [
      "",
      "0.1.0-beta",
      "v0.1.0",
      "01.0",
      "1.2.3.4.5",
      "70000",
      "1..2",
      " 1.0",
      "1.0 ",
    ])
      expect(isValidExtensionVersion(v), v).toBe(false);
  });

  it("compares numerically, not lexicographically", () => {
    expect(compareExtensionVersions("0.1.10", "0.1.9")).toBe(1);
    expect(compareExtensionVersions("0.1.9", "0.1.10")).toBe(-1);
    expect(compareExtensionVersions("0.1.0", "0.1.1")).toBe(-1);
    expect(compareExtensionVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareExtensionVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareExtensionVersions("0.1.0", "0.1.0")).toBe(0);
  });

  it("missing parts count as zero", () => {
    expect(compareExtensionVersions("1.0", "1.0.0")).toBe(0);
    expect(compareExtensionVersions("1", "1.0.0.1")).toBe(-1);
  });

  it("invalid input ⇒ null (never a guess)", () => {
    expect(compareExtensionVersions("0.1.0-beta", "0.1.0")).toBeNull();
    expect(compareExtensionVersions("0.1.0", "latest")).toBeNull();
    expect(compareExtensionVersions("", "")).toBeNull();
  });
});
