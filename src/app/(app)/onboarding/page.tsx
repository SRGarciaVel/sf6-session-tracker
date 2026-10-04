import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { Logo } from "@/components/ui/Logo";
import { getDb } from "@/server/db/client";
import { devToolsEnabled, getEnv } from "@/server/env";
import { listDevices, toDeviceSummary } from "@/server/companion/service";
import { CompanionPanel } from "../dashboard/_components/CompanionPanel";
import { findPlayerByUserId } from "@/server/players/service";
import { requireUser } from "@/server/auth/session";
import { OnboardingFlow } from "./OnboardingFlow";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("onboarding") };
}
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser();
  const db = getDb();
  const existing = await findPlayerByUserId(db, user.id);
  // Companion mode: CFN lookups are served from data the browser companion pushed, so the
  // companion must be paired BEFORE the CFN can be registered.
  const companionMode = getEnv().SF6_PROVIDER === "companion";
  const devices = companionMode ? await listDevices(db, user.id) : [];
  const t = await getTranslations("Onboarding");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex w-full max-w-lg items-center justify-between">
        <Logo />
        <LocaleSwitcher />
      </div>
      <div className="hud-panel animate-panel-in w-full max-w-lg p-6 sm:p-8">
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-magenta via-violet to-transparent"
        />
        <h1 className="font-display text-2xl font-bold">
          {existing ? t("titleChange") : t("titleNew")}
        </h1>
        <p className="mt-1 mb-8 text-sm text-muted">
          {existing
            ? t("introChange", { name: existing.displayName, cfnId: existing.cfnUserId })
            : t("introNew")}
        </p>
        {companionMode && (
          <div className="-mx-5 mb-6 border-y border-line">
            <CompanionPanel devices={devices.map(toDeviceSummary)} ingestEnabled />
          </div>
        )}
        <OnboardingFlow devHint={devToolsEnabled()} />
        {existing && (
          <Link
            href="/dashboard"
            className="mt-6 block text-center text-sm text-muted hover:text-text"
          >
            {t("backToDashboard")}
          </Link>
        )}
      </div>
    </main>
  );
}
