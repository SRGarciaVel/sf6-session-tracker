import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { OVERLAY_PRESETS } from "@/domain/overlay/config";
import { requirePlayer } from "@/server/auth/session";
import { buildDashboardLiveState } from "@/server/dashboard/state";
import { getDb } from "@/server/db/client";
import { devToolsEnabled, getEnv } from "@/server/env";
import { listOverlays } from "@/server/overlays/service";
import { listSessionHistory } from "@/server/sessions/service";
import { getCompanionRelease } from "@/server/companion/release";
import { getEntitlements, getPlanSummary } from "@/server/entitlements/service";
import { getEffectiveOverlayConfig } from "@/domain/overlay/creator";
import { companionIngestEnabled, listDevices, toDeviceSummary } from "@/server/companion/service";
import { CompanionPanel } from "./_components/CompanionPanel";
import { CreatorBetaPanel } from "./_components/CreatorBetaPanel";
import { DevTools } from "./_components/DevTools";
import { demoDataReason } from "@/server/dev/demo";
import { LiveDashboardProvider } from "./_components/LiveDashboard";
import { ObsGuide, OverlaysPanel } from "./_components/OverlaysPanel";
import { PlayerHeader, SessionPanel, StatusBar } from "./_components/SessionPanel";
import { SessionHistory } from "./_components/SessionHistory";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("dashboard") };
}
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, player } = await requirePlayer();
  const db = getDb();
  const [live, overlays, history, devices, planSummary, entitlements] = await Promise.all([
    buildDashboardLiveState(db, player.id),
    listOverlays(db, player.id),
    listSessionHistory(db, player, 10),
    listDevices(db, user.id),
    getPlanSummary(db, user.id),
    getEntitlements(db, user.id),
  ]);
  if (!live) notFound();

  const appUrl = getEnv().APP_URL.replace(/\/$/, "");
  const overlaySummaries = overlays.map((o) => ({
    id: o.id,
    name: o.name,
    url: `${appUrl}/overlay/${o.publicToken}`,
    // Same effective config as OBS (Creator customization only while entitled).
    config: getEffectiveOverlayConfig(o.config, entitlements),
  }));
  const firstPreset = OVERLAY_PRESETS[overlays[0]?.config.preset ?? "standard"];

  // Not paired yet in companion mode: pairing is the first thing to do, so it leads the console.
  const { latestVersion, downloadUrl } = getCompanionRelease();
  const release = { latestVersion, downloadUrl };
  const companionFirst = companionIngestEnabled() && devices.length === 0;
  const companionPanel = (
    <CompanionPanel
      devices={devices.map(toDeviceSummary)}
      ingestEnabled={companionIngestEnabled()}
      release={release}
    />
  );
  const tConsole = await getTranslations("Dashboard.console");
  const tDemo = await getTranslations("Dashboard.demo");
  const demoReason =
    getEnv().NODE_ENV === "production"
      ? null
      : demoDataReason(getEnv().SF6_PROVIDER, player.cfnUserId);

  return (
    <LiveDashboardProvider initial={live}>
      <div className="grid items-start gap-5 hud:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-5">
          {demoReason && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-3 border-l-2 border-warn bg-surface-2/60 px-4 py-2 text-sm"
            >
              <span className="hud-tag bg-warn/20 text-warn">{tDemo("badge")}</span>
              <span className="text-muted">{tDemo(demoReason)}</span>
            </div>
          )}
          <PlayerHeader />
          <SessionPanel />
          <SessionHistory items={history} />
        </div>

        {/* Control room: one continuous console, modules separated by rules — not a card stack. */}
        <aside className="hud-panel animate-panel-in [--notch:18px]">
          <div className="flex items-center gap-3 border-b border-line-strong bg-surface-0/80 px-5 py-2.5">
            <span className="hud-tag bg-blue/20 text-heading">{tConsole("title")}</span>
            <span
              aria-hidden
              className="h-px flex-1 bg-gradient-to-r from-line-strong to-transparent"
            />
          </div>
          {companionFirst && <div className="border-b border-line">{companionPanel}</div>}
          <div className="divide-y divide-line md:grid md:grid-cols-2 md:divide-y-0 hud:block hud:divide-y">
            <div className="md:border-r md:border-line hud:border-r-0">
              <OverlaysPanel overlays={overlaySummaries} />
            </div>
            <div className="divide-y divide-line">
              <ObsGuide width={firstPreset.width} height={firstPreset.height} />
              {!companionFirst && companionPanel}
              <CreatorBetaPanel plan={planSummary.plan} activeUntil={planSummary.activeUntil} />
              {devToolsEnabled() && <DevTools />}
            </div>
          </div>
        </aside>
      </div>
      <StatusBar />
    </LiveDashboardProvider>
  );
}
