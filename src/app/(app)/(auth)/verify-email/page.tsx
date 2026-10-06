import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { VerifyPending } from "./VerifyPending";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("verifyEmail") };
}

/** "Check your email" after sign-up (no session exists until the link is opened). */
export default async function VerifyEmailPage() {
  const t = await getTranslations("Auth.verify");
  return (
    <>
      <h1 className="font-display text-2xl font-bold">{t("pendingTitle")}</h1>
      <VerifyPending />
    </>
  );
}
