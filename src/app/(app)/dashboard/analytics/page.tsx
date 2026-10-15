import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { parseAnalyticsSearchParams } from "@/domain/analytics/aggregate";
import { getPlayerAnalyticsForUser } from "@/server/analytics/service";
import { requirePlayer } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AnalyticsView } from "./_components/AnalyticsView";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("analytics") };
}
export const dynamic = "force-dynamic";

/**
 * /dashboard/analytics?range=7d|30d|90d|all&mode=ranked|all. Only range and mode come from the
 * URL; whose analytics is decided by the signed-in account (ownership enforced in the service).
 */
export default async function AnalyticsPage({ searchParams }: PageProps<"/dashboard/analytics">) {
  const query = parseAnalyticsSearchParams(await searchParams);
  const { user } = await requirePlayer(); // no player yet ⇒ onboarding
  const data = await getPlayerAnalyticsForUser(getDb(), user.id, query);
  if (!data) redirect("/onboarding");
  return <AnalyticsView data={data} />;
}
