/**
 * Buckler URL builders, Next.js page metadata and response classification. Pure: shared by the
 * server client and the browser companion so both request exactly the observed endpoints.
 *
 * Locale: Buckler is a Next.js (Pages Router) app with i18n. `_next/data` URLs carry the page
 * locale: /_next/data/{buildId}/{locale}/profile/{cfn}/play.json. The HAR was captured with
 * locale "en" (the default); a user browsing /6/buckler/es-es/... gets locale "es-es". The
 * locale is read from the page itself (__NEXT_DATA__.locale), never guessed.
 */

export const BUCKLER_ORIGIN = "https://www.streetfighter.com";
export const BUCKLER_BASE_PATH = "/6/buckler";

/** __NEXT_DATA__.locales observed in the HAR (2026-10-03). Informational; the page is the source. */
export const BUCKLER_LOCALES = [
  "en",
  "ja-jp",
  "fr",
  "de",
  "it",
  "es-es",
  "ru",
  "pl",
  "pt-br",
  "ko-kr",
  "zh-hant",
  "zh-hans",
  "ar",
  "es-us",
] as const;
export const BUCKLER_DEFAULT_LOCALE = "en";

const LOCALE_RE = /^[a-z]{2}(?:-[a-z]{2,4})?$/;
export const isLocaleLike = (s: string): boolean => LOCALE_RE.test(s);

const seg = (s: string) => encodeURIComponent(s);
const checkLocale = (locale: string) => {
  if (!isLocaleLike(locale)) throw new RangeError(`invalid Buckler locale "${locale}"`);
  return locale;
};

export const bucklerPaths = {
  /** Without a locale prefix the server picks the user's locale (and may redirect). */
  profile: (cfnId: string) => `${BUCKLER_BASE_PATH}/profile/${seg(cfnId)}`,
  card: (cfnId: string) => `${BUCKLER_BASE_PATH}/api/en/card/${seg(cfnId)}`,
  play: (buildId: string, cfnId: string, locale: string = BUCKLER_DEFAULT_LOCALE) =>
    `${BUCKLER_BASE_PATH}/_next/data/${seg(buildId)}/${checkLocale(locale)}/profile/${seg(cfnId)}/play.json?sid=${seg(cfnId)}`,
  /** Page 1 without `page` (as the site does), page N with `page=N`. */
  battlelog: (
    buildId: string,
    cfnId: string,
    page = 1,
    locale: string = BUCKLER_DEFAULT_LOCALE,
  ) => {
    if (!Number.isInteger(page) || page < 1) throw new RangeError(`invalid battlelog page ${page}`);
    const qs = page === 1 ? `sid=${seg(cfnId)}` : `page=${page}&sid=${seg(cfnId)}`;
    return `${BUCKLER_BASE_PATH}/_next/data/${seg(buildId)}/${checkLocale(locale)}/profile/${seg(cfnId)}/battlelog.json?${qs}`;
  },
};

/**
 * Headers Buckler's own Next.js router sends with every `_next/data` fetch (HAR: play.json and
 * battlelog.json were requested with `x-nextjs-data: 1`; every other header was browser-generated).
 * It is Next.js' data-request protocol header, not an identity header.
 */
export const NEXT_DATA_REQUEST_HEADERS: Readonly<Record<string, string>> = { "x-nextjs-data": "1" };

/* ───────── Next.js page metadata ───────── */

export interface BucklerPageMeta {
  buildId: string;
  /** Locale of the page that was loaded (drives the _next/data URLs). */
  locale: string;
  defaultLocale: string | null;
  locales: string[];
}

