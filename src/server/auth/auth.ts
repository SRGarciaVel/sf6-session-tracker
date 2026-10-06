/**
 * Authentication (better-auth, email + password, sessions stored in Postgres).
 * Created lazily so importing route modules at build time doesn't require env vars.
 *
 * Phase 4.6 (docs/auth.md): an email address is trusted only after its owner opens the
 * verification link. Better Auth refuses to create a session for an unverified account
 * (requireEmailVerification); sessions are read through getVerifiedSession() (session.ts),
 * which also ignores sessions of unverified accounts created before this phase.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  authAccount,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
} from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { rateLimit } from "@/server/security/rate-limit";
import {
  EMAIL_VERIFICATION_TTL_SECONDS,
  PASSWORD_RESET_TTL_SECONDS,
  betterAuthLog,
  emailRateKey,
  isAllowedAuthCallback,
  sendResetPasswordEmailForAuth,
  sendVerificationEmailForAuth,
} from "./account-trust";

/**
 * Per-IP limits (Better Auth's limiter, Postgres-backed in production). One rule per path;
 * per-EMAIL limits for the mail-sending endpoints are added in the before-hook below.
 */
export const AUTH_RATE_LIMITS = {
  "/sign-up/email": { window: 15 * 60, max: 5 },
  "/sign-in/email": { window: 5 * 60, max: 10 },
  "/send-verification-email": { window: 60 * 60, max: 10 },
  "/request-password-reset": { window: 15 * 60, max: 5 },
  "/reset-password": { window: 15 * 60, max: 10 },
  "/verify-email": { window: 15 * 60, max: 20 },
} as const;

/** Per normalized email (keyed hash): the mail provider can't be used to flood an inbox. */
export const EMAIL_SEND_LIMITS = {
  "/send-verification-email": { max: 3, windowMs: 15 * 60_000 },
  "/request-password-reset": { max: 3, windowMs: 15 * 60_000 },
} as const;

const CALLBACK_FIELD: Record<string, "callbackURL" | "redirectTo"> = {
  "/sign-up/email": "callbackURL",
  "/send-verification-email": "callbackURL",
  "/request-password-reset": "redirectTo",
};

function createAuth() {
  const env = getEnv();
  return betterAuth({
    appName: "SST — Session Stats Tracker",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
        rateLimit: authRateLimit,
      },
    }),
    user: {
      additionalFields: {
        // Set only through setLocaleAction (input: false → not writable via the auth API).
        locale: { type: "string", required: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      // No session until the email is verified (also makes duplicate sign-ups return Better
      // Auth's generic, enumeration-resistant response instead of "user already exists").
      requireEmailVerification: true,
      autoSignIn: false,
      sendResetPassword: sendResetPasswordEmailForAuth,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_TTL_SECONDS,
      // A reset signs the account out everywhere.
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        // The reset link reached this inbox: that proves ownership of the address too.
        if (!user.emailVerified) {
          await getDb()
            .update(authUser)
            .set({ emailVerified: true, updatedAt: new Date() })
            .where(eq(authUser.id, user.id));
        }
        logger.info("auth.password_reset", { userId: user.id });
      },
      // Duplicate sign-up: mirror the real response shape exactly (additional fields too).
      customSyntheticUser: ({ coreFields, id }) => ({ ...coreFields, locale: null, id }),
    },
    emailVerification: {
      sendVerificationEmail: sendVerificationEmailForAuth,
      sendOnSignUp: true,
      // Resending is an explicit, rate-limited action (not every sign-in attempt).
      sendOnSignIn: false,
      // The link only verifies; the user then signs in with their password. A forwarded or
      // leaked link never yields a session.
      autoSignInAfterVerification: false,
      expiresIn: EMAIL_VERIFICATION_TTL_SECONDS,
      afterEmailVerification: async (user) => {
        logger.info("auth.email_verified", { userId: user.id });
      },
    },
    // Reset tokens are stored hashed in auth_verification (email verification tokens are signed
    // JWTs and never stored).
    verification: { storeIdentifier: "hashed" },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const field = CALLBACK_FIELD[ctx.path];
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        if (field && !isAllowedAuthCallback(ctx.path, body[field])) {
          throw new APIError("BAD_REQUEST", {
            message: "Invalid callback",
            code: "INVALID_CALLBACK",
          });
        }
        const limit = EMAIL_SEND_LIMITS[ctx.path as keyof typeof EMAIL_SEND_LIMITS];
        if (limit && typeof body.email === "string") {
          const result = await rateLimit(
            `auth-email:${ctx.path.slice(1)}:${emailRateKey(body.email)}`,
            limit.max,
            limit.windowMs,
            { failClosed: true },
          );
          if (!result.ok) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Too many requests. Please try again later.",
              code: "TOO_MANY_REQUESTS",
            });
          }
        }
      }),
    },
    logger: { level: "warn", log: betterAuthLog },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      // Shared by all instances in production (SEC-002); per-process memory in dev/tests.
      storage: env.RATE_LIMIT_STORE === "postgres" ? "database" : "memory",
      modelName: "rateLimit",
      customRules: AUTH_RATE_LIMITS,
    },
    advanced: {
      useSecureCookies: env.APP_URL.startsWith("https://"),
      // Behind the deployment proxy, read the client IP from the header IT sets (SEC-013).
      ...(env.TRUST_PROXY ? { ipAddress: { ipAddressHeaders: [env.CLIENT_IP_HEADER] } } : {}),
    },
    // Must be last: lets server actions set auth cookies.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

interface AuthGlobal {
  __sf6Auth?: Auth;
}
const g = globalThis as AuthGlobal;

export function getAuth(): Auth {
  g.__sf6Auth ??= createAuth();
  return g.__sf6Auth;
}
