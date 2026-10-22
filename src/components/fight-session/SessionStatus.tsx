import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/primitives";
import { formatTimeAgo } from "@/domain/format";
import type {
  CompanionStatusData,
  OverlayStatusData,
  SessionIndicatorStatus,
  TrackingState,
  TrackingStatusData,
} from "./types";

const TRACKING_TONE: Record<TrackingState, "ok" | "warn" | "off"> = {
  ready: "ok",
  tracking: "ok",
  waiting: "warn",
  attention: "warn",
  disconnected: "warn",
  unknown: "off",
};

const GLYPH: Record<"ok" | "warn" | "off", string> = { ok: "●", warn: "⚠", off: "○" };

/** Lamp + word (+ optional duration). Colour never carries the state alone. */
export function SessionStatusIndicator({
  status,
  duration,
  className,
}: {
  status: SessionIndicatorStatus;
  /** Already formatted (e.g. `formatDuration`), shown after the word. */
  duration?: string | null;
  className?: string;
}) {
  const t = useTranslations("FightSession.status");
  return (
    <span
      className={cx(`fs-status-${status} inline-flex min-w-0 items-center gap-2.5`, className)}
      data-status={status}
    >
      <span className="fs-lamp" aria-hidden />
      <span className="fs-status-word font-display text-base font-bold tracking-[0.14em] uppercase">
        {t(status)}
      </span>
      {duration && (
        <span className="text-sm text-muted tabular">
          <span className="sr-only">{t("duration", { duration })}</span>
          <span aria-hidden>· {duration}</span>
        </span>
      )}
    </span>
  );
}

function Item({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "ok" | "warn" | "off" | null;
  children: ReactNode;
}) {
  const color = tone === "ok" ? "text-win" : tone === "warn" ? "text-warn" : "text-muted";
  return (
    <div className="fs-strip-item">
      <dt className="fs-eyebrow">{label}</dt>
      <dd className={cx("m-0 inline-flex min-w-0 items-baseline gap-1.5 font-semibold", color)}>
        {tone && <span aria-hidden>{GLYPH[tone]}</span>}
        <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
      </dd>
    </div>
  );
}

/**
 * Compact operational line (from Broadcast Control): session state, Companion link, Buckler data
 * and overlays. Only the session state is a live region: the ticking "x s ago" is not announced.
 */
export function StatusStrip({
  status,
  duration,
  companion,
  overlays,
  now,
  realtime = null,
  tracking,
  diagnosticsHref,
  trailing,
  className,
}: {
  status: SessionIndicatorStatus;
  duration?: string | null;
  companion: CompanionStatusData;
  overlays: OverlayStatusData | null;
  /**
   * The dashboard's own live link (its single SSE stream). Shown only while it is NOT open, so a
   * stale screen is never mistaken for live data; null = not reported.
   */
  realtime?: "open" | "reconnecting" | null;
  /**
   * Phase 5.6D: one «Tracking» answer instead of separate Companion/Buckler items (the detailed
   * diagnostics live in the Companion module, see `diagnosticsHref`). Absent = legacy layout.
   */
  tracking?: TrackingStatusData | null;
  /** Where the detailed Companion diagnostics are (shown when tracking needs attention). */
  diagnosticsHref?: string;
  /** Extra action at the end of the strip (e.g. a jump to the overlays). */
  trailing?: ReactNode;
  /** Client clock for relative times; null before mount (absolute time is not invented). */
  now: number | null;
  className?: string;
}) {
  const t = useTranslations("FightSession.strip");
  const locale = useLocale();
  const linkTone =
    companion.link === "connected" ? "ok" : companion.link === "quiet" ? "warn" : "off";
  const bucklerTone = companion.buckler === "fresh" ? "ok" : "warn";
  const sync =
    companion.lastSyncAt === null
      ? t("syncNever")
      : now === null
        ? null
        : formatTimeAgo(companion.lastSyncAt, now, locale).text;

  return (
    <section aria-label={t("label")} className={cx("fs-strip", className)}>
      <div role="status" className="min-w-0">
        <SessionStatusIndicator status={status} duration={duration} />
      </div>
      <dl className="m-0 flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
        {tracking !== undefined && tracking !== null && (
          <Item label={t("tracking")} tone={TRACKING_TONE[tracking.state]}>
            <span data-tracking={tracking.state}>{t(`trackingState.${tracking.state}`)}</span>
            {/* «Needs attention» always says what is wrong (the readiness step, briefly). */}
            {tracking.state === "attention" && tracking.step === "pairCompanion" && (
              <span className="text-text">: {t("companionState.notPaired")}</span>
            )}
            {tracking.state === "attention" && tracking.step === "loginBuckler" && (
              <span className="text-text">: {t("bucklerState.never")}</span>
            )}
            {companion.link && companion.link !== "notPaired" && sync !== null && (
              <span className="font-normal text-muted">
                {" · "}
                {companion.lastSyncAt === null ? sync : t("syncShort", { ago: sync })}
              </span>
            )}
            {TRACKING_TONE[tracking.state] === "warn" && diagnosticsHref && (
              <>
                {" "}
                <a
                  href={diagnosticsHref}
                  className="inline-flex min-h-6 items-center font-semibold text-cyan underline-offset-2 hover:underline"
                >
                  {t("diagnostics")}
                </a>
              </>
            )}
          </Item>
        )}
        {tracking === undefined && companion.link && (
          <Item label={t("companion")} tone={linkTone}>
            {t(`companionState.${companion.link}`)}
          </Item>
        )}
        {tracking === undefined && companion.buckler && (
          <Item label={t("buckler")} tone={bucklerTone}>
            {t(`bucklerState.${companion.buckler}`)}
          </Item>
        )}
        {tracking === undefined && companion.link && sync !== null && (
          <Item label={t("sync")} tone={null}>
            <span className="font-normal text-text">{sync}</span>
          </Item>
        )}
        {realtime === "reconnecting" && (
          <Item label={t("realtime")} tone="warn">
            {t("realtimeDown")}
          </Item>
        )}
        {overlays && (
          <Item label={t("overlays")} tone={null}>
            <span className="font-normal text-text">
              {t("overlaysCount", { count: overlays.total })}
              {overlays.inObs !== null && (
                <span className="text-muted">
                  {" · "}
                  {t("inObs", { count: overlays.inObs })}
                </span>
              )}
            </span>
          </Item>
        )}
      </dl>
      {trailing && <div className="ml-auto flex max-w-full items-center">{trailing}</div>}
    </section>
  );
}
