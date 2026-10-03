"use client";

import { useState, useTransition } from "react";
import { Badge, Button } from "@/components/ui/primitives";
import { simulateMatchAction, simulateOutageAction } from "../actions";

/**
 * Development-only panel (rendered only when devToolsEnabled()). Writes to the MOCK CFN; the
 * worker then detects the match through the normal pipeline — nothing here touches stats.
 */
export function DevTools() {
  const [pending, startTransition] = useTransition();
  const [log, setLog] = useState<string[]>([]);

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      setLog((l) => [`${new Date().toLocaleTimeString()} ${res.ok ? "✓" : "✗"} ${label}${res.ok ? "" : ` — ${res.error}`}`, ...l].slice(0, 6));
    });

  return (
    <section className="rounded-xl border border-dashed border-info/40 bg-info/5 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xs font-semibold tracking-[0.18em] text-info uppercase">Dev tools · mock CFN</h2>
        <Badge tone="info">dev only</Badge>
      </div>
      <p className="mt-2 text-xs text-muted">
        Creates matches in the fake CFN. The worker detects them (≈1–2 s) and every open overlay updates without reloading.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("ranked win", () => simulateMatchAction({ result: "win" }))}>
          + Win
        </Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("ranked loss", () => simulateMatchAction({ result: "loss" }))}>
          + Loss
        </Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("random ranked", () => simulateMatchAction({}))}>
          Random
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("casual win (ignored)", () => simulateMatchAction({ result: "win", mode: "casual" }))}>
          Casual (filtered)
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("late match (played 20s ago)", () => simulateMatchAction({ result: "win", secondsAgo: 20 }))}>
          Out-of-order
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("CFN outage 60s", () => simulateOutageAction(60))}>
          Outage 60s
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("outage cleared", () => simulateOutageAction(0))}>
          Clear outage
        </Button>
      </div>
      {log.length > 0 && (
        <ul className="mt-3 space-y-0.5 font-mono text-[11px] text-faint">
          {log.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
