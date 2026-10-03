import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { getDb } from "@/server/db/client";
import { devToolsEnabled } from "@/server/env";
import { findPlayerByUserId } from "@/server/players/service";
import { requireUser } from "@/server/auth/session";
import { OnboardingFlow } from "./OnboardingFlow";

export const metadata: Metadata = { title: "Set up your player" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser();
  const existing = await findPlayerByUserId(getDb(), user.id);

  return (
    <main className="bg-slash flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold">
          {existing ? "Change your CFN player" : "Connect your SF6 player"}
        </h1>
        <p className="mt-1 mb-8 text-sm text-muted">
          {existing
            ? `Currently tracking ${existing.displayName} (${existing.cfnUserId}). Switching resets session history; your overlay URLs stay the same.`
            : "We only read public CFN data: name, rank, LP/MR and your match results."}
        </p>
        <OnboardingFlow devHint={devToolsEnabled()} />
        {existing && (
          <Link href="/dashboard" className="mt-6 block text-center text-sm text-muted hover:text-text">
            ← Back to dashboard
          </Link>
        )}
      </div>
    </main>
  );
}
