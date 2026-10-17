/**
 * GET /dashboard/analytics/review.pdf?range=…&mode=…[&character=…] — the SST review report
 * (Phase 6.4B), rendered on demand in-process with react-pdf (no browser, no storage). Only the
 * signed-in account's own analytics; the report language is the account / UI locale.
 */
import { getAuth } from "@/server/auth/auth";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/locale";
import { reviewPdfResponse } from "@/server/analytics/report/review-pdf-response";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return null; // malformed cookie ⇒ fall back to the default rule
    }
  }
  return null;
}

export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) {
    return new Response("unauthorized", {
      status: 401,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  // Same rule as every page: account preference → NEXT_LOCALE cookie → default (never
  // Accept-Language).
  const locale = resolveLocale({
    userLocale: session.user.locale ?? null,
    cookieLocale: cookieValue(request.headers.get("cookie"), LOCALE_COOKIE),
  });
  return reviewPdfResponse(getDb(), {
    userId: session.user.id,
    locale,
    searchParams: new URL(request.url).searchParams,
  });
}
