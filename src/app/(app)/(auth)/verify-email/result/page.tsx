import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/ui/primitives";
import { ResendVerification } from "../../ResendVerification";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("verifyEmail"), referrer: "no-referrer" };
}

/**
 * Where Better Auth's /verify-email redirects (callbackURL). Success = no `error` parameter
 * (also for a link opened twice: the account is already verified). Errors are mapped to our
 * own copy; Better Auth's codes and messages are never shown.
 */
export default async function VerifyEmailResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("Auth.verify");
  const error = (await searchParams).error;
  if (error === undefined) {
    return (
      <div className="space-y-4" data-testid="verify-success">
        <h1 className="font-display text-2xl font-bold">{t("successTitle")}</h1>
        <p role="status" className="text-sm text-muted">
          {t("successBody")}
        </p>
        <Link href="/login" className={buttonClass("primary", "lg") + " w-full"}>
          {t("successCta")}
        </Link>
      </div>
    );
  }
  const expired = error === "TOKEN_EXPIRED";
  return (
    <div className="space-y-4" data-testid={expired ? "verify-expired" : "verify-invalid"}>
      <h1 className="font-display text-2xl font-bold">
        {expired ? t("expiredTitle") : t("invalidTitle")}
      </h1>
      <p role="alert" className="text-sm text-muted">
        {expired ? t("expiredBody") : t("invalidBody")}
      </p>
      <ResendVerification />
      <p className="text-center text-sm">
        <Link href="/login" className="text-magenta hover:underline">
          {t("backToLogin")}
        </Link>
      </p>
    </div>
  );
}
