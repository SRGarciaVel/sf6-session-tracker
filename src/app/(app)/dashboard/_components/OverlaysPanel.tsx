"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { OverlayView } from "@/components/overlay/OverlayView";
import { CopyButton } from "@/components/ui/CopyButton";
import { Button, Dot, ErrorText, buttonClass } from "@/components/ui/primitives";
import { overlayReadout, type OverlayConfig } from "@/domain/overlay/config";
import { CREATABLE_OVERLAY_KINDS, type CreatableOverlayKind } from "@/domain/overlay/kind";
import { createOverlayAction } from "../actions";
import { useLiveDashboard } from "./LiveDashboard";

export interface OverlaySummary {
  id: string;
  name: string;
  url: string;
  config: OverlayConfig;
}

/** Console module heading: small caps + rule, optional right-side readout. */
export function ConsoleHeading({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="hud-heading flex-1">{children}</h2>
      {aside}
    </div>
  );
}

/** Renders the overlay at the real preset aspect ratio, as wide as its container. */
function MonitorPreview({ config }: { config: OverlayConfig }) {
  const { state } = useLiveDashboard();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(160, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { canvas } = overlayReadout(config);
  const height = Math.round((width * canvas.height) / canvas.width);
  return (
    // "Program monitor": dark gameplay-ish backdrop with corner brackets.
    <div ref={ref} className="relative">
      <div
        className="relative overflow-hidden bg-[radial-gradient(ellipse_at_30%_20%,#2a1e48_0%,#10162b_50%,#070a14_100%)]"
        style={{ height }}
      >
        <OverlayView config={config} live={state.live} sizing={{ mode: "box", width, height }} />
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute -top-1 -left-1 size-3 border-t-2 border-l-2 border-cyan"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -right-1 -bottom-1 size-3 border-r-2 border-b-2 border-cyan"
      />
    </div>
  );
}

export function OverlaysPanel({ overlays }: { overlays: OverlaySummary[] }) {
  const t = useTranslations("Dashboard.overlays");
  const tb = useTranslations("Builder");
  const tc = useTranslations("Common");
  const { state } = useLiveDashboard();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const connected = state.overlayConnections;

  // Kind is chosen at creation and never changes (Phase 5.4A); both count toward the same limit.
  const create = (kind: CreatableOverlayKind) => {
    setError(null);
    startTransition(async () => {
      const res = await createOverlayAction(
        t("newOverlayName", { number: overlays.length + 1 }),
        "minimal",
        kind,
      );
      if (res.ok) router.push(`/dashboard/overlays/${res.data.overlayId}`);
      else setError(res.error);
    });
  };

  return (
    <div className="px-5 py-4">
      <ConsoleHeading
        aside={
          <span className="flex items-center gap-2 font-display text-sm font-bold tracking-[0.08em] uppercase">
            {connected > 0 ? <span className="live-dot" aria-hidden /> : <Dot tone="neutral" />}
            <span className={connected > 0 ? "text-win" : "text-muted"}>
              {t("connected", { count: connected })}
            </span>
          </span>
        }
      >
        {t("title")}
      </ConsoleHeading>

      {overlays.length === 0 && (
        <div className="mt-3 text-sm">
          <p className="text-text">{t("empty")}</p>
          <p className="mt-1 text-muted">{t("emptyAction")}</p>
        </div>
      )}
      <ul className="mt-3 space-y-5">
        {overlays.map((o) => {
          const readout = overlayReadout(o.config);
          return (
            <li key={o.id} className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-xl leading-tight font-bold">{o.name}</p>
                  <span className="hud-tag mt-1" data-testid="overlay-kind">
                    {t(`kinds.${readout.kind}.name`)}
                  </span>
                </div>
                <Link
                  href={`/dashboard/overlays/${o.id}`}
                  className={buttonClass("secondary", "sm")}
                >
                  {t("configure")}
                </Link>
              </div>

              <MonitorPreview config={o.config} />

              {/* Technical readout */}
              <dl className="grid grid-cols-3 border-y border-line text-sm">
                <div className="py-2 pr-2">
                  <dt className="hud-label text-xs">{t("canvas")}</dt>
                  <dd className="font-display text-base font-semibold tabular">
                    {readout.canvas.width} × {readout.canvas.height}
                  </dd>
                </div>
                <div className="border-l border-line px-3 py-2">
                  <dt className="hud-label text-xs">{t("language")}</dt>
                  <dd className="font-display text-base font-semibold">
                    {tc(`languageNames.${readout.locale}`)}
                  </dd>
                </div>
                {readout.theme !== null && (
                  <div className="border-l border-line py-2 pl-3">
                    <dt className="hud-label text-xs">{tb("sectionTheme")}</dt>
                    <dd className="font-display text-base font-semibold">
                      {tb(`themes.${readout.theme}.name`)}
                    </dd>
                  </div>
                )}
                {readout.style !== null && (
                  <div className="border-l border-line py-2 pl-3">
                    <dt className="hud-label text-xs">{t("style")}</dt>
                    <dd className="font-display text-base font-semibold">
                      {tb(`rankProgress.styles.${readout.style}.name`)}
                    </dd>
                  </div>
                )}
              </dl>

              <label className="block">
                <span className="hud-label text-xs">{t("url")}</span>
                <input
                  readOnly
                  value={o.url}
                  aria-label={t("urlAria")}
                  onFocus={(e) => e.currentTarget.select()}
                  className="mt-1 h-9 w-full border border-line bg-surface-0 px-2.5 font-mono text-xs text-muted focus:border-cyan focus:text-text focus:outline-none"
                />
              </label>
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
      <div className="mt-4 border-t border-dashed border-line pt-3">
        {choosing ? (
          <div className="space-y-2" role="group" aria-labelledby="new-overlay-kind">
            <p id="new-overlay-kind" className="hud-label text-xs">
              {t("chooseKind")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {CREATABLE_OVERLAY_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => create(kind)}
                  disabled={pending}
                  data-testid={`new-overlay-${kind}`}
                  className="border border-line-strong bg-surface-2/60 px-3 py-2.5 text-left transition-colors hover:border-cyan focus-visible:outline-2 focus-visible:outline-cyan disabled:opacity-50"
                >
                  <span className="block font-display text-base font-semibold tracking-[0.04em] uppercase">
                    {t(`kinds.${kind}.name`)}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {t(`kinds.${kind}.description`)}
                  </span>
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setChoosing(false)} disabled={pending}>
              {t("cancelNew")}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setChoosing(true)}
            disabled={pending}
            data-testid="new-overlay"
          >
            {t("newOverlay")}
          </Button>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}

export function ObsGuide({ width, height }: { width: number; height: number }) {
  const t = useTranslations("Dashboard.obs");
  const steps = [t("step1"), t("step2"), t("step3"), t("step4", { width, height }), t("step5")];
  return (
    <div className="px-5 py-4">
      <ConsoleHeading>{t("title")}</ConsoleHeading>
      <ol className="mt-3 text-sm">
        {steps.map((step, i) => (
          <li
            key={step}
            className="flex items-baseline gap-3 border-b border-line/70 py-1.5 last:border-b-0"
          >
            <span className="w-4 font-display text-base font-bold text-cyan tabular">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 border-l-2 border-blue bg-surface-2/60 px-3 py-2 text-xs leading-relaxed text-muted">
        <p className="font-display text-sm font-semibold tracking-wide text-text uppercase">
          {t("recommendedTitle")}
        </p>
        <p className="mt-1">
          {t.rich("recommendedBody", {
            b: (chunks) => <b className="text-text">{chunks}</b>,
          })}
        </p>
        <p className="mt-1 text-faint">{t("optionalNote")}</p>
      </div>
    </div>
  );
}
