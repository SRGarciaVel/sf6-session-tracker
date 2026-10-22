// @vitest-environment happy-dom
/**
 * M1 — loading skeletons: accessible semantics, no fabricated data, server-only (no extra
 * requests or client JS), reduced motion, and OBS isolation.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { LoadingRegion, SkeletonNumber, SkeletonText, SkeletonThumbnail } from "./Skeleton";
import {
  AnalyticsSkeleton,
  BuilderSkeleton,
  DashboardSkeleton,
  RecapSkeleton,
} from "./route-skeletons";

const ROUTES = {
  dashboard: DashboardSkeleton,
  analytics: AnalyticsSkeleton,
  recap: RecapSkeleton,
  builder: BuilderSkeleton,
} as const;

/** Text inside the decorative (aria-hidden) part of a rendered region. */
function hiddenText(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.querySelector("[aria-hidden]")?.textContent ?? null;
}

describe("LoadingRegion", () => {
  it("one polite status with the label, busy region, decorative shapes hidden", () => {
    const html = renderToString(
      <LoadingRegion label="Cargando el panel…" slowHint="Tardando…">
        <SkeletonText lines={2} />
      </LoadingRegion>,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const region = doc.querySelector("[data-skeleton]")!;
    expect(region.getAttribute("aria-busy")).toBe("true");
    const statuses = doc.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.textContent).toBe("Cargando el panel…");
    expect(region.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // Nothing focusable in a placeholder.
    expect(doc.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
    // The hint exists but only fades in after a real wait (CSS `.sk-slow`).
    expect(doc.querySelector(".sk-slow")?.textContent).toBe("Tardando…");
  });
});

describe.each(Object.entries(ROUTES))("%s skeleton", (_name, Skeleton) => {
  const html = renderToString(<Skeleton />);
  it("shows no text, numbers, statuses or ratings (only shapes)", () => {
    expect(new DOMParser().parseFromString(html, "text/html").body.textContent).toBe("");
  });
  it("has nothing focusable and no client hooks (server-only markup)", () => {
    expect(html).not.toMatch(/<(a|button|input|select|textarea)\b|tabindex=/);
  });
  it("inside a region, the shapes stay hidden from assistive technology", () => {
    const region = renderToString(
      <LoadingRegion label="x" slowHint="y">
        <Skeleton />
      </LoadingRegion>,
    );
    expect(hiddenText(region)).toBe("");
  });
});

describe("primitives", () => {
  it("text lines and numerals scale with the font size they stand for (em, no fixed px)", () => {
    const html = renderToString(
      <>
        <SkeletonText className="text-sm" lines={3} />
        <SkeletonNumber className="text-5xl" />
      </>,
    );
    expect(html.match(/class="sk-line"/g)).toHaveLength(3);
    expect(html).toContain("h-[0.82em]");
  });
  it("thumbnails keep the overlay's real aspect ratio", () => {
    expect(renderToString(<SkeletonThumbnail ratio={800 / 180} />)).toMatch(/aspect-ratio:4\.44/);
  });
});

describe("loading boundaries", () => {
  const DASH = "src/app/(app)/dashboard";
  const boundaries = [
    `${DASH}/loading.tsx`,
    `${DASH}/analytics/loading.tsx`,
    `${DASH}/sessions/[id]/loading.tsx`,
    `${DASH}/overlays/[id]/loading.tsx`,
  ];
  it("each audited route has its own boundary built on LoadingRegion (server component)", () => {
    for (const file of boundaries) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("LoadingRegion");
      expect(src).not.toContain('"use client"');
      expect(src).not.toMatch(/\bfetch\(|getDb|requireUser|requirePlayer|dashboardUiFor/);
    }
  });
  it("skeleton modules are server-only: no client directive, no data access", () => {
    for (const file of [
      "src/components/loading/Skeleton.tsx",
      "src/components/loading/route-skeletons.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toContain('"use client"');
      expect(src).not.toMatch(/\bfetch\(|EventSource|@\/server\//);
    }
  });
  it("every label exists in Spanish and English", () => {
    for (const key of ["dashboard", "analytics", "recap", "builder", "slow"] as const) {
      expect(es.Loading[key].length).toBeGreaterThan(3);
      expect(en.Loading[key].length).toBeGreaterThan(3);
    }
  });
  it("the boundary renders the localized label and hint", async () => {
    vi.resetModules();
    vi.doMock("next-intl/server", () => ({
      getTranslations: async () => (k: keyof typeof en.Loading) => en.Loading[k],
    }));
    const { default: AnalyticsLoading } = await import("@/app/(app)/dashboard/analytics/loading");
    const html = renderToString(await AnalyticsLoading());
    expect(html).toContain(en.Loading.analytics);
    expect(html).toContain(en.Loading.slow);
    vi.doUnmock("next-intl/server");
  });
});

describe("motion", () => {
  const css = readFileSync("src/app/(app)/globals.css", "utf8");
  it("CSS only: delayed fade-in (no flash on fast responses), one opacity pulse, delayed hint", () => {
    expect(css).toMatch(/\.sk-region\s*{\s*animation: sk-in \d+ms ease-out 150ms both;/);
    expect(css).toMatch(
      /\.sk-shapes\s*{\s*animation: sk-pulse [\d.]+s ease-in-out \d+ms infinite alternate;/,
    );
    expect(css).toMatch(/\.sk-slow\s*{\s*animation: sk-in \d+ms ease-out 2\.5s both;/);
    // Only opacity is animated (no filters, blur or animated gradients).
    const keyframes = css.match(/@keyframes sk-[\s\S]*?\n {2}}/g) ?? [];
    expect(keyframes.length).toBe(2);
    for (const k of keyframes) expect(k).not.toMatch(/filter|blur|background|transform/);
  });
  it("reduced motion collapses every animation (global rule)", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*\*,\s*\*::before,\s*\*::after\s*{\s*animation-duration: 1ms !important;\s*animation-iteration-count: 1 !important;/,
    );
  });
});

describe("OBS isolation", () => {
  const OVERLAY = "src/app/(overlay)";
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  it("no loading boundary or skeleton in the public overlay tree", () => {
    const all = files(OVERLAY);
    expect(all.some((f) => f.endsWith("loading.tsx"))).toBe(false);
    for (const f of all)
      expect(readFileSync(f, "utf8")).not.toMatch(/components\/loading|sk-region/);
  });
  it("the overlay root layout never loads the app stylesheet", () => {
    expect(existsSync(`${OVERLAY}/layout.tsx`)).toBe(true);
    expect(readFileSync(`${OVERLAY}/layout.tsx`, "utf8")).not.toContain("globals.css");
    expect(readFileSync("src/components/overlay/overlay.css", "utf8")).not.toMatch(/\.sk-/);
  });
});
