"use client";

/**
 * Password reset request. Existing and unknown addresses get the SAME message (Better Auth
 * answers identically; the email itself is queued without delaying the response).
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button, ErrorText, Input, Label } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import { RESET_PASSWORD_CALLBACK, authErrorKey } from "../auth-ui";

export function ForgotPasswordForm() {
  const t = useTranslations("Auth.forgot");
  const ta = useTranslations("Auth");
  const tc = useTranslations("Common");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setState("sending");
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    const { error: authError } = await authClient.requestPasswordReset({
      email,
      redirectTo: RESET_PASSWORD_CALLBACK,
    });
    const key = authError ? authErrorKey(authError) : null;
    if (key === "tooManyRequests" || key === "invalidEmail") {
      setState("idle");
      setError(ta(`errors.${key}`));
      return;
    }
    setState("done"); // same outcome whether or not the account exists
  };

  if (state === "done") {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm" data-testid="forgot-generic">
          {t("generic")}
        </p>
        <p className="text-sm text-muted">{t("checkSpam")}</p>
        <p className="text-center text-sm">
          <Link href="/login" className="text-magenta hover:underline">
            {t("backToLogin")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="email">{ta("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <ErrorText>{error}</ErrorText>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={state === "sending"}
      >
        {state === "sending" ? tc("oneMoment") : t("submit")}
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-magenta hover:underline">
          {t("backToLogin")}
        </Link>
      </p>
    </form>
  );
}
