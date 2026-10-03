"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "./primitives";

export function CopyButton({
  value,
  label,
  copiedLabel,
  variant = "primary",
  size = "md",
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const t = useTranslations("Common");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for non-secure contexts (http://LAN-ip during setup).
      const el = document.createElement("textarea");
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Button variant={variant} size={size} onClick={copy} aria-live="polite">
      {copied ? (copiedLabel ?? t("copied")) : (label ?? t("copy"))}
    </Button>
  );
}
