"use client";

import { useEffect } from "react";

/**
 * Transient server error (e.g. database restarting during a deploy). Never show an error on
 * stream: render nothing and retry quietly until the overlay recovers.
 */
export default function OverlayError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    const id = setInterval(() => retry(), 10_000);
    return () => clearInterval(id);
  }, [retry]);
  return null;
}
