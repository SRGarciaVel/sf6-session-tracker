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

  TRACKER_POLL_INTERVAL_MS: int(20_000, 5_000),
  TRACKER_POLL_JITTER_MS: int(3_000),
  TRACKER_BACKOFF_BASE_MS: int(30_000, 1_000),
  TRACKER_BACKOFF_MAX_MS: int(300_000, 1_000),
  TRACKER_PROFILE_REFRESH_MS: int(300_000, 10_000),
  TRACKER_LEASE_MS: int(60_000, 10_000),
  WORKER_TICK_MS: int(1_000, 100),
  WORKER_CONCURRENCY: int(10, 1),
  SESSION_START_GRACE_SECONDS: int(90),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}

/** Dev tools are only ever available outside production, with the mock provider, when opted in. */
export function devToolsEnabled(): boolean {
  const env = getEnv();
  return env.NODE_ENV !== "production" && env.ENABLE_DEV_TOOLS && env.SF6_PROVIDER === "mock";
}
