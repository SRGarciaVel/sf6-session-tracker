/**
 * The only SST pages the auth API may send users back to from an emailed link (Phase 4.6).
 * Shared by the auth screens (client) and the server-side allowlist (account-trust.ts).
 */
export const VERIFY_EMAIL_CALLBACK = "/verify-email/result";
export const RESET_PASSWORD_CALLBACK = "/reset-password";
