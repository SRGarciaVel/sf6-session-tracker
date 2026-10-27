import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prototypePagesEnabled } from "@/server/prototypes/gate";
import { LocalPortraitSource } from "./LocalPortraitSource";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * PROTOTYPE — page for an OBS Browser Source (design/phase-m2/local-portrait-prototype.md). It
 * lives in the (overlay) group: transparent, no dashboard CSS. It reads the image the dock kept
 * in IndexedDB; the server only renders the empty shell and its labels.
 */
export default async function LocalPortraitSourcePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!prototypePagesEnabled()) notFound();
  const t = await getTranslations("Prototype.localPortrait.source");
  const debug = (await searchParams).debug === "1";
  return (
    <LocalPortraitSource
      debug={debug}
      labels={{ empty: t("empty"), loading: t("loading"), error: t("error") }}
    />
  );
}
