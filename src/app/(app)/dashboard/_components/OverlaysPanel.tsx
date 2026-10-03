"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { OverlayView } from "@/components/overlay/OverlayView";
import { CopyButton } from "@/components/ui/CopyButton";
import { Badge, Button, ErrorText, buttonClass } from "@/components/ui/primitives";
import { OVERLAY_PRESETS, type OverlayConfig } from "@/domain/overlay/config";
import { createOverlayAction } from "../actions";
import { useLiveDashboard } from "./LiveDashboard";

export interface OverlaySummary {
  id: string;
  name: string;
  url: string;
  config: OverlayConfig;
}

export function OverlaysPanel({ overlays }: { overlays: OverlaySummary[] }) {
  const t = useTranslations("Dashboard.overlays");
  const tb = useTranslations("Builder");
  const { state } = useLiveDashboard();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const create = () => {
    setError(null);
    startTransition(async () => {
      const res = await createOverlayAction(
        t("newOverlayName", { number: overlays.length + 1 }),
        "minimal",
      );
      if (res.ok) router.push(`/dashboard/overlays/${res.data.overlayId}`);
      else setError(res.error);
    });
  };

  return (
    <section className="rounded-xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
        <h2 className="font-display text-xs font-semibold tracking-[0.18em] text-muted uppercase">
          {t("title")}
        </h2>
        <Badge tone={state.overlayConnections > 0 ? "win" : "neutral"}>
          {t("connected", { count: state.overlayConnections })}
        </Badge>
      </header>
      <ul className="divide-y divide-line">
        {overlays.map((o) => {
          const preset = OVERLAY_PRESETS[o.config.preset];
          return (
            <li key={o.id} className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display font-semibold">{o.name}</p>
                  <p className="text-xs text-muted">
                    {tb(`themes.${o.config.theme}.name`)} · {preset.width} × {preset.height} ·{" "}
                    {o.config.locale.toUpperCase()}
                  </p>
                </div>
                <Link href={`/dashboard/overlays/${o.id}`} className={buttonClass("ghost", "sm")}>
                  {t("configure")}
                </Link>
              </div>
              <div
                className="bg-slash overflow-hidden rounded-md border border-line bg-surface-3"
                style={{ aspectRatio: `${preset.width} / ${preset.height}` }}
              >
                <OverlayView
                  config={o.config}
                  live={state.live}
                  sizing={{ mode: "box", width: 340, height: (340 * preset.height) / preset.width }}
                />
              </div>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={o.url}
                  aria-label={t("urlAria")}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 font-mono text-[11px] text-muted"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyButton value={o.url} label={t("copyUrl")} size="sm" />
                <a
                  href={o.url}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClass("secondary", "sm")}
                >
                  {t("openPreview")}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line px-5 py-3">
        <Button variant="ghost" size="sm" onClick={create} disabled={pending}>
          {t("newOverlay")}
        </Button>
        <ErrorText>{error}</ErrorText>
      </div>
    </section>
  );
}

export function ObsGuide({ width, height }: { width: number; height: number }) {
  const t = useTranslations("Dashboard.obs");
  const steps = [t("step1"), t("step2"), t("step3"), t("step4", { width, height }), t("step5")];
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-display text-xs font-semibold tracking-[0.18em] text-muted uppercase">
        {t("title")}
      </h2>
      <ol className="mt-4 space-y-2 text-sm">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3">
            <span className="font-display font-bold text-accent tabular">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 rounded-md border border-line bg-surface-2 p-3 text-xs text-muted">
        <p className="font-semibold text-text">{t("recommendedTitle")}</p>
        <p className="mt-1">
          {t.rich("recommendedBody", {
            b: (chunks) => <b className="text-text">{chunks}</b>,
          })}
        </p>
        <p className="mt-1 text-faint">{t("optionalNote")}</p>
      </div>
    </section>
  );
}
