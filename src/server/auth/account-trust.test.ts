import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/env", () => ({
  getEnv: () => ({ BETTER_AUTH_SECRET: "unit-test-secret-with-enough-length-000000" }),
}));
vi.mock("@/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/server/email/sender", () => ({ queueTransactionalEmail: vi.fn() }));

const trust = await import("./account-trust");
const { queueTransactionalEmail } = await import("@/server/email/sender");

describe("account trust helpers", () => {
  it("email rate keys: normalized, keyed, non-reversible", () => {
    const k = trust.emailRateKey("  Streamer@Example.COM ");
    expect(k).toBe(trust.emailRateKey("streamer@example.com"));
    expect(k).not.toMatch(/streamer|example|@/i);
    expect(k).not.toBe(trust.emailRateKey("other@example.com"));
    expect(k).toHaveLength(32);
  });

  it("callback allowlist: only SST's own result pages", () => {
    const ok = (p: string, v: unknown) => trust.isAllowedAuthCallback(p, v);
    expect(ok("/sign-up/email", "/verify-email/result")).toBe(true);
    expect(ok("/send-verification-email", "/verify-email/result")).toBe(true);
    expect(ok("/request-password-reset", "/reset-password")).toBe(true);
    expect(ok("/sign-up/email", undefined)).toBe(true);
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/dashboard",
      "/reset-password",
      1,
      null,
    ]) {
      expect(ok("/sign-up/email", bad)).toBe(false);
    }
    expect(ok("/request-password-reset", "/verify-email/result")).toBe(false);
  });

  it("log redaction removes addresses, URLs and tokens", () => {
    const out = trust.redactAuthLogText(
      "Sign-up attempt for existing email: a.b+c@mail.dev see https://x.dev/api/auth/verify-email?token=SECRET token=SECRET2",
    );
    expect(out).not.toMatch(/a\.b\+c@mail\.dev|SECRET|https?:/);
    expect(out).toContain("[email]");
    expect(out).toContain("[url]");
  });

  it("auth email callbacks return immediately, pick the locale and never throw", async () => {
    const user = { id: "u1", email: "x@y.dev", locale: null };
    const request = new Request("https://sst.dev", { headers: { cookie: "a=1; NEXT_LOCALE=en" } });
    await expect(
      trust.sendVerificationEmailForAuth({ user, url: "https://sst.dev/v?token=t" }, request),
    ).resolves.toBeUndefined();
    const sent = vi.mocked(queueTransactionalEmail).mock.calls.at(-1)?.[0];
    expect(sent).toMatchObject({ to: "x@y.dev", kind: "verify", userId: "u1" });
    expect(sent?.subject).toBe("Verify your email for SST");
    await trust.sendResetPasswordEmailForAuth({
      user: { ...user, locale: "es" },
      url: "https://sst.dev/r",
    });
    expect(vi.mocked(queueTransactionalEmail).mock.calls.at(-1)?.[0].subject).toBe(
      "Restablece tu contraseña de SST",
    );
  });
});
