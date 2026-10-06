import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("forgotPassword") };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("Auth.forgot");
  return (
    <>
      <h1 className="font-display text-2xl font-bold">{t("title")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{t("subtitle")}</p>
      <ForgotPasswordForm />
    </>
  );
}
