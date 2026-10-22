import { getTranslations } from "next-intl/server";
import { LoadingRegion } from "@/components/loading/Skeleton";
import { RecapSkeleton } from "@/components/loading/route-skeletons";

/** M1: this route's own footprint while it renders (replaces the dashboard-wide boundary). */
export default async function RecapLoading() {
  const t = await getTranslations("Loading");
  return (
    <LoadingRegion label={t("recap")} slowHint={t("slow")}>
      <RecapSkeleton />
    </LoadingRegion>
  );
}
