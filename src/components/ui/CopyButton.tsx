"use client";

import { useTranslations } from "next-intl";
import { useCopyToClipboard } from "@/lib/clipboard";
import { Icon } from "./Icon";
import { Button, cx } from "./primitives";

/**
 * Copy a value with visible + announced feedback (check icon + "Copied" / "Couldn't copy"). The button
 * keeps its width-defining label for screen readers via aria-label; the status is announced
 * through a polite live region.
 */
export function CopyButton({
  value,
  label,
  copiedLabel,
  ariaLabel,
  variant = "primary",
  size = "md",
  className,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  /** For icon-like or ambiguous labels ("Copy" next to several values). */
  ariaLabel?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  className?: string;
}) {
  const t = useTranslations("Common");
  const [status, copy] = useCopyToClipboard();
  const text =
    status === "copied"
      ? (copiedLabel ?? t("copied"))
      : status === "failed"
        ? t("copyFailed")
        : (label ?? t("copy"));

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => void copy(value)}
        aria-label={ariaLabel}
        data-copy-status={status}
      >
        {/* Copy → check (the text says it too); failure keeps the copy icon. */}
        <Icon name={status === "copied" ? "check" : "copy"} />
        {/* Feedback swaps the text in place: the idle label keeps reserving its width (invisible,
            so not announced), so neighbouring buttons never jump when «Copied» appears. */}
        <span className="grid">
          <span
            aria-hidden={status !== "idle"}
            className={cx("col-start-1 row-start-1", status !== "idle" && "invisible")}
          >
            {label ?? t("copy")}
          </span>
          {status !== "idle" && <span className="col-start-1 row-start-1">{text}</span>}
        </span>
      </Button>
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? t("copiedAnnounce") : status === "failed" ? t("copyFailedHint") : ""}
      </span>
    </>
  );
}
