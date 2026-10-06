"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button, ErrorText, Input, Label } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import { ResendVerification } from "./ResendVerification";
import { VERIFY_EMAIL_CALLBACK, authErrorKey, rememberPendingEmail } from "./auth-ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const t = useTranslations("Auth");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Login with the right password but an unverified email: offer a new link. */
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setUnverifiedEmail(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim() || email.split("@")[0] || "Streamer";

    if (mode === "signup") {
      // New AND already-registered addresses get the same response (Better Auth's
      // enumeration protection): both continue to "check your email".
      const { error: authError } = await authClient.signUp.email({
        email,
        password,
        name,
        callbackURL: VERIFY_EMAIL_CALLBACK,
      });
      if (authError) {
        setPending(false);
        setError(t(`errors.${authErrorKey(authError)}`));
        return;
      }
      rememberPendingEmail(email);
      router.replace("/verify-email");
      return;
    }

    const { error: authError } = await authClient.signIn.email({ email, password });
    if (authError) {
      setPending(false);
      const key = authErrorKey(authError);
      if (key === "emailNotVerified") setUnverifiedEmail(email);
      setError(t(`errors.${key}`));
      return;
    }
    // New accounts without a CFN player are sent on to onboarding by the dashboard.
    router.replace("/dashboard");
    router.refresh();
  };

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4">
        {mode === "signup" && (
          <div>
            <Label htmlFor="name">{t("displayName")}</Label>
            <Input
              id="name"
              name="name"
              autoComplete="nickname"
              maxLength={40}
              placeholder={t("displayNamePlaceholder")}
            />
          </div>
        )}
        <div>
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={8}
            maxLength={128}
            required
          />
        </div>
        <ErrorText>{error}</ErrorText>
        {mode === "login" && (
          <p className="text-right text-sm">
            <Link href="/forgot-password" className="text-cyan hover:underline">
              {t("forgotPassword")}
            </Link>
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? tc("oneMoment") : mode === "signup" ? t("submitSignup") : t("submitLogin")}
        </Button>
        <p className="text-center text-sm text-muted">
          {mode === "signup" ? (
            <>
              {t("haveAccount")}{" "}
              <Link href="/login" className="text-magenta hover:underline">
                {t("logIn")}
              </Link>
            </>
          ) : (
            <>
              {t("newHere")}{" "}
              <Link href="/signup" className="text-magenta hover:underline">
                {t("createAnAccount")}
              </Link>
            </>
          )}
        </p>
      </form>
      {unverifiedEmail && (
        <div className="mt-4 border-t border-line pt-4">
          <ResendVerification email={unverifiedEmail} />
        </div>
      )}
    </>
  );
}
