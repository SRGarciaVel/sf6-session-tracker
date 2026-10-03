import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { Logo } from "@/components/ui/Logo";
import { getDb } from "@/server/db/client";
import { devToolsEnabled } from "@/server/env";
import { findPlayerByUserId } from "@/server/players/service";
import { requireUser } from "@/server/auth/session";
import { OnboardingFlow } from "./OnboardingFlow";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("onboarding") };
}
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser();
  const existing = await findPlayerByUserId(getDb(), user.id);
  const t = await getTranslations("Onboarding");

  return (
    <main className="bg-slash flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex w-full max-w-lg items-center justify-between">
        <Logo />
        <LocaleSwitcher />
      </div>
      <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold">
          {existing ? t("titleChange") : t("titleNew")}
        </h1>
        <p className="mt-1 mb-8 text-sm text-muted">
          {existing
            ? t("introChange", { name: existing.displayName, cfnId: existing.cfnUserId })
            : t("introNew")}
        </p>
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
