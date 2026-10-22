import { getTranslations } from "next-intl/server";
import { LoadingRegion } from "@/components/loading/Skeleton";
import { DashboardSkeleton } from "@/components/loading/route-skeletons";

/**
 * Streamed while the dashboard renders on the server (and shown on client navigation until the
 * new page arrives). Same footprint as the loaded dashboard; appears only after 150 ms, and the
 * free-tier "waking up" hint only after a real wait (M1, design/motion-loading/m1-audit.md).
 */
export default async function DashboardLoading() {
  const t = await getTranslations("Loading");
  return (
    <LoadingRegion label={t("dashboard")} slowHint={t("slow")}>
      <DashboardSkeleton />
    </LoadingRegion>
  );
}
