import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { parseAnalyticsMode, parseAnalyticsRange } from "@/domain/analytics/aggregate";
import { getPlayerAnalytics } from "@/server/analytics/service";
import { requirePlayer } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AnalyticsView } from "./_components/AnalyticsView";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("analytics") };
}
export const dynamic = "force-dynamic";

/** /dashboard/analytics?range=7d|30d|90d|all&mode=ranked|all — the signed-in player's own data. */
export default async function AnalyticsPage({ searchParams }: PageProps<"/dashboard/analytics">) {
  const params = await searchParams;
  const { player } = await requirePlayer(); // ownership: only the authenticated account's player
  const data = await getPlayerAnalytics(getDb(), player.id, {
    range: parseAnalyticsRange(params.range),
    mode: parseAnalyticsMode(params.mode),
  });
  return <AnalyticsView data={data} />;
}
