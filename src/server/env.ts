/**
 * Typed, validated server environment. Read lazily so `next build` can import modules without
 * a database configured. Never import this from client components.
 */
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const int = (def: number, min = 0) => z.coerce.number().int().min(min).default(def);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  TRUST_PROXY: bool,

  SF6_PROVIDER: z.enum(["mock", "capcom", "companion"]).default("mock"),
  PROVIDER_TIMEOUT_MS: int(10_000, 1_000),
  PROVIDER_CACHE_TTL_MS: int(5_000),
  ENABLE_DEV_TOOLS: bool,
  // Capcom provider (prototype; only read when SF6_PROVIDER=capcom)
  CAPCOM_BASE_URL: z.string().url().default("https://www.streetfighter.com/6/buckler"),
  /** Cookie-Editor JSON export of a HUMAN Buckler login, stored outside the repo. Optional. */
  CAPCOM_SESSION_FILE: z.string().trim().min(1).optional(),
  CAPCOM_MAX_BATTLELOG_PAGES: int(3, 1),
  CAPCOM_BUILD_ID_TTL_MS: int(1_800_000, 60_000),
  // Browser companion (SF6_PROVIDER=companion): max age of the pushed snapshot for start/end.
  COMPANION_SNAPSHOT_MAX_AGE_MS: int(300_000, 30_000),
  /** Optional public download link for the beta companion ZIP, shown on /help/companion. */
  COMPANION_DOWNLOAD_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "must be https")
    .optional(),
  /**
   * Newest published companion version (e.g. 0.1.1), set after each "Release Companion Beta".
   * Drives the dashboard's update notice. Invalid values are ignored (logged), never fatal.
   */
  COMPANION_LATEST_VERSION: z.string().trim().min(1).optional(),
  /**
   * Server-only secret for Creator Keys: keys are stored as HMAC-SHA-256(pepper, key), never in
   * plaintext (docs/creator-keys.md). Required in production. Stable: rotating it makes every
   * unredeemed key unusable. Generate with `openssl rand -hex 32`.
   */
  CREATOR_KEY_PEPPER: z
    .string()
    .min(32, "CREATOR_KEY_PEPPER must be at least 32 characters")
    .optional(),

  /**
   * Transactional email (docs/auth.md). resend = real delivery (REQUIRED in production);
   * log = development only (the link is printed to the server console); memory = tests (an
   * in-process outbox, nothing leaves the machine). Default: resend in production, log in
   * development, memory in tests.
   */
  EMAIL_PROVIDER: z.enum(["resend", "log", "memory"]).optional(),
  /** Resend API key (server-only). Required when EMAIL_PROVIDER=resend. Never logged. */
  RESEND_API_KEY: z.string().trim().min(1).optional(),
  /** Sender, e.g. `SST <no-reply@your-verified-domain>`. Must be a domain verified in Resend. */
  EMAIL_FROM: z.string().trim().min(3).optional(),
  /** Optional Reply-To (e.g. a monitored support inbox). */
  EMAIL_REPLY_TO: z.string().trim().email().optional(),

  TRACKER_POLL_INTERVAL_MS: int(20_000, 5_000),
  TRACKER_POLL_JITTER_MS: int(3_000),
  TRACKER_BACKOFF_BASE_MS: int(30_000, 1_000),
  TRACKER_BACKOFF_MAX_MS: int(300_000, 1_000),
  TRACKER_PROFILE_REFRESH_MS: int(300_000, 10_000),
  TRACKER_LEASE_MS: int(60_000, 10_000),
  WORKER_TICK_MS: int(1_000, 100),
  WORKER_CONCURRENCY: int(10, 1),
  /**
   * Where the tracking scheduler runs. standalone = its own process (`pnpm start:worker`, split
   * deploy; default). embedded = inside the Next.js server process (single free web service).
   * Explicit on purpose: never derived from NODE_ENV.
   */
  TRACKER_RUNTIME_MODE: z.enum(["standalone", "embedded"]).default("standalone"),
  SESSION_START_GRACE_SECONDS: int(90),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  /**
   * memory = per process (dev/tests). postgres = shared by all instances (production default:
   * in-memory limits are N× looser and evadable across serverless instances — SEC-003).
   */
  RATE_LIMIT_STORE: z.enum(["memory", "postgres"]).optional(),
  /**
   * Header carrying the client IP set by YOUR proxy (only read when TRUST_PROXY=true).
   * x-forwarded-for → its RIGHTMOST entry (the one appended by the nearest proxy).
   * Vercel: x-real-ip or x-vercel-forwarded-for.
   */
  CLIENT_IP_HEADER: z.string().trim().toLowerCase().default("x-forwarded-for"),
});

