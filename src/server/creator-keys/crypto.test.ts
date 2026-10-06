import { describe, expect, it } from "vitest";
import {
  CROCKFORD_ALPHABET,
  creatorKeyHint,
  formatKeyHint,
  generateCreatorKey,
  hashCreatorKey,
  normalizeCreatorKey,
} from "./crypto";

const PEPPER = "test-pepper-0123456789abcdef0123456789abcdef";
const FORMAT = /^SST(-[0-9A-HJKMNP-TV-Z]{4}){5}$/;

describe("Creator Key format", () => {
  it("generates SST-XXXX-XXXX-XXXX-XXXX-XXXX with Crockford Base32 only", () => {
    for (let i = 0; i < 200; i++) expect(generateCreatorKey()).toMatch(FORMAT);
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    expect(CROCKFORD_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it("is non-deterministic and uses the whole alphabet (CSPRNG, ~100 bits)", () => {
    const keys = new Set(Array.from({ length: 2000 }, generateCreatorKey));
    expect(keys.size).toBe(2000);
    const seen = new Set([...keys].join("").replaceAll("SST", "").replaceAll("-", ""));
    expect(seen.size).toBe(32);
  });
});

describe("normalizeCreatorKey", () => {
  const key = "SST-ABCD-EFGH-JKMN-PQRS-TVWX";
  it("accepts the exact format, any case, surrounding whitespace", () => {
    expect(normalizeCreatorKey(key)).toBe("ABCDEFGHJKMNPQRSTVWX");
    expect(normalizeCreatorKey(`  ${key.toLowerCase()}\n`)).toBe("ABCDEFGHJKMNPQRSTVWX");
  });

  it("rejects everything else (no ambiguous-character correction)", () => {
    for (const bad of [
      "",
      "ABCD-EFGH-JKMN-PQRS-TVWX", // no prefix
      "SST-ABCDEFGHJKMNPQRSTVWX", // no dashes
      "SST-ABCD-EFGH-JKMN-PQRS", // short
      "SST-ABCD-EFGH-JKMN-PQRS-TVWX-YZ00", // long
      "SST-ABCD-EFGH-JKMN-PQRS-TVWI", // I is not Crockford
      "SST-ABCD-EFGH-JKMN-PQRS-TVWO", // O is not Crockford (never "corrected" to 0)
      "SST-ABCD-EFGH-JKMN-PQRS-TV W",
      "SST-ABCD-EFGH-JKMN-PQRS-TVWX\u0000",
      "x".repeat(65),
      null,
      42,
      { key },
    ]) {
      expect(normalizeCreatorKey(bad), String(bad)).toBeNull();
    }
  });
});

describe("hashCreatorKey (HMAC-SHA-256)", () => {
  it("is stable, 32 bytes, pepper-dependent and never the plaintext", () => {
    const body = "ABCDEFGHJKMNPQRSTVWX";
    const a = hashCreatorKey(body, PEPPER);
    expect(a).toHaveLength(32);
    expect(hashCreatorKey(body, PEPPER).equals(a)).toBe(true);
    expect(hashCreatorKey(body, `${PEPPER}x`).equals(a)).toBe(false);
    expect(hashCreatorKey("ABCDEFGHJKMNPQRSTVWY", PEPPER).equals(a)).toBe(false);
    expect(a.toString("utf8")).not.toContain(body);
  });

  it("hint is the last 4 characters", () => {
    expect(creatorKeyHint("ABCDEFGHJKMNPQRSTVWX")).toBe("TVWX");
    expect(formatKeyHint("TVWX")).toBe("••••-TVWX");
  });
});
