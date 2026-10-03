import { randomBytes } from "node:crypto";

/** 24 random bytes → 32 base64url chars (192 bits). Not derived from any internal id. */
export function generateOverlayToken(): string {
  return randomBytes(24).toString("base64url");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/** Cheap format check before touching the database (rejects probes early). */
export function isValidOverlayTokenFormat(token: string): boolean {
  return TOKEN_RE.test(token);
}
