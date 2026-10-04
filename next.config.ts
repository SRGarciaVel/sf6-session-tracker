import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Locale comes from the user preference (cookie / account), not from the URL: overlay URLs stay stable.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isDev = process.env.NODE_ENV !== "production";
const httpsApp = (process.env.APP_URL ?? "").startsWith("https://");

/**
 * Content-Security-Policy per surface (SEC-005). Everything is self-hosted (next/font, no CDNs).
 * Next's App Router bootstraps with inline scripts, so script-src keeps 'unsafe-inline' (a
 * nonce-based CSP would need a request proxy and fully dynamic rendering); the policy still
 * forbids external scripts, plugins, <base> hijacking, foreign form targets and framing.
 * Dev adds 'unsafe-eval' + ws: for React Refresh/HMR only.
 */
function csp({ frameable }: { frameable: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // OBS Browser Source loads the overlay top-level; some stream tools embed it in an iframe.
    frameable ? "frame-ancestors *" : "frame-ancestors 'none'",
    ...(httpsApp ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev badge would show up inside OBS while testing overlays locally.
  devIndicators: false,

  async headers() {
    return [
      {
        // Everything except the OBS overlay: no framing, conservative referrer, own CSP.
        source: "/((?!overlay/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: csp({ frameable: false }) },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        // OBS overlay: same CSP but embeddable (no X-Frame-Options, frame-ancestors *).
        source: "/overlay/:token*",
        headers: [{ key: "Content-Security-Policy", value: csp({ frameable: true }) }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(httpsApp
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
            : []),
        ],
      },
      {
        // Public overlay pages: dynamic state must never be cached by OBS/CEF or proxies, and the
        // secret token in the URL must not leak via Referer or search engines.
        source: "/overlay/:token*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
