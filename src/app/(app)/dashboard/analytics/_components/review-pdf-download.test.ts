/**
 * M2C — pure parts of the review PDF export: status → message key (never the body), Retry-After,
 * the server filename (safe names only), PDF validation and the request contract.
 */
import { describe, expect, it, vi } from "vitest";
import {
  FALLBACK_PDF_FILENAME,
  exportErrorFor,
  isPdf,
  pdfFilenameFrom,
  requestReviewPdf,
  retryAfterSeconds,
} from "./review-pdf-download";

describe("exportErrorFor", () => {
  it("429 (in progress OR quota: indistinguishable) → one message, Retry-After as seconds or whole minutes", () => {
    expect(exportErrorFor(429, "5")).toEqual({ key: "export.rateLimitedSeconds", count: 5 });
    expect(exportErrorFor(429, "59")).toEqual({ key: "export.rateLimitedSeconds", count: 59 });
    expect(exportErrorFor(429, "60")).toEqual({ key: "export.rateLimitedMinutes", count: 1 });
    expect(exportErrorFor(429, "61")).toEqual({ key: "export.rateLimitedMinutes", count: 2 });
    expect(exportErrorFor(429, null)).toEqual({ key: "export.rateLimited" });
  });
  it("503 → the existing capacity message; 409 → the existing no-signals message", () => {
    expect(exportErrorFor(503, "5")).toEqual({ key: "errors.busy" });
    expect(exportErrorFor(409, null)).toEqual({ key: "errors.noSignals" });
  });
  it("401 → session expired; anything else → the generic failure", () => {
    expect(exportErrorFor(401, null)).toEqual({ key: "export.sessionExpired" });
    for (const status of [400, 403, 404, 500, 502, 504])
      expect(exportErrorFor(status, null)).toEqual({ key: "export.failed" });
  });
});

describe("retryAfterSeconds", () => {
  it("accepts positive delay-seconds only", () => {
    expect(retryAfterSeconds("5")).toBe(5);
    expect(retryAfterSeconds(" 30 ")).toBe(30);
    for (const bad of [
      null,
      "",
      "0",
      "-1",
      "1.5",
      "abc",
      "Wed, 21 Oct 2026 07:28:00 GMT",
      "999999",
    ])
      expect(retryAfterSeconds(bad)).toBeNull();
  });
});

describe("pdfFilenameFrom", () => {
  it("keeps the server's plain filename (quoted, bare or RFC 5987)", () => {
    const name = "sst-review-aki-ranked-90d-2026-10-26.pdf";
    expect(pdfFilenameFrom(`attachment; filename="${name}"`)).toBe(name);
    expect(pdfFilenameFrom(`attachment; filename=${name}`)).toBe(name);
    expect(pdfFilenameFrom(`attachment; filename*=UTF-8''${name}; filename="x.pdf"`)).toBe(name);
  });
  it("anything unsafe or not a PDF name ⇒ the fallback", () => {
    for (const header of [
      null,
      "",
      "attachment",
      'attachment; filename="../secret.pdf"',
      'attachment; filename="a/b.pdf"',
      'attachment; filename="report.html"',
      'attachment; filename=".pdf"',
      'attachment; filename="r\u0000.pdf"',
      "attachment; filename*=UTF-8''%E0%A4%A.pdf",
      `attachment; filename="${"a".repeat(300)}.pdf"`,
    ])
      expect(pdfFilenameFrom(header)).toBe(FALLBACK_PDF_FILENAME);
  });
});

describe("isPdf", () => {
  const pdf = new Blob(["%PDF-1.7 …"]);
  it("needs the PDF content type AND the %PDF- signature", async () => {
    expect(await isPdf("application/pdf", pdf)).toBe(true);
    expect(await isPdf("Application/PDF; charset=binary", pdf)).toBe(true);
    expect(await isPdf("text/html", pdf)).toBe(false);
    expect(await isPdf(null, pdf)).toBe(false);
    expect(await isPdf("application/pdf", new Blob(["<html>"]))).toBe(false);
    expect(await isPdf("application/pdf", new Blob([]))).toBe(false);
  });
});

describe("requestReviewPdf", () => {
  const signal = () => new AbortController().signal;
  it("same-origin credentials, never cached, the given href only", async () => {
    const fetcher = vi.fn(async () => new Response("x", { status: 500 }));
    await requestReviewPdf("/dashboard/analytics/review.pdf?range=90d", signal(), fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "/dashboard/analytics/review.pdf?range=90d",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
  });
  it("a network error is a message; an abort is re-thrown (the caller unmounted)", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await requestReviewPdf("/x", signal(), failing)).toEqual({
      ok: false,
      error: { key: "export.network" },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestReviewPdf("/x", controller.signal, async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    ).rejects.toThrow("aborted");
  });
});
