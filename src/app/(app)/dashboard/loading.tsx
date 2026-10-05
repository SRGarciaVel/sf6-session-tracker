import { getTranslations } from "next-intl/server";

/**
 * Streamed immediately while the dashboard renders. On the free beta the server may be waking
 * up, so say so in plain words instead of showing an unexplained blank page.
 */
export default async function DashboardLoading() {
  const t = await getTranslations("Common");
  return (
    <div role="status" className="hud-panel mx-auto mt-10 max-w-lg px-6 py-8 text-center">
      <p className="font-display text-xl font-bold tracking-wide uppercase">
        <span className="live-dot mr-2 inline-block align-middle" aria-hidden />
        {t("loadingDashboard")}
      </p>
      <p className="mt-2 text-sm text-muted">{t("slowServer")}</p>
    </div>
  );
}
