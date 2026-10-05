import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { OverlayView } from "@/components/overlay/OverlayView";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { Logo } from "@/components/ui/Logo";
import { buttonClass } from "@/components/ui/primitives";
import { DEFAULT_OVERLAY_CONFIG, applyThemeDefaults } from "@/domain/overlay/config";
import { sampleLiveState } from "@/domain/overlay/state";
import { isLocale } from "@/i18n/locale";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

const STEPS = [1, 2, 3] as const;

export default async function LandingPage() {
  const user = await getCurrentUser();
  const live = sampleLiveState();
  const t = await getTranslations("Landing");
  const tc = await getTranslations("Common");
  const locale = await getLocale();
  // Example overlays follow the visitor's language.
  const previewLocale = isLocale(locale) ? locale : DEFAULT_OVERLAY_CONFIG.locale;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 sm:px-6">
      <nav className="flex items-center justify-between py-6">
        <Logo size="lg" />
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          {user ? (
            <Link href="/dashboard" className={buttonClass("primary", "sm")}>
              {t("openDashboard")}
            </Link>
          ) : (
            <>
              <Link href="/login" className={buttonClass("ghost", "sm")}>
                {t("login")}
              </Link>
              <Link href="/signup" className={buttonClass("primary", "sm")}>
                {t("getStarted")}
              </Link>
            </>
          )}
        </div>
      </nav>

      <section className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="font-display text-xs font-semibold tracking-[0.3em] text-magenta uppercase">
            {t("eyebrow")}
          </p>
          <h1 className="mt-4 font-display text-4xl leading-[1.05] font-bold tracking-tight sm:text-6xl">
            {t("titleLine1")}
            <br />
            <span className="text-magenta">{t("titleLine2")}</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted">{t("subtitle")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={user ? "/dashboard" : "/signup"} className={buttonClass("primary", "lg")}>
              {user ? t("goToDashboard") : t("createAccount")}
            </Link>
          </div>
        </div>

        <div className="space-y-4">
          {(["fighter", "competitive", "minimal"] as const).map((theme) => (
            <div
              key={theme}
              className="hud-panel overflow-hidden bg-[radial-gradient(ellipse_at_30%_20%,#2a1e48_0%,#10162b_55%,#070a14_100%)] [--notch:10px]"
            >
              <div className="aspect-[800/180]">
                <OverlayView
                  config={{
                    ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme),
                    locale: previewLocale,
                  }}
                  live={live}
                  sizing={{ mode: "box", width: 520, height: 117 }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="hud-panel grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {STEPS.map((n) => (
          <div key={n} className="p-6">
            <span className="font-display text-3xl leading-none font-extrabold text-cyan italic">
              0{n}
            </span>
            <h3 className="mt-2 font-display text-xl font-bold uppercase">{t(`step${n}Title`)}</h3>
            <p className="mt-1 text-sm text-muted">{t(`step${n}Body`)}</p>
          </div>
        ))}
      </section>

      <footer className="py-10 text-xs text-faint">{tc("notAffiliated")}</footer>
    </main>
  );
}
