/**
 * Which Session Tracker origins this build may talk to.
 *
 * MV3: an extension service worker only reaches an origin reliably when it holds a host
 * permission for it (otherwise the request depends on CORS and on browser policies such as
 * Local Network Access, which treat localhost specially). So the tracker origins are a CLOSED
 * allowlist fixed at build time and written into manifest.host_permissions — no wildcards, no
 * <all_urls>, and the popup cannot point the extension anywhere else.
 *
 *   dev build (default):  http://localhost:3000, http://127.0.0.1:3000 (+ COMPANION_TRACKER_ORIGINS)
 *   production build:     only COMPANION_TRACKER_ORIGINS (https) — see docs/companion.md
 */

export const DEV_TRACKER_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"] as const;
export const BUCKLER_HOST_PERMISSION = "https://www.streetfighter.com/6/buckler/*";

declare const __SF6_TRACKER_ORIGINS__: readonly string[] | undefined;

/** Injected by the build (esbuild `define`); dev origins when running unbundled (tests). */
export const TRACKER_ORIGINS: readonly string[] =
  typeof __SF6_TRACKER_ORIGINS__ !== "undefined" ? __SF6_TRACKER_ORIGINS__ : DEV_TRACKER_ORIGINS;

const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

/**
 * Canonical origin ("https://tracker.example.com") or an error. https only, except loopback
 * hosts which may use http for local development. No paths, credentials, wildcards.
 */
export function validateTrackerOrigin(
  input: string,
): { ok: true; origin: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, error: `not a URL: ${input}` };
  }
  if (input.includes("*")) return { ok: false, error: `wildcards are not allowed: ${input}` };
  if (url.username || url.password) return { ok: false, error: `credentials in URL: ${input}` };
  if (url.pathname !== "/" || url.search || url.hash) {
    return { ok: false, error: `must be an origin without path: ${input}` };
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    return { ok: false, error: `must be https (http only for localhost/127.0.0.1): ${input}` };
  }
  return { ok: true, origin: url.origin };
}

/** "https://a.example, https://b.example" → validated origins (throws listing every problem). */
export function parseTrackerOrigins(list: string | undefined): string[] {
  const items = (list ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const results = items.map(validateTrackerOrigin);
  const errors = results.flatMap((r) => (r.ok ? [] : [r.error]));
  if (errors.length > 0)
    throw new Error(`Invalid COMPANION_TRACKER_ORIGINS:\n  ${errors.join("\n  ")}`);
  return [...new Set(results.flatMap((r) => (r.ok ? [r.origin] : [])))];
}

/** host_permissions for the manifest: Buckler + one exact entry per tracker origin. */
export function hostPermissionsFor(origins: readonly string[]): string[] {
  return [BUCKLER_HOST_PERMISSION, ...origins.map((o) => `${o}/*`)];
}

/** The tracker URL the user picked → its origin, only if this build allows it. */
export function allowedTrackerOrigin(
  input: string,
  allowed: readonly string[] = TRACKER_ORIGINS,
): string | null {
  const v = validateTrackerOrigin(input);
  return v.ok && allowed.includes(v.origin) ? v.origin : null;
}
