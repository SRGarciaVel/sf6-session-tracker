import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePlayer } from "@/server/auth/session";
import { buildDashboardLiveState } from "@/server/dashboard/state";
import { getDb } from "@/server/db/client";
import { getEntitlements } from "@/server/entitlements/service";
import { getEnv } from "@/server/env";
import { getOwnedOverlay } from "@/server/overlays/service";
import { LiveDashboardProvider } from "../../_components/LiveDashboard";
import { OverlayBuilder } from "./OverlayBuilder";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("overlayBuilder") };
}
export const dynamic = "force-dynamic";

export default async function OverlayBuilderPage({
  params,
}: PageProps<"/dashboard/overlays/[id]">) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { user, player } = await requirePlayer();
  const db = getDb();
  const overlay = await getOwnedOverlay(db, user.id, id); // IDOR-safe
  if (!overlay) notFound();
  const [live, entitlements] = await Promise.all([
    buildDashboardLiveState(db, player.id),
    getEntitlements(db, user.id),
  ]);
  if (!live) notFound();

  const url = `${getEnv().APP_URL.replace(/\/$/, "")}/overlay/${overlay.publicToken}`;
  return (
    <LiveDashboardProvider initial={live}>
      <OverlayBuilder
        overlayId={overlay.id}
        initialName={overlay.name}
        initialConfig={overlay.config}
        url={url}
        advancedCustomization={entitlements.overlays.advancedCustomization}
      />
    </LiveDashboardProvider>
  );
}
