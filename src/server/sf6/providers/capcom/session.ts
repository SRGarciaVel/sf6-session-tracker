/**
 * Human-exported Buckler session (Cookie-Editor JSON export), read from CAPCOM_SESSION_FILE.
 *
 * Policy: the login is done by a human in a normal browser and exported manually. Nothing here
 * logs in, refreshes or solves anything. Cookie VALUES are never logged — only names/expiry.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

const exportedCookieSchema = z.looseObject({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string(),
  expirationDate: z.number().optional(),
});

export interface CapcomSessionSummary {
  cookieNames: string[];
  expiredNames: string[];
}

export interface CapcomSession {
  /** Value for the `cookie` request header. Secret: never log it. */
  cookieHeader: string | null;
  summary: CapcomSessionSummary;
}

/** Pure: Cookie-Editor JSON → cookie header (streetfighter.com cookies that have not expired). */
export function cookieHeaderFromExport(raw: unknown, nowMs: number = Date.now()): CapcomSession {
  const parsed = z.array(exportedCookieSchema).safeParse(raw);
  if (!parsed.success) {
    throw new Error("CAPCOM_SESSION_FILE is not a Cookie-Editor JSON export (array of cookies)");
  }
  const relevant = parsed.data.filter((c) =>
    /(^|\.)streetfighter\.com$/.test(c.domain.replace(/^\./, "")),
  );
  const expired = relevant.filter(
    (c) => c.expirationDate !== undefined && c.expirationDate * 1000 <= nowMs,
  );
  const valid = relevant.filter((c) => !expired.includes(c));
  return {
    cookieHeader: valid.length > 0 ? valid.map((c) => `${c.name}=${c.value}`).join("; ") : null,
    summary: { cookieNames: valid.map((c) => c.name), expiredNames: expired.map((c) => c.name) },
  };
}

/** Read once at provider construction. Throws (without any cookie value) if unreadable. */
export function loadCapcomSession(path: string): CapcomSession {
  const text = readFileSync(path, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // SyntaxError messages quote the input — which here is secret. Report without it.
    throw new Error("CAPCOM_SESSION_FILE is not valid JSON");
  }
  return cookieHeaderFromExport(raw);
}
