/**
 * M1 — route skeletons, one per loading boundary that has a real wait (see
 * design/motion-loading/m1-audit.md). Each mirrors the loaded page's grid and proportions so
 * the content replaces it in place. They are identical for the classic and Fight Session
 * dashboards on purpose: the boundary renders before the per-account UI decision, so it never
 * depends on (or reveals) who is signed in or what they can see.
 */
import { OVERLAY_PRESETS } from "@/domain/overlay/config";
import { SkeletonBlock, SkeletonNumber, SkeletonText, SkeletonThumbnail } from "./Skeleton";

const OVERLAY_RATIO = OVERLAY_PRESETS.standard.width / OVERLAY_PRESETS.standard.height;

function Eyebrow({ className = "w-36" }: { className?: string }) {
  return <SkeletonText className={`text-[0.8125rem] ${className}`} widths={["100%"]} />;
}

/** Results bar (Prepare's last session / Recap): eyebrow + numeral cells on a ruled grid. */
function ResultsGrid({ cells = 3 }: { cells?: number }) {
  return (
    <div className="grid grid-cols-2 border-y border-line sm:grid-cols-3">
      {Array.from({ length: cells }, (_, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,1fr)] gap-3 border-line px-4 py-4 [&:not(:first-child)]:border-l"
        >
          <Eyebrow className="w-20" />
          <SkeletonNumber className="text-5xl" />
        </div>
      ))}
    </div>
  );
}

function OverlayRowSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 py-3">
      <div className="grid grid-cols-[minmax(0,min(11rem,40%))_minmax(0,1fr)] items-center gap-3">
        <SkeletonThumbnail ratio={OVERLAY_RATIO} />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <SkeletonText className="text-lg" widths={["70%"]} />
          <SkeletonBlock cut className="h-5 w-32" tone="soft" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <SkeletonBlock tone="accent" className="h-9 w-40" />
        <SkeletonBlock className="h-9 w-28" />
      </div>
    </div>
  );
}

/** The broadcast console column (same 400 px column and order as both dashboards). */
function ConsoleSkeleton({ className }: { className?: string }) {
  return (
    <div className={`hud-panel [--notch:18px] ${className ?? ""}`}>
      <div className="flex items-center gap-3 border-b border-line-strong px-5 py-2.5">
        <SkeletonBlock cut className="h-5 w-36" tone="soft" />
      </div>
      <div className="px-5 py-4">
        <Eyebrow className="w-32" />
        <div className="mt-1 divide-y divide-line">
          <OverlayRowSkeleton />
          <OverlayRowSkeleton />
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 border-t border-line px-5 py-4">
        <Eyebrow className="w-48" />
        <SkeletonText lines={2} className="text-xs" />
        <SkeletonText lines={2} className="text-sm" widths={["45%", "55%"]} />
      </div>
    </div>
  );
}

/** History panel: heading + table-shaped rows aligned with the real columns. */
function HistorySkeleton({ className }: { className?: string }) {
  return (
    <div className={`hud-panel ${className ?? ""}`}>
      <div className="px-5 pt-4">
        <Eyebrow className="w-44" />
      </div>
      <div className="mt-3 divide-y divide-line border-t border-line">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-5 px-5 py-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,7rem)_minmax(0,0.9fr)_minmax(0,10rem)_1rem]"
          >
            <SkeletonText lines={2} className="text-sm" widths={["40%", "60%"]} />
            <SkeletonBlock className="h-5 w-[min(4rem,16vw)]" />
            <SkeletonBlock tone="soft" className="hidden h-2 sm:block" />
            <SkeletonBlock className="h-5 w-[min(5rem,20vw)] justify-self-end" />
            <span className="hidden sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** /dashboard (PREPARE/LIVE or classic): stage + console + history, as laid out once loaded. */
export function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 hud:grid-cols-[minmax(0,1fr)_400px] hud:grid-rows-[auto_1fr]">
      <div className="min-w-0 space-y-5 hud:col-start-1">
        <SkeletonBlock tone="soft" className="h-12" />
        <section className="fs-stage grid grid-cols-[minmax(0,1fr)] gap-6 p-5 sm:p-9">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <Eyebrow />
            <SkeletonBlock className="h-12 w-[min(34rem,90%)] sm:h-[4.5rem]" />
            <SkeletonText className="text-lg" widths={["14rem"]} />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <SkeletonBlock tone="accent" cut className="h-16 w-full sm:w-[24rem]" />
            <SkeletonText lines={2} className="max-w-2xl text-sm" />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <Eyebrow className="w-32" />
            <ResultsGrid />
          </div>
        </section>
      </div>
      <ConsoleSkeleton className="hud:col-start-2 hud:row-span-2 hud:row-start-1" />
      <HistorySkeleton className="min-w-0 hud:col-start-1" />
    </div>
  );
}

