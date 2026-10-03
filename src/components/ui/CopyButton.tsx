"use client";

import { useState } from "react";
import { Button } from "./primitives";

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied!",
  variant = "primary",
  size = "md",
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
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
      {copied ? copiedLabel : label}
    </Button>
  );
}
