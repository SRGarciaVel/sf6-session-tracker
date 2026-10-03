import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OVERLAY_PRESETS } from "@/domain/overlay/config";
import { requirePlayer } from "@/server/auth/session";
import { buildDashboardLiveState } from "@/server/dashboard/state";
import { getDb } from "@/server/db/client";
import { devToolsEnabled, getEnv } from "@/server/env";
import { listOverlays } from "@/server/overlays/service";
import { listSessionHistory } from "@/server/sessions/service";
import { DevTools } from "./_components/DevTools";
import { LiveDashboardProvider } from "./_components/LiveDashboard";
import { ObsGuide, OverlaysPanel } from "./_components/OverlaysPanel";
import { PlayerHeader, SessionPanel } from "./_components/SessionPanel";
import { SessionHistory } from "./_components/SessionHistory";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { player } = await requirePlayer();
  const db = getDb();
  const [live, overlays, history] = await Promise.all([
    buildDashboardLiveState(db, player.id),
    listOverlays(db, player.id),
    listSessionHistory(db, player, 10),
  ]);
  if (!live) notFound();

  const appUrl = getEnv().APP_URL.replace(/\/$/, "");
  const overlaySummaries = overlays.map((o) => ({
    id: o.id,
    name: o.name,
    url: `${appUrl}/overlay/${o.publicToken}`,
    config: o.config,
  }));
  const firstPreset = OVERLAY_PRESETS[overlays[0]?.config.preset ?? "standard"];

  return (
    <LiveDashboardProvider initial={live}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <PlayerHeader characterFallback={player.mainCharacter} />
          <SessionPanel />
          <SessionHistory items={history} />
        </div>
        <aside className="space-y-6">
          <OverlaysPanel overlays={overlaySummaries} />
          <ObsGuide width={firstPreset.width} height={firstPreset.height} />
          {devToolsEnabled() && <DevTools />}
        </aside>
      </div>
    </LiveDashboardProvider>
  );
}
