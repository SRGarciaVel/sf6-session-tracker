"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { Badge, Button } from "@/components/ui/primitives";
import type { ActionResult } from "@/lib/action-result";
import { simulateMatchAction, simulateOutageAction } from "../actions";

type ToolKey = "win" | "loss" | "random" | "casual" | "outOfOrder" | "outage" | "clearOutage";
type LogKey =
  | "logWin"
  | "logLoss"
  | "logRandom"
  | "logCasual"
  | "logOutOfOrder"
  | "logOutage"
  | "logClearOutage";

const TOOLS: Array<{
  key: ToolKey;
  log: LogKey;
  variant: "secondary" | "ghost";
  run: () => Promise<ActionResult<unknown>>;
}> = [
  {
    key: "win",
    log: "logWin",
    variant: "secondary",
    run: () => simulateMatchAction({ result: "win" }),
  },
  {
    key: "loss",
    log: "logLoss",
    variant: "secondary",
    run: () => simulateMatchAction({ result: "loss" }),
  },
  { key: "random", log: "logRandom", variant: "secondary", run: () => simulateMatchAction({}) },
  {
    key: "casual",
    log: "logCasual",
    variant: "ghost",
    run: () => simulateMatchAction({ result: "win", mode: "casual" }),
  },
  {
    key: "outOfOrder",
    log: "logOutOfOrder",
    variant: "ghost",
    run: () => simulateMatchAction({ result: "win", secondsAgo: 20 }),
  },
  { key: "outage", log: "logOutage", variant: "ghost", run: () => simulateOutageAction(60) },
  {
    key: "clearOutage",
    log: "logClearOutage",
    variant: "ghost",
    run: () => simulateOutageAction(0),
  },
];

/**
 * Development-only panel (rendered only when devToolsEnabled()). Writes to the MOCK CFN; the
 * worker then detects the match through the normal pipeline — nothing here touches stats.
 */
export function DevTools() {
  const t = useTranslations("Dashboard.dev");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [log, setLog] = useState<Array<{ id: number; text: string }>>([]);
  const nextId = useRef(0);

  const run = (tool: (typeof TOOLS)[number]) =>
    startTransition(async () => {
      const res = await tool.run();
      const time = new Date().toLocaleTimeString(locale);
      const line = `${time} ${res.ok ? "✓" : "✗"} ${t(tool.log)}${res.ok ? "" : ` — ${res.error}`}`;
      setLog((l) => [{ id: nextId.current++, text: line }, ...l].slice(0, 6));
    });

  return (
    <section className="rounded-xl border border-dashed border-info/40 bg-info/5 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xs font-semibold tracking-[0.18em] text-info uppercase">
          {t("title")}
        </h2>
        <Badge tone="info">{t("badge")}</Badge>
      </div>
      <p className="mt-2 text-xs text-muted">{t("description")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {TOOLS.map((tool) => (
          <Button
            key={tool.key}
            size="sm"
            variant={tool.variant}
            disabled={pending}
            data-tool={tool.key}
            onClick={() => run(tool)}
          >
            {t(tool.key)}
          </Button>
        ))}
      </div>
      {log.length > 0 && (
        <ul className="mt-3 space-y-0.5 font-mono text-[11px] text-faint">
          {log.map((entry) => (
            <li key={entry.id}>{entry.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
