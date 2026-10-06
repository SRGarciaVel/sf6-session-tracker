import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  // The token is in this page's URL until the form removes it: never send it as a Referer.
  return { title: (await getTranslations("Meta"))("resetPassword"), referrer: "no-referrer" };
}

/**
 * Target of Better Auth's /reset-password/:token redirect: `?token=…` when the token exists and
 * hasn't expired, `?error=INVALID_TOKEN` otherwise.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token =
    typeof params.token === "string" && params.token.length <= 256 ? params.token : null;
  const t = await getTranslations("Auth.reset");
  return (
    <>
      <h1 className="font-display text-2xl font-bold">{t("title")}</h1>
      <ResetPasswordForm token={params.error === undefined ? token : null} />
    </>
  );
}
