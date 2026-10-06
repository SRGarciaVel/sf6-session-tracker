/**
 * Creator Key format and keyed hashing (docs/creator-keys.md).
 *
 *   SST-XXXX-XXXX-XXXX-XXXX-XXXX   20 Crockford Base32 chars = 100 bits from the CSPRNG
 *
 * Stored as HMAC-SHA-256(CREATOR_KEY_PEPPER, body), never in plaintext. A keyed hash (not a
 * password hash) is right here: keys have 100 bits of entropy and are looked up directly; the
 * pepper means a database leak alone cannot confirm or enumerate keys.
 */
import { createHmac, randomBytes } from "node:crypto";

/** Crockford Base32: no I, L, O, U, so no ambiguous characters to "correct" on input. */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CREATOR_KEY_BODY_LENGTH = 20;
const GROUPS = 5;
const FORMAT = /^SST(?:-[0-9A-HJKMNP-TV-Z]{4}){5}$/;
const HMAC_CONTEXT = "sst:creator-key:v1:";

/** A fresh key. 32 symbols = 5 bits: `byte & 31` is exactly uniform (256 / 32 = 8). */
export function generateCreatorKey(): string {
  const bytes = randomBytes(CREATOR_KEY_BODY_LENGTH);
  let body = "";
  for (const b of bytes) body += CROCKFORD_ALPHABET[b & 31];
  const groups = Array.from({ length: GROUPS }, (_, i) => body.slice(i * 4, i * 4 + 4));
  return `SST-${groups.join("-")}`;
}

/**
 * The only accepted input transformation: trim and uppercase. Returns the 20-character body,
 * or null for anything not in the exact format (callers answer with the same generic error).
 */
export function normalizeCreatorKey(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 64) return null;
  const candidate = input.trim().toUpperCase();
  if (!FORMAT.test(candidate)) return null;
  return candidate.slice(4).replaceAll("-", "");
}

/** HMAC-SHA-256 of a normalized key body (32 bytes, stored as bytea). */
export function hashCreatorKey(body: string, pepper: string): Buffer {
  return createHmac("sha256", pepper)
    .update(HMAC_CONTEXT + body)
    .digest();
}

/** Non-secret hint for operators and support: the last 4 characters. */
export function creatorKeyHint(body: string): string {
  return body.slice(-4);
}

/** "••••-ABCD" for display. */
export const formatKeyHint = (hint: string): string => `••••-${hint}`;
