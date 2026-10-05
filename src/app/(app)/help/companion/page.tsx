import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { CopyButton } from "@/components/ui/CopyButton";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { Logo } from "@/components/ui/Logo";
import { buttonClass } from "@/components/ui/primitives";
import { getCurrentUser } from "@/server/auth/session";
import { getEnv } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("helpCompanion") };
}
export const dynamic = "force-dynamic";

const BUCKLER_URL = "https://www.streetfighter.com/6/buckler/";
/** Browsers don't let web pages link to these; the user pastes them in the address bar. */
const EXTENSION_PAGES = [
  { browser: "Chrome", address: "chrome://extensions" },
  { browser: "Brave", address: "brave://extensions" },
  { browser: "Edge", address: "edge://extensions" },
] as const;

const STEPS = ["step1", "step2", "step3", "step4", "step5", "step6", "step7", "step8"] as const;

/** Beta install guide for the companion: one page, plain language, no developer jargon. */
export default async function CompanionHelpPage() {
  const t = await getTranslations("Help");
  const user = await getCurrentUser();
  const downloadUrl = getEnv().COMPANION_DOWNLOAD_URL ?? null;

  const extra: Partial<Record<(typeof STEPS)[number], React.ReactNode>> = {
    step1: downloadUrl ? (
      <a href={downloadUrl} className={buttonClass("primary", "sm")} download>
        {t("download")}
      </a>
    ) : (
      <p className="text-sm text-warn">{t("downloadMissing")}</p>
    ),
    step3: (
      <ul className="space-y-2">
        {EXTENSION_PAGES.map(({ browser, address }) => (
          <li key={browser} className="flex flex-wrap items-center gap-3">
            <span className="w-14 font-display text-sm font-bold uppercase">{browser}</span>
            <code className="border border-line bg-surface-0 px-2 py-1 font-mono text-sm select-all">
              {address}
            </code>
            <CopyButton
              value={address}
              size="sm"
              variant="secondary"
              ariaLabel={t("copyAddressAria", { address })}
            />
          </li>
        ))}
      </ul>
    ),
    step7: (
      <a
        href={BUCKLER_URL}
        target="_blank"
        rel="noreferrer"
        className={buttonClass("secondary", "sm")}
      >
        {t("openBuckler")}
      </a>
    ),
    step8: (
      <Link
        href={user ? "/dashboard#companion" : "/signup"}
        className={buttonClass("primary", "sm")}
      >
        {user ? t("goDashboard") : t("goSignup")}
      </Link>
    ),
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 pb-16 sm:px-6">
      <nav className="flex items-center justify-between py-6">
        <Logo />
        <LocaleSwitcher />
      </nav>

      <section className="hud-panel animate-panel-in p-6 sm:p-8">
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-magenta via-violet to-cyan"
        />
        <span className="hud-tag bg-magenta text-white">{t("eyebrow")}</span>
        <h1 className="mt-3 font-display text-3xl leading-tight font-bold sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t("intro")}</p>
        <p className="mt-3 border-l-2 border-blue bg-surface-2/60 px-3 py-2 text-sm text-muted">
          {t("betaNote")}
        </p>

        <h2 className="hud-heading mt-8">{t("stepsTitle")}</h2>
        <ol className="mt-3 divide-y divide-line/70">
          {STEPS.map((step, i) => (
            <li key={step} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 py-3">
              <span className="font-display text-2xl leading-none font-bold text-cyan tabular">
                {i + 1}
              </span>
              <div className="space-y-2">
                <p className="text-sm leading-relaxed">{t(step)}</p>
                {extra[step]}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-5 grid gap-5 md:grid-cols-3">
        {(
          [
            ["warningTitle", "warningBody"],
            ["updateTitle", "updateBody"],
            ["privacyTitle", "privacyBody"],
          ] as const
        ).map(([title, body]) => (
          <div key={title} className="hud-panel p-5">
            <h2 className="hud-heading text-base">{t(title)}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t(body)}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
