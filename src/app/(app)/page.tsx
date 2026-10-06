import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BuiltForFightingGames } from "@/components/landing/BuiltForFightingGames";
import { CreatorPreview } from "@/components/landing/CreatorPreview";
import { FinalCta } from "@/components/landing/FinalCta";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingMotion } from "@/components/landing/LandingMotion";
import { LiveSessionStory } from "@/components/landing/LiveSessionStory";
import { OverlayShowcase } from "@/components/landing/OverlayShowcase";
import "@/components/landing/landing.css";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { Logo } from "@/components/ui/Logo";
import { buttonClass } from "@/components/ui/primitives";
import { DEFAULT_OVERLAY_CONFIG } from "@/domain/overlay/config";
import { isLocale } from "@/i18n/locale";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/**
 * Phase 4.7 landing: a scroll-driven product story (docs/landing.md). Scenes:
 * hero → live session → how it works → overlay showcase → Creator preview → fighting games →
 * final CTA. All copy is server-rendered text; motion only enhances it.
 */
export default async function LandingPage() {
  const user = await getCurrentUser();
  const t = await getTranslations("Landing");
  const tc = await getTranslations("Common");
  const locale = await getLocale();
  // Demo overlays follow the visitor's language.
  const previewLocale = isLocale(locale) ? locale : DEFAULT_OVERLAY_CONFIG.locale;
  const primary = user
    ? { href: "/dashboard", label: t("goToDashboard") }
    : { href: "/signup", label: t("createAccount") };

  return (
    <LandingMotion>
      <div className="mx-auto max-w-6xl overflow-x-clip px-4 sm:px-6">
        <nav aria-label={t("navLabel")} className="flex items-center justify-between py-6">
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

        <main>
          <Hero locale={previewLocale} primary={primary} />
          <LiveSessionStory locale={previewLocale} />
          <HowItWorks />
          <OverlayShowcase locale={previewLocale} />
          <CreatorPreview locale={previewLocale} />
          <BuiltForFightingGames />
          <FinalCta primary={primary} />
        </main>

        <footer className="border-t border-line py-10 text-xs text-faint">
          {tc("notAffiliated")}
        </footer>
      </div>
    </LandingMotion>
  );
}
