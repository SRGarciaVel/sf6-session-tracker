import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "../AuthForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("signup") };
}

export default async function SignupPage() {
  const t = await getTranslations("Auth");
  return (
    <>
      <h1 className="font-display text-2xl font-bold">{t("createTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{t("createSubtitle")}</p>
      <AuthForm mode="signup" />
    </>
  );
}
