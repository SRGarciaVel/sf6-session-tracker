/**
 * Selection of throwaway TEST accounts in a local development database (E2E/i18n runs create
 * `<random>@test.local` users through the dev server). Used by `pnpm dev:cleanup-test-accounts`.
 *
 * Rule: the address domain is EXACTLY `test.local`. Case-insensitive: Better Auth stores emails
 * lowercased (sign-up does `email.toLowerCase()`) and email domains are case-insensitive, so
 * `bar@TEST.LOCAL` is a test account too. The seeded demo account (demo@sf6.local) and any other
 * domain — including look-alikes such as `x@test.local.example.com` — are never selected.
 */
const TEST_ACCOUNT_EMAIL = /^[^@\s]+@test\.local$/i;

export function isTestAccountEmail(email: string): boolean {
  return TEST_ACCOUNT_EMAIL.test(email.trim());
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Refuse anything that is not clearly a local development database. */
export function assertLocalDevDatabase(env: {
  NODE_ENV: string;
  DATABASE_URL: string;
  APP_URL: string;
}): void {
  if (env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production");
  let dbHost: string;
  let appHost: string;
  try {
    dbHost = new URL(env.DATABASE_URL).hostname;
    appHost = new URL(env.APP_URL).hostname;
  } catch {
    throw new Error("DATABASE_URL / APP_URL are not valid URLs");
  }
  if (!LOCAL_HOSTS.has(dbHost)) {
    throw new Error(`Refusing to run: DATABASE_URL host "${dbHost}" is not local`);
  }
  if (!LOCAL_HOSTS.has(appHost)) {
    throw new Error(`Refusing to run: APP_URL host "${appHost}" is not local`);
  }
}
