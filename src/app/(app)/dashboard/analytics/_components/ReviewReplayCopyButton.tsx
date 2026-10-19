"use client";

/**
 * Copy ONE Replay ID (exactly `replayId`, nothing prepended). The only client code of Replay
 * Selection: everything else in the review cards stays server-rendered.
 */
import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

export function ReviewReplayCopyButton({
  replayId,
  labels,
}: {
  replayId: string;
  labels: { copy: string; copied: string; failed: string; aria: string };
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
        await navigator.clipboard.writeText(replayId);
        next = "copied";
      }
    } catch {
      next = "failed";
    }
    setState(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2_000);
  }

  const text =
    state === "copied" ? labels.copied : state === "failed" ? labels.failed : labels.copy;
  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={labels.aria}
        data-testid="replay-copy"
        data-state={state}
        className="btn btn-secondary btn-sm shrink-0"
      >
        {text}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "idle" ? "" : text}
      </span>
    </>
  );
}
