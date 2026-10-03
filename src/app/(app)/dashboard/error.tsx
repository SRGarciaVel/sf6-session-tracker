"use client";

import { Button } from "@/components/ui/primitives";

export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-8 text-center">
      <p className="font-display text-xs font-bold tracking-[0.3em] text-loss uppercase">
        Something went wrong
      </p>
      <p className="mt-3 text-sm text-muted">
        The dashboard couldn&apos;t load. Your session keeps tracking in the background — nothing is
        lost.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-faint">ref: {error.digest}</p>}
      <Button variant="primary" className="mt-6" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
