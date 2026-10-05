"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button, cx } from "@/components/ui/primitives";
import {
  assessCompanion,
  type CompanionReadiness,
  type DataFreshness,
} from "@/domain/companion/readiness";
import { useOptionalLiveDashboard, useNow } from "./LiveDashboard";

/**
 * Companion readiness from the live dashboard state, re-assessed as the clock ticks. Before
 * mount the server's clock is used, so server and client render the same markup.
 */
export function useCompanionReadiness(): CompanionReadiness | null {
  const live = useOptionalLiveDashboard();
  const now = useNow(15_000);
  if (!live) return null;
  const signals = live.state.companion;
  return assessCompanion(signals, now ?? Date.parse(signals.serverTime));
}

type Tone = "ok" | "warn" | "off";

const GLYPH: Record<Tone, string> = { ok: "●", warn: "⚠", off: "○" };
const TONE_CLASS: Record<Tone, string> = { ok: "text-win", warn: "text-warn", off: "text-muted" };

/** Status line: glyph + text, so state never depends on color alone. */
export function StatusValue({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 font-semibold", TONE_CLASS[tone])}>
      <span aria-hidden>{GLYPH[tone]}</span>
      {children}
    </span>
  );
}

const bucklerTone = (f: DataFreshness): Tone => (f === "fresh" ? "ok" : "warn");

/** "Companion ● Connected / Buckler ⚠ Log in to Buckler" rows. */
export function CompanionStatusRows({ readiness }: { readiness: CompanionReadiness }) {
  const t = useTranslations("Dashboard.companion.status");
  const companion =
    readiness.companion === "connected"
      ? { tone: "ok" as const, text: t("connected") }
      : readiness.companion === "quiet"
        ? { tone: "warn" as const, text: t("quiet") }
        : { tone: "off" as const, text: t("notPaired") };
  const buckler =
    readiness.buckler === "fresh"
      ? t("bucklerOk")
      : readiness.buckler === "stale"
        ? t("bucklerStale")
        : t("bucklerNever");
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      <dt className="hud-label self-center">{t("companion")}</dt>
      <dd>
        <StatusValue tone={companion.tone}>{companion.text}</StatusValue>
      </dd>
      {readiness.companion !== "notPaired" && (
        <>
          <dt className="hud-label self-center">{t("buckler")}</dt>
          <dd>
            <StatusValue tone={bucklerTone(readiness.buckler)}>{buckler}</StatusValue>
          </dd>
        </>
      )}
    </dl>
  );
}

/**
 * Pre-session checklist. The start button is disabled only when the server would refuse to
 * start (stale/missing companion data); the next step says exactly what to do.
 */
export function StartChecklist({
  readiness,
  onStart,
  pending,
  startLabel,
  pendingLabel,
}: {
  readiness: CompanionReadiness;
  onStart: () => void;
  pending: boolean;
  startLabel: string;
  pendingLabel: string;
}) {
  const t = useTranslations("Dashboard.readiness");
  const items: Array<{ key: string; label: string; ok: boolean; optional?: boolean }> = [
    { key: "companion", label: t("companion"), ok: readiness.companion !== "notPaired" },
    { key: "buckler", label: t("buckler"), ok: readiness.buckler === "fresh" },
    { key: "profile", label: t("profile"), ok: readiness.profile === "fresh" },
    {
      key: "character",
      label: t("character"),
      ok: readiness.characterDetected,
      optional: true,
    },
  ];
  return (
    <div className="border-t border-line px-5 py-4 sm:px-6" data-testid="start-checklist">
      <p className="hud-label">{t("title")}</p>
      <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-2" data-check={item.key}>
            <span
              aria-hidden
              className={cx(
                "w-4 text-center font-bold",
                item.ok ? "text-win" : item.optional ? "text-muted" : "text-warn",
              )}
            >
              {item.ok ? "✓" : item.optional ? "–" : "○"}
            </span>
            <span className={item.ok ? "text-text" : "text-muted"}>{item.label}</span>
            <span className="sr-only">{item.ok ? t("done") : t("missing")}</span>
          </li>
        ))}
      </ul>
      {!readiness.characterDetected && readiness.canStart && (
        <p className="mt-2 text-xs text-faint">{t("characterOptional")}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p
          className={cx("min-w-0 flex-1 text-sm", readiness.canStart ? "text-win" : "text-warn")}
          role="status"
          id="start-checklist-next"
        >
          {readiness.nextStep ? t(`steps.${readiness.nextStep}`) : t("ready")}
          {readiness.nextStep === "pairCompanion" && (
            <>
              {" "}
              <a href="#companion" className="font-semibold text-cyan underline underline-offset-4">
                {t("goToCompanion")}
              </a>
            </>
          )}
        </p>
        <Button
          variant="primary"
          onClick={onStart}
          disabled={pending || !readiness.canStart}
          aria-describedby="start-checklist-next"
        >
          {pending ? pendingLabel : startLabel}
        </Button>
      </div>
    </div>
  );
}