const BUILD_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/** Parse a __NEXT_DATA__ JSON text. Null when unusable. */
export function pageMetaFromNextData(json: string, pathname?: string): BucklerPageMeta | null {
  let nd: unknown;
  try {
    nd = JSON.parse(json);
  } catch {
    return null;
  }
  if (!nd || typeof nd !== "object") return null;
  const o = nd as Record<string, unknown>;
  const buildId = typeof o.buildId === "string" && BUILD_ID_RE.test(o.buildId) ? o.buildId : null;
  if (!buildId) return null;
  const locales = Array.isArray(o.locales)
    ? o.locales.filter((l): l is string => typeof l === "string" && isLocaleLike(l))
    : [];
  const defaultLocale =
    typeof o.defaultLocale === "string" && isLocaleLike(o.defaultLocale) ? o.defaultLocale : null;
  const declared = typeof o.locale === "string" && isLocaleLike(o.locale) ? o.locale : null;
  const locale =
    declared ??
    (pathname ? localeFromPathname(pathname, locales) : null) ??
    defaultLocale ??
    BUCKLER_DEFAULT_LOCALE;
  return { buildId, locale, defaultLocale, locales };
}

/** Page metadata from a Buckler HTML document. */
export function extractPageMeta(html: string, pathname?: string): BucklerPageMeta | null {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  return m?.[1] ? pageMetaFromNextData(m[1], pathname) : null;
}

/**
 * "/6/buckler/es-es/profile/1" → "es-es"; "/6/buckler/profile/1" → null (= default locale).
 * Only accepts a segment that is one of the page's declared locales (or the observed list).
 */
export function localeFromPathname(
  pathname: string,
  locales: readonly string[] = BUCKLER_LOCALES,
): string | null {
  const rest = pathname.startsWith(`${BUCKLER_BASE_PATH}/`)
    ? pathname.slice(BUCKLER_BASE_PATH.length + 1)
    : pathname.replace(/^\//, "");
  const first = rest.split("/")[0] ?? "";
  return locales.includes(first) ? first : null;
}

/* ───────── response classification (structural signals only) ───────── */

export type BucklerFailure =
  | "login_required"
  | "locale_mismatch"
  | "blocked"
  | "rate_limited"
  | "not_found"
  | "unavailable"
  | "invalid_response";

/** Safe, non-sensitive description of a Buckler answer (no body, no values, no cookies). */
export interface BucklerResponseSignature {
  status: number;
  contentType: string | null;
  bytes: number;
  json: boolean;
  /** Top-level JSON keys / pageProps keys (names only). */
  keys: string[];
  pagePropsKeys: string[];
  /** Serialized size of each pageProps entry (bytes) — tells an empty `play` from a real one. */
  pagePropsSizes: Record<string, number>;
  /** Key NAMES inside object-valued pageProps entries (e.g. play, fighter_banner_info). */
  nestedKeys: Record<string, string[]>;
  /**
   * Buckler's own server-side verdict in pageProps.common (numbers/booleans only):
   * statusCode (200 ok, 400/404 error page), isError, loginUser.flg (session seen as logged in).
   */
  common: {
    statusCode: number | null;
    isError: boolean | null;
    loginUserFlg: boolean | null;
  } | null;
  /** Numeric/boolean values of code-like keys (…code, …status, …result, error…) at depth ≤ 2. */
  codes: Record<string, number | boolean>;
  /** Path of a Next.js gSSP redirect (`pageProps.__N_REDIRECT`), query stripped. */
  redirectPath: string | null;
  /** HTML: does it carry Buckler's own __NEXT_DATA__ (app page) and which Next page. */
  hasNextData: boolean;
  nextPage: string | null;
  /** HTML <title>, truncated. */
  title: string | null;
}

export function describeBucklerResponse(
  status: number,
  contentType: string | null,
  body: string,
): BucklerResponseSignature {
  const sig: BucklerResponseSignature = {
    status,
    contentType: contentType?.split(";")[0]?.trim() ?? null,
    bytes: body.length,
    json: false,
    keys: [],
    pagePropsKeys: [],
    pagePropsSizes: {},
    nestedKeys: {},
    codes: {},
    common: null,
    redirectPath: null,
    hasNextData: false,
    nextPage: null,
    title: null,
  };
  try {
    const data: unknown = JSON.parse(body);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      sig.json = true;
      const o = data as Record<string, unknown>;
      sig.keys = Object.keys(o).slice(0, 12);
      const pp = o.pageProps;
      if (pp && typeof pp === "object" && !Array.isArray(pp)) {
        const p = pp as Record<string, unknown>;
        sig.pagePropsKeys = Object.keys(p).slice(0, 16);
        if (typeof p.__N_REDIRECT === "string")
          sig.redirectPath = p.__N_REDIRECT.split("?")[0] ?? null;
        for (const [k, v] of Object.entries(p)) {
          if (k === "__namespaces") continue;
          sig.pagePropsSizes[k] = JSON.stringify(v ?? null).length;
          if (v && typeof v === "object" && !Array.isArray(v)) {
            sig.nestedKeys[k] = Object.keys(v).slice(0, 12);
          }
        }
        collectCodes(p, "pageProps", 0, sig.codes);
        const common = p.common;
        if (common && typeof common === "object" && !Array.isArray(common)) {
          const c = common as Record<string, unknown>;
          const login = c.loginUser as Record<string, unknown> | undefined;
          sig.common = {
            statusCode: typeof c.statusCode === "number" ? c.statusCode : null,
            isError: typeof c.isError === "boolean" ? c.isError : null,
            loginUserFlg: login && typeof login.flg === "boolean" ? login.flg : null,
          };
        }
      }
    }
  } catch {
    const nd = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(body);
    sig.hasNextData = Boolean(nd);
    if (nd?.[1]) {
      const page = /"page"\s*:\s*"([^"]{1,80})"/.exec(nd[1]);
      sig.nextPage = page?.[1] ?? null;
    }
    const title = /<title[^>]*>([^<]{0,200})<\/title>/i.exec(body);
    sig.title = title?.[1]?.trim().slice(0, 80) ?? null;
  }
  return sig;
}

