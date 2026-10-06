/**
 * Client helpers for the auth screens (Phase 4.6). No secrets: the pending address lives only in
 * this tab's sessionStorage (never in the URL) so the "check your email" screen can show it
 * masked and resend to it.
 */
export { RESET_PASSWORD_CALLBACK, VERIFY_EMAIL_CALLBACK } from "@/lib/auth-paths";
/** Client-side pause between resends; the server enforces its own limits regardless. */
export const RESEND_COOLDOWN_SECONDS = 60;

const PENDING_EMAIL_KEY = "sst:pending-verification-email";

/** "streamer@example.com" → "st***@example.com" (never reveals more than 2 characters). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length - 1) || 1)}***${email.slice(at)}`;
}

export function rememberPendingEmail(email: string): void {
  try {
    sessionStorage.setItem(PENDING_EMAIL_KEY, email);
  } catch {
    // storage unavailable: the screen falls back to asking for the address
  }
}

export function readPendingEmail(): string | null {
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
}

export type AuthErrorKey =
  | "invalidCredentials"
  | "passwordTooShort"
  | "passwordTooLong"
  | "invalidEmail"
  | "tooManyRequests"
  | "emailNotVerified"
  | "generic";

/** Better Auth returns English messages; map its codes to our translations (never shown raw). */
export function authErrorKey(error: { code?: string; status?: number }): AuthErrorKey {
  const code = error.code ?? "";
  if (error.status === 429 || code === "TOO_MANY_REQUESTS") return "tooManyRequests";
  if (code === "EMAIL_NOT_VERIFIED") return "emailNotVerified";
  if (code.includes("INVALID_EMAIL_OR_PASSWORD") || code.includes("INVALID_PASSWORD")) {
    return "invalidCredentials";
  }
  if (code.includes("PASSWORD_TOO_SHORT")) return "passwordTooShort";
  if (code.includes("PASSWORD_TOO_LONG")) return "passwordTooLong";
  if (code.includes("INVALID_EMAIL")) return "invalidEmail";
  return "generic";
}
