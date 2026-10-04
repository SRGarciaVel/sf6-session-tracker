/**
 * Buckler URL builders + response classification. Pure: shared by the server client and the
 * browser companion so both request exactly the HAR-observed endpoints.
 */

export const BUCKLER_ORIGIN = "https://www.streetfighter.com";
export const BUCKLER_BASE_PATH = "/6/buckler";

export const bucklerPaths = {
  profile: (cfnId: string) => `${BUCKLER_BASE_PATH}/profile/${encodeURIComponent(cfnId)}`,
  card: (cfnId: string) => `${BUCKLER_BASE_PATH}/api/en/card/${encodeURIComponent(cfnId)}`,
  play: (buildId: string, cfnId: string) =>
    `${BUCKLER_BASE_PATH}/_next/data/${encodeURIComponent(buildId)}/en/profile/${encodeURIComponent(cfnId)}/play.json?sid=${encodeURIComponent(cfnId)}`,
  /** Page 1 without `page` (as the site does), page N with `page=N`. */
  battlelog: (buildId: string, cfnId: string, page = 1) => {
    if (!Number.isInteger(page) || page < 1) throw new RangeError(`invalid battlelog page ${page}`);
    const id = encodeURIComponent(cfnId);
    const qs = page === 1 ? `sid=${id}` : `page=${page}&sid=${id}`;
    return `${BUCKLER_BASE_PATH}/_next/data/${encodeURIComponent(buildId)}/en/profile/${id}/battlelog.json?${qs}`;
  },
};

export type BucklerFailure =
  "login_required" | "blocked" | "rate_limited" | "not_found" | "unavailable" | "invalid_response";

/**
 * Classify a non-JSON / error answer from Buckler. Evidence:
 *  - logged-out profile page = 403 whose body is Buckler's own app ("must log in", __NEXT_DATA__);
 *  - WAF block = 403 CloudFront error page ("Request blocked" / "could not be satisfied");
 *  - Next.js gSSP redirects in _next/data appear as `pageProps.__N_REDIRECT`.
 */
export function classifyBucklerFailure(status: number, bodyText: string): BucklerFailure {
  if (status === 429) return "rate_limited";
  if (status === 404) return "not_found";
  if (/must log in|log in to use|__N_REDIRECT/i.test(bodyText)) return "login_required";
  if (status === 401) return "login_required";
  if (status === 403) {
    return /request blocked|could not be satisfied|cloudfront/i.test(bodyText)
      ? "blocked"
      : "login_required";
  }
  if (status >= 500) return "unavailable";
  return "invalid_response";
}
