"use client";

/**
 * Review export actions (Phase 6.4B). Client responsibilities ONLY: copy the already-built
 * plain-text summary to the clipboard and announce it. The summary and the PDF are produced on
 * the server; the PDF link carries nothing but the page's filters (range / mode / character).
 */
import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

export function ReviewExportActions({
  plainText,
  pdfHref,
  labels,
}: {
  plainText: string;
  pdfHref: string;
  labels: { copy: string; copied: string; copyFailed: string; download: string };
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

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

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={copy}
        className="btn btn-secondary btn-md"
        data-testid="review-copy"
        data-state={state}
      >
        {state === "copied" ? labels.copied : labels.copy}
      </button>
      <a href={pdfHref} className="btn btn-primary btn-md" data-testid="review-pdf" download>
        {labels.download}
      </a>
      {/* Announced to screen readers; visible text, not colour or an icon alone. */}
      <p
        role="status"
        aria-live="polite"
        className="text-xs text-muted"
        data-testid="review-copy-status"
      >
        {state === "copied" ? labels.copied : state === "failed" ? labels.copyFailed : ""}
      </p>
    </div>
  );
}
