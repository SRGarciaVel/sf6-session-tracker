"use client";

/**
 * Review export actions (Phase 6.4B, M2C). Client responsibilities ONLY: copy the already-built
 * plain-text summary, and request the server-built PDF for the page's filters (range / mode /
 * character) with visible, localized feedback. The PDF request is a same-origin fetch of the same
 * route (review-pdf-download.ts): refusals (429 / 503 …) become a message instead of the browser's
 * silent "download failed", and only a real PDF is ever saved.
 */
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { requestReviewPdf, type ExportError } from "./review-pdf-download";

type CopyState = "idle" | "copied" | "failed";
type ExportState =
  { kind: "idle" } | { kind: "pending" } | { kind: "done" } | { kind: "error"; error: ExportError };

/** The object URL outlives the click briefly so the browser can start the download. */
const REVOKE_AFTER_MS = 10_000;

export function ReviewExportActions({
  plainText,
  pdfHref,
}: {
  plainText: string;
  pdfHref: string;
}) {
  const t = useTranslations("Analytics.reviewReport");
  const [state, setState] = useState<CopyState>("idle");
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" });
  const timer = useRef<number | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const objectUrls = useRef(new Map<string, number>());

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      inFlight.current?.abort();
      for (const [url, id] of urls) {
        window.clearTimeout(id);
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  async function copy() {
    let next: CopyState = "failed";
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(plainText);
        next = "copied";
      }
    } catch {
      next = "failed";
    }
    setState(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2_500);
  }

  function save(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    const id = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      objectUrls.current.delete(url);
    }, REVOKE_AFTER_MS);
    objectUrls.current.set(url, id);
  }

  async function download(event: React.MouseEvent<HTMLAnchorElement>) {
    // Modified clicks (new tab / window, save link) keep the browser's native behaviour.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    // One request at a time, even for clicks landing before the pending state renders.
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setExportState({ kind: "pending" });
    try {
      const result = await requestReviewPdf(pdfHref, controller.signal);
      if (controller.signal.aborted) return;
      if (result.ok) {
        save(result.blob, result.filename);
        setExportState({ kind: "done" });
      } else {
        setExportState({ kind: "error", error: result.error });
      }
    } catch {
      // An abort (unmounted) shows nothing; anything unexpected fails safely.
      if (!controller.signal.aborted)
        setExportState({ kind: "error", error: { key: "export.failed" } });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  const pending = exportState.kind === "pending";
  const error = exportState.kind === "error" ? exportState.error : null;
  const status = pending
    ? t("export.downloading")
    : exportState.kind === "done"
      ? t("export.downloaded")
      : state === "copied"
        ? t("cta.copied")
        : state === "failed"
          ? t("cta.copyFailed")
          : "";

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={copy}
          className="btn btn-secondary btn-md"
          data-testid="review-copy"
          data-state={state}
        >
          {state === "copied" ? t("cta.copied") : t("cta.copy")}
        </button>
        {/* Still a link to the route (same href, works before hydration); a plain click runs the
            checked request below instead, so a refusal is a message, not a failed download. */}
        <a
          href={pdfHref}
          download
          onClick={download}
          // Stays focusable while pending (aria-disabled): focus is never lost; clicks are ignored.
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          aria-describedby={error ? "review-pdf-error" : undefined}
          className="btn btn-primary btn-md aria-disabled:cursor-progress aria-disabled:opacity-70"
          data-testid="review-pdf"
          data-state={exportState.kind}
        >
          <Icon name="download" />
          {pending ? t("export.downloading") : t("cta.download")}
        </a>
        {/* Announced to screen readers; visible text, not colour or an icon alone. */}
        <p
          role="status"
          aria-live="polite"
          className="m-0 text-xs text-muted"
          data-testid="review-copy-status"
        >
          {/* While pending the control itself says it visibly: announce only. */}
          <span className={pending ? "sr-only" : undefined}>{status}</span>
        </p>
      </div>
      {/* Errors interrupt (alert) and stay visible until the next attempt. */}
      <p
        id="review-pdf-error"
        role="alert"
        className={
          error
            ? "m-0 max-w-2xl border-l-4 border-warn bg-warn/8 px-3 py-2 text-sm"
            : "m-0 empty:hidden"
        }
        data-testid="review-pdf-error"
      >
        {error ? t(error.key, "count" in error ? { count: error.count } : {}) : ""}
      </p>
    </div>
  );
}