/** /dashboard/analytics: header, filters, coverage note, section nav + metric panels. */
export function AnalyticsSkeleton() {
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <SkeletonBlock className="h-10 w-[min(22rem,80%)] sm:h-12" />
        <SkeletonText className="text-sm" widths={["min(30rem,90%)"]} />
      </div>
      <div className="hud-panel flex flex-wrap gap-x-6 gap-y-3 p-4">
        {[4, 2, 1].map((n, g) => (
          <div key={g} className="grid grid-cols-[minmax(0,1fr)] gap-2">
            <Eyebrow className="w-16" />
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: n }, (_, i) => (
                <SkeletonBlock key={i} className="h-9 w-20" tone={i === 0 ? "base" : "soft"} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <SkeletonBlock tone="soft" className="h-12 border-l-2 border-l-cyan/40" />
      <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10">
        <div className="hidden gap-4 lg:grid lg:content-start">
          {[3, 2, 1, 1].map((n, g) => (
            <div key={g} className="grid grid-cols-[minmax(0,1fr)] gap-1">
              <Eyebrow className="w-20" />
              <SkeletonText lines={n} className="text-sm" widths={["70%", "55%", "62%"]} />
            </div>
          ))}
        </div>
        <div className="min-w-0 space-y-10 pt-4 lg:pt-0">
          {[4, 1].map((cells, s) => (
            <section key={s} className="grid grid-cols-[minmax(0,1fr)] gap-3">
              <Eyebrow className="w-24" />
              <SkeletonBlock className="h-7 w-48" />
              <div
                className={`hud-panel grid gap-px ${cells === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-[minmax(0,1fr)]"}`}
              >
                {Array.from({ length: cells }, (_, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
                    <Eyebrow className="w-24" />
                    {cells === 4 ? (
                      <SkeletonNumber className="text-2xl" width="3ch" />
                    ) : (
                      <SkeletonText lines={2} className="text-sm" />
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** /dashboard/sessions/[id]: heading + actions, results, characters, matches. */
export function RecapSkeleton() {
  return (
    <div className="mx-auto grid grid-cols-[minmax(0,1fr)] max-w-4xl gap-6">
      <section className="fs-stage grid grid-cols-[minmax(0,1fr)] gap-6 p-5 sm:p-9">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <Eyebrow className="w-44" />
          <SkeletonBlock className="h-12 w-[min(30rem,85%)] sm:h-[4.5rem]" />
          <SkeletonText className="text-sm" widths={["16rem"]} />
        </div>
        <div className="flex flex-wrap gap-3">
          <SkeletonBlock tone="accent" cut className="h-14 w-full sm:w-[22rem]" />
          <SkeletonBlock cut className="h-11 w-40" />
        </div>
        <ResultsGrid />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <Eyebrow className="w-48" />
          <SkeletonBlock tone="soft" className="h-16 border-l-4 border-l-cyan/40" />
        </div>
      </section>
      <section className="fs-stage grid grid-cols-[minmax(0,1fr)] gap-2 p-5 sm:p-7">
        <Eyebrow className="w-40" />
        <div className="divide-y divide-line">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-2"
            >
              <SkeletonBlock cut className="h-7 w-7" />
              <SkeletonText widths={["45%"]} />
              <SkeletonBlock tone="soft" className="h-4 w-12" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** /dashboard/overlays/[id]: header, editor panel and the preview column (first on mobile). */
export function BuilderSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <SkeletonText className="text-sm" widths={["7rem"]} />
          <div className="flex flex-wrap items-center gap-3">
            <SkeletonBlock className="h-7 w-48" />
            <SkeletonBlock tone="soft" className="h-8 w-56" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SkeletonBlock tone="soft" className="h-8 w-24" />
          <SkeletonBlock tone="accent" className="hidden h-10 w-56 lg:block" />
        </div>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4 lg:order-2">
          <div className="hud-panel grid grid-cols-[minmax(0,1fr)] gap-4 p-5">
            <Eyebrow className="w-44" />
            <SkeletonThumbnail ratio={OVERLAY_RATIO} />
            <SkeletonText className="text-xs" widths={["60%"]} />
          </div>
          <div className="hud-panel grid grid-cols-[minmax(0,1fr)] gap-3 p-5">
            <Eyebrow className="w-52" />
            <SkeletonBlock tone="soft" className="h-9" />
            <div className="flex flex-wrap gap-2">
              <SkeletonBlock tone="accent" className="h-9 w-36" />
              <SkeletonBlock className="h-9 w-32" />
            </div>
          </div>
        </div>
        <div className="hud-panel min-w-0 lg:order-1">
          <div className="grid grid-cols-4 gap-4 border-b border-line-strong px-4 py-3">
            {["80%", "80%", "65%", "70%"].map((w, i) => (
              <SkeletonText key={i} className="text-sm" widths={[w]} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <SkeletonThumbnail ratio={2.2} />
                <SkeletonText className="text-xs" widths={["50%"]} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