export type Env = Omit<z.infer<typeof envSchema>, "RATE_LIMIT_STORE" | "EMAIL_PROVIDER"> & {
  RATE_LIMIT_STORE: "memory" | "postgres";
  EMAIL_PROVIDER: "resend" | "log" | "memory";
};

/** `Name <local@domain>` or `local@domain`; returns the address part or null. */
export function emailFromAddress(from: string): string | null {
  const match = /^(?:[^<>]{1,80}<([^<>\s]+@[^<>\s]+)>|([^<>\s]+@[^<>\s]+))$/.exec(from.trim());
  const address = match?.[1] ?? match?.[2] ?? null;
  return address && z.string().email().safeParse(address).success ? address : null;
}

/** Example/placeholder sender domains that can never be verified in a provider. */
const PLACEHOLDER_EMAIL_DOMAIN =
  /@(example\.(com|org|net)|your[-_]?(verified[-_]?)?domain[^>]*|localhost)\b/i;

/** Placeholder secrets that must never reach production (they are public in the repo). */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "change-me-to-a-long-random-string-0123456789",
  "test-secret-at-least-32-characters-long-xx",
]);

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }
  const data = parsed.data;
  if (data.NODE_ENV === "production") {
    // SEC-006: a secret copied from .env.example is public — refuse to boot with it.
    if (
      KNOWN_PLACEHOLDER_SECRETS.has(data.BETTER_AUTH_SECRET) ||
      /change-me/i.test(data.BETTER_AUTH_SECRET)
    ) {
      throw new Error(
        "Invalid environment configuration:\n  - BETTER_AUTH_SECRET: placeholder value; generate one with `openssl rand -base64 32`",
      );
    }
  }
  if (data.NODE_ENV === "production") {
    if (!data.CREATOR_KEY_PEPPER) {
      throw new Error(
        "Invalid environment configuration:\n  - CREATOR_KEY_PEPPER: required in production; generate one with `openssl rand -hex 32`",
      );
    }
    if (/change-me|dev-only|not-a-secret/i.test(data.CREATOR_KEY_PEPPER)) {
      throw new Error(
        "Invalid environment configuration:\n  - CREATOR_KEY_PEPPER: placeholder value; generate one with `openssl rand -hex 32`",
      );
    }
  }
  const emailProvider =
    data.EMAIL_PROVIDER ??
    (data.NODE_ENV === "production" ? "resend" : data.NODE_ENV === "test" ? "memory" : "log");
  const emailIssues: string[] = [];
  if (data.NODE_ENV === "production" && emailProvider !== "resend") {
    // Account verification and password reset depend on real delivery: fail closed.
    emailIssues.push("EMAIL_PROVIDER: must be `resend` in production");
  }
  if (emailProvider === "resend") {
    if (!data.RESEND_API_KEY)
      emailIssues.push("RESEND_API_KEY: required when EMAIL_PROVIDER=resend");
    else if (
      !/^re_[A-Za-z0-9_]{8,}$/.test(data.RESEND_API_KEY) ||
      /change-me|placeholder|xxxx/i.test(data.RESEND_API_KEY)
    ) {
      emailIssues.push("RESEND_API_KEY: not a valid Resend API key (expected re_…)");
    }
    if (!data.EMAIL_FROM) emailIssues.push("EMAIL_FROM: required when EMAIL_PROVIDER=resend");
    else if (!emailFromAddress(data.EMAIL_FROM)) {
      emailIssues.push("EMAIL_FROM: expected `Name <address@domain>` or `address@domain`");
    } else if (data.NODE_ENV === "production" && PLACEHOLDER_EMAIL_DOMAIN.test(data.EMAIL_FROM)) {
      emailIssues.push("EMAIL_FROM: placeholder domain; use a sender domain verified in Resend");
    }
  }
  if (emailIssues.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${emailIssues.map((i) => `  - ${i}`).join("\n")}`,
    );
  }
  cached = {
    ...data,
    EMAIL_PROVIDER: emailProvider,
    RATE_LIMIT_STORE:
      data.RATE_LIMIT_STORE ?? (data.NODE_ENV === "production" ? "postgres" : "memory"),
  };
  return cached;
}

/** Dev tools are only ever available outside production, with the mock provider, when opted in. */
export function devToolsEnabled(): boolean {
  const env = getEnv();
  return env.NODE_ENV !== "production" && env.ENABLE_DEV_TOOLS && env.SF6_PROVIDER === "mock";
}
