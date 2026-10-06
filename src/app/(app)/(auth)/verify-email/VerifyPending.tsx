"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { ResendVerification } from "../ResendVerification";
import { maskEmail, readPendingEmail } from "../auth-ui";

const subscribe = () => () => {};

export function VerifyPending() {
  const t = useTranslations("Auth.verify");
  // Read from this tab's sessionStorage on the client only (null during SSR).
  const email = useSyncExternalStore(subscribe, readPendingEmail, () => null);

  return (
    <div className="mt-3 space-y-4">
      <p className="text-sm text-muted" data-testid="verify-pending">
        {email
          ? t.rich("pendingBodyMasked", {
              email: () => <strong className="text-text">{maskEmail(email)}</strong>,
            })
          : t("pendingBody")}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>{t("pendingExpires")}</li>
        <li>{t("pendingSpam")}</li>
      </ul>
      <div className="border-t border-line pt-4">
        <p className="mb-3 text-sm">{t("notReceived")}</p>
        <ResendVerification email={email} />
      </div>
      <p className="text-center text-sm text-muted">
        <Link href="/login" className="text-magenta hover:underline">
          {t("backToLogin")}
        </Link>
      </p>
    </div>
  );
}
