import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "../AuthForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("login") };
}

export default async function LoginPage() {
  const t = await getTranslations("Auth");
  return (
    <>
      <h1 className="mb-6 font-display text-2xl font-bold">{t("welcomeBack")}</h1>
      <AuthForm mode="login" />
    </>
  );
}
