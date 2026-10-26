/**
 * M2C — client side of the review PDF export. A download link cannot see the response status, so
 * a refused export (429 / 503 …) showed up only as the browser's "download failed". The export now
 * runs as a same-origin fetch (same cookies, same route, same server limits) and:
 *   - maps the status to OUR localized message (the response body is never shown: untrusted);
 *   - accepts a success only when it is really a PDF (content type AND the %PDF- signature), so an
 *     error page is never saved as a .pdf;
 *   - keeps the server's filename only when it is a plain, safe `*.pdf` name.
 * Pure helpers here; the component owns state, the object URL and cleanup.
 */

/** Used when the server sends no usable filename. */
export const FALLBACK_PDF_FILENAME = "sst-review.pdf";

/** Message keys under `Analytics.reviewReport` (es/en catalogs). */
export type ExportError =
  | { key: "export.rateLimited" }
  | { key: "export.rateLimitedSeconds" | "export.rateLimitedMinutes"; count: number }
  | { key: "errors.busy" }
  | { key: "errors.noSignals" }
  | { key: "export.sessionExpired" }
  | { key: "export.failed" }
  | { key: "export.network" }
  | { key: "export.invalid" };

const MAX_RETRY_SECONDS = 24 * 60 * 60;

/** Retry-After as delay-seconds only (what the route sends); anything else ⇒ unknown. */
export function retryAfterSeconds(header: string | null): number | null {
  if (header === null || !/^\s*\d+\s*$/.test(header)) return null;
  const seconds = Number(header);
  return seconds > 0 && seconds <= MAX_RETRY_SECONDS ? seconds : null;
}

/**
 * The localized message for a refused / failed export, from the status (never the body). A 429
 * has two server causes — this account's export already in progress (`subject_busy`) or the
 * account quota — that the client cannot tell apart, so its message names both.
 */
export function exportErrorFor(status: number, retryAfter: string | null): ExportError {
  if (status === 429) {
    const seconds = retryAfterSeconds(retryAfter);
    if (seconds === null) return { key: "export.rateLimited" };
    return seconds < 60
      ? { key: "export.rateLimitedSeconds", count: seconds }
      : { key: "export.rateLimitedMinutes", count: Math.ceil(seconds / 60) };
  }
  if (status === 503) return { key: "errors.busy" };
  if (status === 409) return { key: "errors.noSignals" };
  if (status === 401) return { key: "export.sessionExpired" };
  return { key: "export.failed" };
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.pdf$/;

/**
 * The server's filename from Content-Disposition (`filename*=UTF-8''…` preferred, else
 * `filename="…"`), only if it is a plain `*.pdf` name: no paths, quotes, control or exotic
 * characters. Otherwise the safe fallback.
 */
export function pdfFilenameFrom(contentDisposition: string | null): string {
  if (!contentDisposition) return FALLBACK_PDF_FILENAME;
  let name: string | null = null;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(contentDisposition);
  if (extended?.[1]) {
    try {
      name = decodeURIComponent(extended[1].trim());
    } catch {
      name = null;
    }
  }
  if (name === null) {
    const plain = /filename\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(contentDisposition);
    name = plain?.[1] ?? plain?.[2] ?? null;
  }
  return name !== null && SAFE_NAME.test(name) ? name : FALLBACK_PDF_FILENAME;
}

/** A real PDF: declared as one AND starting with the PDF signature. */
export async function isPdf(contentType: string | null, blob: Blob): Promise<boolean> {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/pdf" || blob.size < 5) return false;
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === "%PDF-";
}

export type ReviewPdfResult =
  { ok: true; blob: Blob; filename: string } | { ok: false; error: ExportError };

/**
 * One export request: same-origin, the user's session cookies, never cached. Throws only an
 * AbortError (the caller aborted, e.g. on unmount); everything else becomes an ExportError.
 */
export async function requestReviewPdf(
  href: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ReviewPdfResult> {
  let response: Response;
  try {
    response = await fetcher(href, { credentials: "same-origin", cache: "no-store", signal });
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, error: { key: "export.network" } };
  }
  if (!response.ok) {
    // Drain without reading it into the UI (the body is a server message, not ours to show).
    void response.body?.cancel().catch(() => {});
    return {
      ok: false,
      error: exportErrorFor(response.status, response.headers.get("Retry-After")),
    };
  }
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, error: { key: "export.network" } };
  }
  if (!(await isPdf(response.headers.get("Content-Type"), blob))) {
    return { ok: false, error: { key: "export.invalid" } };
  }
  return {
    ok: true,
    blob,
    filename: pdfFilenameFrom(response.headers.get("Content-Disposition")),
  };
}