const CODE_KEY = /(^|_)(code|status|result|error|err)(_|$)|^(error|code|status|result)/i;

function collectCodes(
  obj: Record<string, unknown>,
  path: string,
  depth: number,
  out: Record<string, number | boolean>,
): void {
  for (const [k, v] of Object.entries(obj)) {
    if (k === "__namespaces" || Object.keys(out).length >= 12) continue;
    if ((typeof v === "number" || typeof v === "boolean") && CODE_KEY.test(k)) {
      out[`${path}.${k}`] = v;
    } else if (v && typeof v === "object" && !Array.isArray(v) && depth < 2) {
      collectCodes(v as Record<string, unknown>, `${path}.${k}`, depth + 1, out);
    }
  }
}

const LOGIN_PATH = /auth|login|signin|sign-in/i;

/**
 * Classify a failed Buckler answer using STRUCTURE only.
 *
 * Never text-match "must log in": that sentence is a translation string
 * (`[t]not_registered_register`) embedded in EVERY Buckler page and _next/data JSON, including
 * successful logged-in ones — matching it labelled every error as login_required.
 *
 * Evidence: logged-out profile page = 403 whose body is Buckler's own app (__NEXT_DATA__);
 * WAF block = 403 CloudFront page without __NEXT_DATA__; gSSP redirects = pageProps.__N_REDIRECT.
 */
export function classifyBucklerFailure(
  sig: BucklerResponseSignature,
  context: { requestedLocale?: string; pageLocale?: string } = {},
): BucklerFailure {
  const { status } = sig;
  if (status === 429) return "rate_limited";
  if (sig.redirectPath !== null) {
    if (LOGIN_PATH.test(sig.redirectPath)) return "login_required";
    const target = localeFromPathname(sig.redirectPath);
    if (target && context.requestedLocale && target !== context.requestedLocale) {
      return "locale_mismatch";
    }
    return "invalid_response";
  }
  if (status === 401) return "login_required";
  // Observed: logged-out = Buckler app page (has __NEXT_DATA__); WAF = CloudFront page (none).
  if (status === 403) return sig.hasNextData ? "login_required" : "blocked";
  if (status === 404) return "not_found";
  if (status >= 500) return "unavailable";
  if (
    status === 400 &&
    context.requestedLocale &&
    context.pageLocale &&
    context.requestedLocale !== context.pageLocale
  ) {
    return "locale_mismatch";
  }
  return "invalid_response";
}
