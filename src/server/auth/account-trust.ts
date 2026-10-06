/**
 * Account trust (Phase 4.6, docs/auth.md): the pieces Better Auth's config plugs in.
 *
 *  - email callbacks: render the template and QUEUE delivery (never awaited by the auth
 *    response, never throw: a provider failure must not change what the client sees);
 *  - per-email rate-limit keys: keyed HMAC of the normalized address (no raw email stored);
 *  - redirect allowlist for the links Better Auth puts in emails;
 *  - a Better Auth logger adapter that redacts emails, URLs and tokens.
 */
import { createHmac } from "node:crypto";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "@/i18n/locale";
import { RESET_PASSWORD_CALLBACK, VERIFY_EMAIL_CALLBACK } from "@/lib/auth-paths";
import { queueTransactionalEmail } from "@/server/email/sender";
import { renderEmail, type EmailKind } from "@/server/email/templates";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

/** Verification and reset links live 60 minutes (Better Auth expiresIn values, in seconds). */
export const EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60;
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

/** The only callback paths the auth API accepts in emailed links (no open redirects). */
export { RESET_PASSWORD_CALLBACK, VERIFY_EMAIL_CALLBACK } from "@/lib/auth-paths";

/* ───────── email identity ───────── */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Non-reversible, keyed identifier for per-email limits. HMAC with a key derived from
 * BETTER_AUTH_SECRET, so the rate-limit table never holds (or lets anyone recompute) addresses.
 */
export function emailRateKey(email: string): string {
  return createHmac("sha256", `sst:email-rate-key:${getEnv().BETTER_AUTH_SECRET}`)
    .update(normalizeEmail(email))
    .digest("base64url")
    .slice(0, 32);
}

/* ───────── email callbacks ───────── */

function cookieLocale(request: Request | undefined): string | null {
  const header = request?.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LOCALE_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function emailLocale(user: { locale?: unknown }, request: Request | undefined): Locale {
  return resolveLocale({
    userLocale: typeof user.locale === "string" ? user.locale : null,
    cookieLocale: cookieLocale(request),
  });
}

function queueAuthEmail(
  kind: EmailKind,
  data: { user: { id: string; email: string; locale?: unknown }; url: string },
  request: Request | undefined,
  ttlSeconds: number,
): void {
  try {
    const rendered = renderEmail({
      kind,
      locale: emailLocale(data.user, request),
      url: data.url,
      expiresInMinutes: Math.round(ttlSeconds / 60),
    });
    queueTransactionalEmail({ ...rendered, to: data.user.email, kind, userId: data.user.id });
  } catch {
    // Rendering is pure and covered by tests; never let it surface to the auth response.
    logger.error("email.render_failed", { kind, userId: data.user.id });
  }
}

/** Better Auth `emailVerification.sendVerificationEmail`. Returns immediately. */
export async function sendVerificationEmailForAuth(
  data: { user: { id: string; email: string; locale?: unknown }; url: string },
  request?: Request,
): Promise<void> {
  queueAuthEmail("verify", data, request, EMAIL_VERIFICATION_TTL_SECONDS);
}

/** Better Auth `emailAndPassword.sendResetPassword`. Returns immediately. */
export async function sendResetPasswordEmailForAuth(
  data: { user: { id: string; email: string; locale?: unknown }; url: string },
  request?: Request,
): Promise<void> {
  queueAuthEmail("reset", data, request, PASSWORD_RESET_TTL_SECONDS);
}

/* ───────── redirects ───────── */

/**
 * Allowed callback for a given auth endpoint. Relative SST paths only; absolute URLs (even to
 * APP_URL), protocol-relative URLs and anything else are refused. Better Auth's own origin check
 * still applies on top.
 */
export function isAllowedAuthCallback(path: string, value: unknown): boolean {
  if (value === undefined) return true; // Better Auth then uses its default ("/")
  if (typeof value !== "string") return false;
  if (path === "/sign-up/email" || path === "/send-verification-email") {
    return value === VERIFY_EMAIL_CALLBACK;
  }
  if (path === "/request-password-reset") return value === RESET_PASSWORD_CALLBACK;
  return false;
}

/* ───────── logging ───────── */

const EMAIL_RE = /[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g;
const URL_RE = /https?:\/\/\S+/g;
const TOKEN_RE = /\b(token|callbackURL)=[^\s&]+/gi;

/** Removes addresses, URLs and token parameters from free-form log text. */
export function redactAuthLogText(text: string): string {
  return text
    .replace(URL_RE, "[url]")
    .replace(TOKEN_RE, "$1=[redacted]")
    .replace(EMAIL_RE, "[email]");
}

function describeArg(arg: unknown): unknown {
  if (arg instanceof Error) return { name: arg.name, message: redactAuthLogText(arg.message) };
  if (typeof arg === "string") return redactAuthLogText(arg);
  if (typeof arg === "number" || typeof arg === "boolean") return arg;
  return "[object]";
}

/** Better Auth `logger.log`: routes framework logs through SST's JSON logger, redacted. */
export function betterAuthLog(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  ...args: unknown[]
): void {
  logger[level]("auth.framework", {
    message: redactAuthLogText(message),
    ...(args.length > 0 ? { details: args.slice(0, 3).map(describeArg) } : {}),
  });
}
