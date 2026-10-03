"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { cx } from "@/components/ui/primitives";
import type { ActionResult } from "@/lib/action-result";
import { simulateCharacterAction, simulateMatchAction, simulateOutageAction } from "../actions";

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

/** Mock roster + one character outside the session baseline (Sagat). */
const DEV_CHARACTERS = [
  { key: "aki", name: "A.K.I." },
  { key: "kimberly", name: "Kimberly" },
  { key: "cammy", name: "Cammy" },
  { key: "sagat", name: "Sagat" },
] as const;

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

  // Deliberately monochrome and collapsible: an internal tool, not part of the product look.
  return (
    <details open className="group px-5 py-4 font-mono text-xs text-faint">
      <summary className="flex cursor-pointer list-none items-center gap-2 select-none hover:text-muted [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
          ▸
        </span>
        <span className="tracking-[0.12em] uppercase">{t("title")}</span>
        <span className="ml-auto border border-dashed border-line-strong px-1.5 py-px tracking-wider uppercase">
          {t("badge")}
        </span>
      </summary>
      <div className="mt-3 border border-dashed border-line-strong p-3">
        <p className="leading-relaxed text-muted">{t("description")}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {TOOLS.map((tool) => (
            <button
              key={tool.key}
              type="button"
              disabled={pending}
              data-tool={tool.key}
              onClick={() => run(tool)}
              className={cx(
                "border border-line-strong px-2 py-1 transition-colors hover:border-muted hover:text-text disabled:opacity-40",
                tool.variant === "secondary" ? "text-muted" : "border-dashed text-faint",
              )}
            >
              {t(tool.key)}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 tracking-[0.12em] uppercase">{t("character")}</span>
          {DEV_CHARACTERS.map((c) => (
            <button
              key={c.key}
              type="button"
              disabled={pending}
              data-character={c.key}
              onClick={() =>
                startTransition(async () => {
                  const res = await simulateCharacterAction(c.key);
                  const time = new Date().toLocaleTimeString(locale);
                  const line = res.ok
                    ? `${time} ✓ ${t("logCharacter", { name: res.data.characterName })}`
                    : `${time} ✗ ${res.error}`;
                  setLog((l) => [{ id: nextId.current++, text: line }, ...l].slice(0, 6));
                })
              }
              className="border border-line-strong px-2 py-1 text-muted transition-colors hover:border-muted hover:text-text disabled:opacity-40"
            >
              {c.name}
            </button>
          ))}
        </div>
        {log.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-[11px] text-faint">
            {log.map((entry) => (
              <li key={entry.id}>{entry.text}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
