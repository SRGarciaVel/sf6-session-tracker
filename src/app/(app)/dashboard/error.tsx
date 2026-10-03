"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/primitives";

export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("Dashboard.error");
  return (
    <div className="hud-panel mx-auto max-w-md p-8 text-center">
      <p className="font-display text-xs font-bold tracking-[0.3em] text-loss uppercase">
        {t("title")}
      </p>
      <p className="mt-3 text-sm text-muted">{t("body")}</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-faint">ref: {error.digest}</p>}
      <Button variant="primary" className="mt-6" onClick={() => retry()}>
        {t("retry")}
      </Button>
    </div>
  );
}
