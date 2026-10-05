"use client";

import { useTranslations } from "next-intl";
import { useCopyToClipboard } from "@/lib/clipboard";
import { Button } from "./primitives";

/**
 * Copy a value with visible + announced feedback ("✓ Copied" / "Couldn't copy"). The button
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
      ? `✓ ${copiedLabel ?? t("copied")}`
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
        {text}
      </Button>
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? t("copiedAnnounce") : status === "failed" ? t("copyFailedHint") : ""}
      </span>
    </>
  );
}
