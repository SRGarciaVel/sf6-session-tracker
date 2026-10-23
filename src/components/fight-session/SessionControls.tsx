"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import { cx, ErrorText } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";

/**
 * Phase 5.6B1 — presentational session controls. They render state and report intent through
 * callbacks; they never call session actions themselves (wiring is Phase 5.6B2).
 */

export function StartSessionButton({
  onStart,
  pending = false,
  disabled = false,
  describedBy,
  className,
}: {
  onStart: () => void;
  pending?: boolean;
  /** e.g. Companion not ready: explain why next to the button (see `describedBy`). */
  disabled?: boolean;
  /** id of the element explaining what will be tracked / why it is disabled. */
  describedBy?: string;
  className?: string;
}) {
  const t = useTranslations("FightSession.controls");
  return (
    <button
      type="button"
      className={cx("fs-cta fs-cut", className)}
      onClick={onStart}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      aria-describedby={describedBy}
      data-k="start"
    >
      <span>{pending ? t("starting") : t("start")}</span>
      <Icon name="arrow-right" size="1.15em" className="fs-cta-arrow" />
    </button>
  );
}

/**
 * End session, two steps inline (no modal). While confirming, focus moves to "Keep playing" and
 * Esc cancels; cancelling returns focus to the End button.
 */
export function EndSessionControl({
  confirming,
  pending = false,
  onAsk,
  onCancel,
  onConfirm,
  layout = "inline",
  className,
}: {
  confirming: boolean;
  pending?: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  /** `bar`: the hint takes its own line (mobile action bar). */
  layout?: "inline" | "bar";
  className?: string;
}) {
  const t = useTranslations("FightSession.controls");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(confirming);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) askRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, onCancel]);

  if (!confirming) {
    return (
      <button
        ref={askRef}
        type="button"
        className={cx("fs-btn fs-btn-sm fs-btn-end fs-cut", className)}
        onClick={onAsk}
        disabled={pending}
        data-k="end"
      >
        {t("end")}
      </button>
    );
  }
  return (
    <div
      role="group"
      aria-label={t("end")}
      className={cx("flex flex-wrap items-center gap-2", className)}
    >
      <span className={cx("text-sm text-muted", layout === "bar" && "w-full")}>{t("endHint")}</span>
      <button
        ref={cancelRef}
        type="button"
        className="fs-btn fs-btn-sm fs-cut"
        onClick={onCancel}
        disabled={pending}
        data-k="cancel-end"
      >
        {t("cancelEnd")}
      </button>
      <button
        type="button"
        className="fs-btn fs-btn-sm fs-btn-danger fs-cut"
        onClick={onConfirm}
        disabled={pending}
        aria-busy={pending || undefined}
        data-k="confirm-end"
      >
        {pending ? t("ending") : t("confirmEnd")}
      </button>
    </div>
  );
}

/** Error / slow-server feedback under the controls (reuses the app's ErrorText). */
export function SessionFeedback({ error, slow = false }: { error: string | null; slow?: boolean }) {
  const t = useTranslations("FightSession.controls");
  if (!error && !slow) return null;
  return (
    <div className="space-y-1">
      {slow && <p className="m-0 text-xs text-muted">{t("slow")}</p>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/**
 * Keeps the session's primary action within thumb reach on small screens (≤ 640 px): fixed to the
 * bottom of the viewport there, inline from `sm` up. Only fixed while the window is at least 36em
 * tall, so enlarged text (em follows the browser font size) never leaves it covering the page.
 * Reserve space below the page content (`pb-28 sm:pb-0`) where it is used.
 */
export function SessionActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "max-sm:[@media(min-height:36em)]:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-40 max-sm:border-t max-sm:border-line-strong max-sm:bg-bg/95 max-sm:px-3 max-sm:pt-2.5 max-sm:pb-[calc(0.625rem+env(safe-area-inset-bottom))]",
        "flex flex-wrap items-center gap-3 max-sm:[&>.fs-cta]:w-full",
        className,
      )}
    >
      {children}
    </div>
  );
}
