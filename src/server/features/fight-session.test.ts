import { afterEach, describe, expect, it, vi } from "vitest";
import { decideDashboardUi } from "./fight-session";

const A = "user-a-0001";
const B = "user-b-0002";

describe("Fight Session dashboard gate (server allowlist, off by default)", () => {
  it("default: empty allowlist ⇒ classic for everyone", () => {
    expect(decideDashboardUi({ userId: A, allowlist: [] })).toBe("classic");
  });
  it("eligible account ⇒ fight-session; others stay classic", () => {
    expect(decideDashboardUi({ userId: A, allowlist: [A] })).toBe("fight-session");
    expect(decideDashboardUi({ userId: B, allowlist: [A] })).toBe("classic");
  });
  it("request input can never grant access", () => {
    for (const requested of ["fight-session", "fight", "1", "true", ["fight-session"]])
      expect(decideDashboardUi({ userId: B, allowlist: [A], requested })).toBe("classic");
  });
  it("an eligible tester can opt out per request (?ui=classic)", () => {
    expect(decideDashboardUi({ userId: A, allowlist: [A], requested: "classic" })).toBe("classic");
    expect(decideDashboardUi({ userId: A, allowlist: [A], requested: ["classic", "x"] })).toBe(
      "classic",
    );
    expect(decideDashboardUi({ userId: A, allowlist: [A], requested: "other" })).toBe(
      "fight-session",
    );
  });
  it("rollback: removing the id from the allowlist returns the account to classic", () => {
    expect(decideDashboardUi({ userId: A, allowlist: [A, B] })).toBe("fight-session");
    expect(decideDashboardUi({ userId: A, allowlist: [B] })).toBe("classic");
  });
  it("exact id match only (no prefix / case tricks)", () => {
    expect(decideDashboardUi({ userId: "user-a", allowlist: [A] })).toBe("classic");
    expect(decideDashboardUi({ userId: A.toUpperCase(), allowlist: [A] })).toBe("classic");
  });
});

describe("FIGHT_SESSION_UI_USERS parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  async function env(value: string | undefined) {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/x");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-at-least-32-characters-long-xx");
    vi.stubEnv("NODE_ENV", "test");
    if (value === undefined) vi.stubEnv("FIGHT_SESSION_UI_USERS", "");
    else vi.stubEnv("FIGHT_SESSION_UI_USERS", value);
    const { getEnv } = await import("@/server/env");
    return getEnv().FIGHT_SESSION_UI_USERS;
  }
  it("unset/empty ⇒ nobody", async () => {
    expect(await env(undefined)).toEqual([]);
  });
  it("comma / space / newline separated ids", async () => {
    expect(await env(` ${A}, ${B}\n`)).toEqual([A, B]);
  });
});
