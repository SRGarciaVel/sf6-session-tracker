/**
 * Authentication (better-auth, email + password, sessions stored in Postgres).
 * Created lazily so importing route modules at build time doesn't require env vars.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/server/db/client";
import {
  authAccount,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
} from "@/server/db/schema";
import { getEnv } from "@/server/env";

function createAuth() {
  const env = getEnv();
  return betterAuth({
    appName: "SF6 Session Tracker",
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
      autoSignIn: true,
    },
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
