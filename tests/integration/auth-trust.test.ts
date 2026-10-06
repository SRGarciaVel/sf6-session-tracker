/**
 * Phase 4.6 — account trust against a real Postgres (TEST_DATABASE_URL), through Better Auth's
 * real HTTP handler: sign-up → unverified → verification link → sign-in; resend; password reset;
 * enumeration resistance; rate limits; redirects; legacy unverified sessions; logging hygiene.
 * Email uses the in-memory transport: nothing leaves the machine.
 */
import { randomUUID } from "node:crypto";
import { eq, like, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.RATE_LIMIT_STORE = "postgres"; // production storage for both limiters
process.env.EMAIL_PROVIDER = "memory";
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authSession, authUser, authVerification, rateLimitBucket } =
  await import("@/server/db/schema");
const { getAuth } = await import("@/server/auth/auth");
const { getVerifiedSession } = await import("@/server/auth/verified-session");
const { getEnv } = await import("@/server/env");
const { clearEmailOutbox, flushEmailQueue, getEmailOutbox, setEmailTransport, EmailSendError } =
  await import("@/server/email/sender");
const { createEmailVerificationToken } = await import("better-auth/api");

const PASSWORD = "first-password-123";
const NEW_PASSWORD = "second-password-456";

describe.skipIf(!TEST_DB)(
  "account trust: verification, recovery, enumeration (integration)",
  () => {
    const db = TEST_DB ? getDb() : (null as never);
    const appUrl = TEST_DB ? getEnv().APP_URL : "";

    beforeEach(() => {
      clearEmailOutbox();
      setEmailTransport(null);
    });
    afterAll(async () => {
      await db.delete(authUser).where(like(authUser.email, "%@auth-trust.test"));
      await closeDb();
    });

    const freshIp = () =>
      `198.19.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;
    const newEmail = () => `${randomUUID()}@auth-trust.test`;

    async function call(
      path: string,
      opts: { method?: "GET" | "POST"; body?: unknown; cookie?: string; ip?: string } = {},
    ) {
      const res = await getAuth().handler(
        new Request(path.startsWith("http") ? path : `${appUrl}/api/auth${path}`, {
          method: opts.method ?? "POST",
          headers: {
            "content-type": "application/json",
            origin: appUrl,
            "x-forwarded-for": opts.ip ?? freshIp(),
            ...(opts.cookie ? { cookie: opts.cookie } : {}),
          },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          redirect: "manual",
        }),
      );
      await flushEmailQueue();
      return res;
    }
    const cookieOf = (res: Response) =>
      res.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
    const sessionCookieSet = (res: Response) =>
      res.headers
        .getSetCookie()
        .some((c) => /session_token=[^;]+/.test(c) && !/Max-Age=0/i.test(c));
    const userByEmail = async (email: string) =>
      (await db.select().from(authUser).where(eq(authUser.email, email)))[0];
    const lastEmailTo = (to: string) => [...getEmailOutbox()].reverse().find((m) => m.to === to);
    const linkIn = (text: string) => {
      const url = /https?:\/\/\S+/.exec(text)?.[0];
      if (!url) throw new Error("no link in email");
      return url;
    };

    async function signUp(email = newEmail()) {
      const res = await call("/sign-up/email", {
        body: { email, password: PASSWORD, name: "Trust", callbackURL: "/verify-email/result" },
      });
      return { email, res };
    }
    async function verify(email: string) {
      const mail = lastEmailTo(email);
      if (!mail) throw new Error("no verification email");
      return call(linkIn(mail.text), { method: "GET" });
    }
    async function verifiedUser() {
      const { email } = await signUp();
      await verify(email);
      const res = await call("/sign-in/email", { body: { email, password: PASSWORD } });
      return { email, cookie: cookieOf(res) };
    }

    /* ───────── registration & verification ───────── */

    it("1–2. sign-up creates an UNVERIFIED user, issues no session, and queues one verification email", async () => {
      const { email, res } = await signUp();
      expect(res.status).toBe(200);
      expect(sessionCookieSet(res)).toBe(false);
      expect(((await res.json()) as { token: unknown }).token).toBeNull();
      expect((await userByEmail(email))?.emailVerified).toBe(false);
      const mail = lastEmailTo(email);
      expect(mail?.kind).toBe("verify");
      const link = new URL(linkIn(mail?.text ?? ""));
      expect(link.origin + link.pathname).toBe(`${appUrl}/api/auth/verify-email`);
      expect(link.searchParams.get("callbackURL")).toBe("/verify-email/result");
      expect(mail?.html).toContain("Verifica tu correo"); // default locale (es)
    });

    it("8. unverified sign-in with the RIGHT password is refused (403 EMAIL_NOT_VERIFIED), no session", async () => {
      const { email } = await signUp();
      const res = await call("/sign-in/email", { body: { email, password: PASSWORD } });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe("EMAIL_NOT_VERIFIED");
      expect(sessionCookieSet(res)).toBe(false);
      // A wrong password stays the generic 401 (no verification-state oracle without the password).
      const wrong = await call("/sign-in/email", { body: { email, password: "nope-nope-123" } });
      expect(wrong.status).toBe(401);
    });

    it("3, 9. the link verifies (redirect to the result page, NO session), then sign-in works", async () => {
      const { email } = await signUp();
      const res = await verify(email);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/verify-email/result");
      expect(sessionCookieSet(res)).toBe(false); // autoSignInAfterVerification: false
      expect((await userByEmail(email))?.emailVerified).toBe(true);

      const signIn = await call("/sign-in/email", { body: { email, password: PASSWORD } });
      expect(signIn.status).toBe(200);
      const session = await getVerifiedSession(new Headers({ cookie: cookieOf(signIn) }));
      expect(session?.user.email).toBe(email);

      // Opening the same link again: still a success page, still no session.
      const again = await verify(email);
      expect(again.headers.get("location")).toBe("/verify-email/result");
      expect(sessionCookieSet(again)).toBe(false);
    });

    it("4–5. expired, invalid and malformed verification tokens never verify", async () => {
      const { email } = await signUp();
      const cb = encodeURIComponent("/verify-email/result");
      const expired = await createEmailVerificationToken(
        getEnv().BETTER_AUTH_SECRET,
        email,
        undefined,
        -60,
      );
      const r1 = await call(`/verify-email?token=${expired}&callbackURL=${cb}`, { method: "GET" });
      expect(r1.headers.get("location")).toBe("/verify-email/result?error=TOKEN_EXPIRED");
      const forged = await createEmailVerificationToken(
        "another-secret-of-32-characters-xx",
        email,
      );
      const r2 = await call(`/verify-email?token=${forged}&callbackURL=${cb}`, { method: "GET" });
      expect(r2.headers.get("location")).toBe("/verify-email/result?error=INVALID_TOKEN");
      const r3 = await call(`/verify-email?token=garbage&callbackURL=${cb}`, { method: "GET" });
      expect(r3.headers.get("location")).toBe("/verify-email/result?error=INVALID_TOKEN");
      const r4 = await call(`/verify-email`, { method: "GET" });
      expect(r4.status).toBe(400);
      expect((await userByEmail(email))?.emailVerified).toBe(false);
    });

    it("6, 14. resend: identical response for pending, verified and unknown addresses; mail only for pending", async () => {
      const pending = (await signUp()).email;
      const verified = (await verifiedUser()).email;
      const unknown = newEmail();
      clearEmailOutbox();
      const responses = [];
      for (const email of [pending, verified, unknown]) {
        const res = await call("/send-verification-email", {
          body: { email, callbackURL: "/verify-email/result" },
        });
        responses.push({ status: res.status, body: await res.text() });
      }
      expect(new Set(responses.map((r) => JSON.stringify(r))).size).toBe(1);
      expect(responses[0]).toEqual({ status: 200, body: JSON.stringify({ status: true }) });
      expect(getEmailOutbox().map((m) => m.to)).toEqual([pending]);
    });

    it("7. resend is limited per email (keyed hash, Postgres) and per IP", async () => {
      const { email } = await signUp();
      const statuses = [];
      for (let i = 0; i < 4; i++) {
        statuses.push(
          (
            await call("/send-verification-email", {
              body: { email, callbackURL: "/verify-email/result" },
            })
          ).status,
        );
      }
      expect(statuses).toEqual([200, 200, 200, 429]); // 3 per 15 min per address, any IP
      // Per IP: 10 per hour across different addresses.
      const ip = freshIp();
      const perIp = [];
      for (let i = 0; i < 11; i++) {
        perIp.push(
          (await call("/send-verification-email", { ip, body: { email: newEmail() } })).status,
        );
      }
      expect(perIp.slice(0, 10).every((s) => s === 200)).toBe(true);
      expect(perIp[10]).toBe(429);
      // Rate-limit storage never holds raw addresses.
      const keys = await db.select({ key: rateLimitBucket.key }).from(rateLimitBucket);
      expect(keys.some((k) => k.key.startsWith("auth-email:"))).toBe(true);
      expect(keys.every((k) => !k.key.includes("@"))).toBe(true);
      const authKeys = (await db.execute(
        sql`select key from auth_rate_limit`,
      )) as unknown as Array<{
        key: string;
      }>;
      expect(authKeys.length).toBeGreaterThan(0); // Better Auth limiter → Postgres
      expect(authKeys.every((k) => !k.key.includes("@"))).toBe(true);
    }, 30_000); // Better Auth pads each unauthenticated resend to >= 500 ms (timing protection)

    it("sign-up is limited per IP (5 per 15 min)", async () => {
      const ip = freshIp();
      const statuses = [];
      for (let i = 0; i < 6; i++) {
        statuses.push(
          (
            await call("/sign-up/email", {
              ip,
              body: { email: newEmail(), password: PASSWORD, name: "RL" },
            })
          ).status,
        );
      }
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    });

    /* ───────── enumeration ───────── */

    it("duplicate sign-up: same status and response shape as a new one; no session, nothing changed", async () => {
      const { email } = await verifiedUser();
      const before = await userByEmail(email);
      const fresh = await signUp();
      const dup = await call("/sign-up/email", {
        body: {
          email,
          password: "attacker-password-1",
          name: "Trust",
          callbackURL: "/verify-email/result",
        },
      });
      expect(dup.status).toBe(fresh.res.status);
      const a = (await fresh.res.json()) as { token: unknown; user: Record<string, unknown> };
      const b = (await dup.json()) as { token: unknown; user: Record<string, unknown> };
      expect(Object.keys(b.user).sort()).toEqual(Object.keys(a.user).sort());
      expect(b.token).toBeNull();
      expect(b.user.emailVerified).toBe(false);
      expect(b.user.id).not.toBe(before?.id); // synthetic id
      expect(sessionCookieSet(dup)).toBe(false);
      expect(await userByEmail(email)).toEqual(before);
      // The real owner's password still works; the attacker's doesn't.
      expect((await call("/sign-in/email", { body: { email, password: PASSWORD } })).status).toBe(
        200,
      );
      expect(
        (await call("/sign-in/email", { body: { email, password: "attacker-password-1" } })).status,
      ).toBe(401);
    });

    it("12–14. forgot password: identical response for existing and unknown accounts", async () => {
      const { email } = await verifiedUser();
      const unknown = newEmail();
      clearEmailOutbox();
      const body = (e: string) => ({ email: e, redirectTo: "/reset-password" });
      const r1 = await call("/request-password-reset", { body: body(email) });
      const r2 = await call("/request-password-reset", { body: body(unknown) });
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(r1.status);
      expect(await r2.text()).toBe(await r1.text());
      expect(getEmailOutbox().map((m) => m.to)).toEqual([email]);
    });

    /* ───────── password reset ───────── */

    async function requestReset(email: string) {
      await call("/request-password-reset", { body: { email, redirectTo: "/reset-password" } });
      const mail = lastEmailTo(email);
      if (!mail || mail.kind !== "reset") throw new Error("no reset email");
      const link = new URL(linkIn(mail.text));
      expect(link.pathname).toMatch(/^\/api\/auth\/reset-password\/[\w-]+$/);
      expect(link.searchParams.get("callbackURL")).toBe("/reset-password");
      return { link, token: link.pathname.split("/").pop() ?? "" };
    }

    it("15, 17–20. reset works once, changes the password and revokes every session", async () => {
      const { email, cookie } = await verifiedUser();
      const second = cookieOf(
        await call("/sign-in/email", { body: { email, password: PASSWORD } }),
      );
      const { link, token } = await requestReset(email);

      // Token stored hashed (never the plaintext token in auth_verification).
      const rows = await db.select().from(authVerification);
      expect(rows.some((r) => r.identifier.includes(token))).toBe(false);

      const landing = await call(link.toString(), { method: "GET" });
      expect(landing.status).toBe(302);
      expect(landing.headers.get("location")).toBe(`${appUrl}/reset-password?token=${token}`);

      const ok = await call("/reset-password", { body: { newPassword: NEW_PASSWORD, token } });
      expect(ok.status).toBe(200);
      const reused = await call("/reset-password", {
        body: { newPassword: "third-password-789", token },
      });
      expect(reused.status).toBe(400);

      expect((await call("/sign-in/email", { body: { email, password: PASSWORD } })).status).toBe(
        401,
      );
      const user = await userByEmail(email);
      expect(await getVerifiedSession(new Headers({ cookie }))).toBeNull();
      expect(await getVerifiedSession(new Headers({ cookie: second }))).toBeNull();
      expect(
        await db
          .select()
          .from(authSession)
          .where(eq(authSession.userId, user?.id ?? "")),
      ).toEqual([]);
      expect(
        (await call("/sign-in/email", { body: { email, password: NEW_PASSWORD } })).status,
      ).toBe(200);
    });

    it("16. an expired reset token is refused (landing and submit)", async () => {
      const { email } = await verifiedUser();
      const { link, token } = await requestReset(email);
      const user = await userByEmail(email);
      await db
        .update(authVerification)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(authVerification.value, user?.id ?? ""));
      const landing = await call(link.toString(), { method: "GET" });
      expect(landing.headers.get("location")).toBe(`${appUrl}/reset-password?error=INVALID_TOKEN`);
      expect(
        (await call("/reset-password", { body: { newPassword: NEW_PASSWORD, token } })).status,
      ).toBe(400);
      expect((await call("/sign-in/email", { body: { email, password: PASSWORD } })).status).toBe(
        200,
      );
    });

    it("a reset proves inbox ownership: an unverified (e.g. legacy) account becomes verified", async () => {
      const { email } = await signUp();
      const { token } = await requestReset(email);
      expect(
        (await call("/reset-password", { body: { newPassword: NEW_PASSWORD, token } })).status,
      ).toBe(200);
      expect((await userByEmail(email))?.emailVerified).toBe(true);
      expect(
        (await call("/sign-in/email", { body: { email, password: NEW_PASSWORD } })).status,
      ).toBe(200);
    });

    /* ───────── legacy sessions, protected features ───────── */

    it("10–11. a session held by an UNVERIFIED account grants nothing (pre-4.6 accounts)", async () => {
      const { email, cookie } = await verifiedUser();
      await db.update(authUser).set({ emailVerified: false }).where(eq(authUser.email, email));
      const headers = new Headers({ cookie });
      expect(await getVerifiedSession(headers)).toBeNull();
      // The same gate guards API routes (and, via getCurrentUser, every page and server action:
      // onboarding, CFN linking, dashboard, overlays, presets, Creator Key redemption).
      const { GET } = await import("@/app/api/me/stream/route");
      expect((await GET(new Request(`${appUrl}/api/me/stream`, { headers }))).status).toBe(401);
      const heartbeat = await import("@/app/api/session/heartbeat/route");
      const hb = await heartbeat.POST(
        new Request(`${appUrl}/api/session/heartbeat`, {
          method: "POST",
          headers: { cookie, origin: appUrl },
        }),
      );
      expect(hb.status).toBe(401);
    });

    /* ───────── redirects ───────── */

    it("22. callback / redirect targets other than SST's own pages are rejected", async () => {
      for (const callbackURL of [
        "https://evil.example/phish",
        "//evil.example",
        `${appUrl}/verify-email/result`,
        "/dashboard",
        "javascript:alert(1)",
      ]) {
        const res = await call("/sign-up/email", {
          body: { email: newEmail(), password: PASSWORD, name: "R", callbackURL },
        });
        expect(res.status, callbackURL).toBe(400);
        const resend = await call("/send-verification-email", {
          body: { email: newEmail(), callbackURL },
        });
        expect(resend.status, callbackURL).toBe(400);
        const reset = await call("/request-password-reset", {
          body: { email: newEmail(), redirectTo: callbackURL },
        });
        expect(reset.status, callbackURL).toBe(400);
      }
      expect(getEmailOutbox()).toEqual([]);
    });

    /* ───────── delivery failures, logging, transport ───────── */

    it("provider failure: the response is unchanged, nothing is marked verified, details aren't exposed", async () => {
      const attempts: string[] = [];
      setEmailTransport({
        name: "failing",
        async send(message) {
          attempts.push(message.kind);
          throw new EmailSendError("provider_unavailable", true);
        },
      });
      const { email, res } = await signUp();
      expect(res.status).toBe(200);
      expect(await res.text()).not.toMatch(/provider|resend|unavailable/i);
      expect((await userByEmail(email))?.emailVerified).toBe(false);
      expect(attempts).toEqual(["verify", "verify"]); // one retry, then given up (logged)
      const resend = await call("/send-verification-email", { body: { email } });
      expect(resend.status).toBe(200);
    });

    it("21. logs never contain addresses, tokens, links or passwords", async () => {
      const lines: string[] = [];
      const capture = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
      const spies = [
        vi.spyOn(console, "log").mockImplementation(capture),
        vi.spyOn(console, "error").mockImplementation(capture),
        vi.spyOn(console, "warn").mockImplementation(capture),
        vi.spyOn(console, "info").mockImplementation(capture),
      ];
      process.env.LOG_LEVEL = "debug";
      try {
        const { email } = await verifiedUser();
        await signUp(email); // duplicate (Better Auth logs this case)
        const { token } = await requestReset(email);
        await call("/reset-password", { body: { newPassword: NEW_PASSWORD, token } });
        await call("/request-password-reset", {
          body: { email: newEmail(), redirectTo: "/reset-password" },
        });
        await call("/sign-in/email", { body: { email, password: "wrong-password-1" } });
        const all = lines.join("\n");
        expect(lines.length).toBeGreaterThan(0);
        expect(all).toContain("email.sent");
        expect(all).not.toContain(email);
        expect(all).not.toContain("@auth-trust.test");
        expect(all).not.toContain(token);
        expect(all).not.toMatch(/verify-email\?token=|reset-password\/[\w-]{10,}/);
        expect(all).not.toContain(PASSWORD);
        expect(all).not.toContain(NEW_PASSWORD);
      } finally {
        process.env.LOG_LEVEL = "error";
        for (const s of spies) s.mockRestore();
      }
    });

    it("24. the test transport sends nothing externally", async () => {
      expect(getEnv().EMAIL_PROVIDER).toBe("memory");
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      try {
        await signUp();
        expect(getEmailOutbox().length).toBe(1);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  },
);
