import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";
import { isCreatableOverlayKind } from "@/domain/overlay/kind";
import { presetKindOf } from "@/domain/overlay/presets";
import { requirePlayer } from "@/server/auth/session";
import { buildDashboardLiveState } from "@/server/dashboard/state";
import { getDb } from "@/server/db/client";
import { getEntitlements } from "@/server/entitlements/service";
import { getEnv } from "@/server/env";
import { listPresets } from "@/server/overlays/presets";
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
  // Kind is immutable and only implemented kinds have an editor (Phase 5.4A): a row of another /
  // unknown kind is shown as not editable rather than opened in the wrong builder.
  if (!isCreatableOverlayKind(overlay.storedKind)) {
    const t = await getTranslations("Errors");
    return (
      <div className="hud-panel p-5" data-testid="overlay-kind-unsupported">
        <p className="text-sm text-muted">{t("overlayKindUnsupported")}</p>
      </div>
    );
  }
  const kind = overlay.storedKind;
  const [live, entitlements, presets] = await Promise.all([
    buildDashboardLiveState(db, player.id),
    getEntitlements(db, user.id),
    listPresets(db, user.id), // the signed-in account's own presets only
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
        access={{
          advancedCustomization: entitlements.overlays.advancedCustomization,
          premiumThemes: entitlements.overlays.premiumThemes,
          creatorPresets: entitlements.overlays.creatorPresets,
          motionEffects: entitlements.overlays.motionEffects,
          characterRotation: entitlements.overlays.characterRotation,
          brandFlag: entitlements.overlays.brandFlag,
        }}
        presets={presets
          // Only presets of this overlay's kind (unusable ones stay listed so they can be removed).
          .filter((p) => p.appearance === null || presetKindOf(p.appearance) === kind)
          .map((p) => ({
            id: p.id,
            name: p.name,
            theme: p.appearance?.theme ?? null,
          }))}
      />
    </LiveDashboardProvider>
  );
}
