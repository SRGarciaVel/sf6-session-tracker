import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prototypePagesEnabled } from "@/server/prototypes/gate";
import { LocalPortraitDock } from "./LocalPortraitDock";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Prototype.localPortrait");
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * PROTOTYPE — page for an OBS Custom Browser Dock (design/phase-m2/local-portrait-prototype.md).
 * No account data: it never reads or writes anything on the server.
 */
export default function LocalPortraitDockPage() {
  if (!prototypePagesEnabled()) notFound();
  return <LocalPortraitDock sourcePath="/prototype/obs-portrait/source" />;
}
