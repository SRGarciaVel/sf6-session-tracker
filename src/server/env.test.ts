import { afterEach, describe, expect, it, vi } from "vitest";

const BASE = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "a-real-random-secret-value-with-enough-length-0001",
  CREATOR_KEY_PEPPER: "9f1c2b7e4d8a6f3c0b5e7d9a2c4f6e8b1d3a5c7e9f0b2d4c6e8a1f3b5d7c9e0a",
};

async function loadEnv(vars: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs(); // each call describes the whole environment
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  return (await import("./env")).getEnv();
}

describe("environment hardening", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("SEC-006: refuses the public .env.example secret in production", async () => {
    await expect(
      loadEnv({
        ...BASE,
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "change-me-to-a-long-random-string-0123456789",
      }),
    ).rejects.toThrow(/placeholder/);
    await expect(loadEnv({ ...BASE, NODE_ENV: "production" })).resolves.toBeTruthy();
  });

  it("SEC-003: rate limits default to the shared Postgres store in production only", async () => {
    expect((await loadEnv({ ...BASE, NODE_ENV: "production" })).RATE_LIMIT_STORE).toBe("postgres");
    expect((await loadEnv({ ...BASE, NODE_ENV: "development" })).RATE_LIMIT_STORE).toBe("memory");
    expect(
      (await loadEnv({ ...BASE, NODE_ENV: "production", RATE_LIMIT_STORE: "memory" }))
        .RATE_LIMIT_STORE,
    ).toBe("memory"); // explicit opt-out (single-instance deployments)
  });

  it("SEC-013: client IP comes from the trusted header's rightmost entry only", async () => {
    await loadEnv({ ...BASE, NODE_ENV: "production", TRUST_PROXY: "true" });
    const { getClientIp } = await import("./security/client-ip");
    // Client forged "1.2.3.4"; the proxy appended the real address last.
    expect(getClientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
    expect(getClientIp(new Headers())).toBe("unknown");

    await loadEnv({
      ...BASE,
      NODE_ENV: "production",
      TRUST_PROXY: "true",
      CLIENT_IP_HEADER: "x-real-ip",
    });
    const again = await import("./security/client-ip");
    expect(
      again.getClientIp(new Headers({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "9.9.9.9" })),
    ).toBe("203.0.113.5");

    await loadEnv({ ...BASE, NODE_ENV: "development" });
    const local = await import("./security/client-ip");
    expect(local.getClientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBe("local"); // untrusted
  });

  it("Creator Keys: pepper required in production, ≥ 32 chars, no placeholders", async () => {
    const noPepper = {
      DATABASE_URL: BASE.DATABASE_URL,
      BETTER_AUTH_SECRET: BASE.BETTER_AUTH_SECRET,
    };
    await expect(loadEnv({ ...noPepper, NODE_ENV: "production" })).rejects.toThrow(
      /CREATOR_KEY_PEPPER: required/,
    );
    await expect(
      loadEnv({
        ...BASE,
        NODE_ENV: "production",
        CREATOR_KEY_PEPPER: "dev-only-creator-key-pepper-not-a-secret-0000",
      }),
    ).rejects.toThrow(/CREATOR_KEY_PEPPER: placeholder/);
    await expect(loadEnv({ ...BASE, CREATOR_KEY_PEPPER: "too-short" })).rejects.toThrow(
      /at least 32/,
    );
    // Optional outside production (redeem simply reports keys as unavailable).
    expect(
      (await loadEnv({ ...noPepper, NODE_ENV: "development" })).CREATOR_KEY_PEPPER,
    ).toBeUndefined();
  });
});
