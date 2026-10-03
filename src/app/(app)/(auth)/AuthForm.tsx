"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button, ErrorText, Input, Label } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";

type AuthErrorKey =
  | "invalidCredentials"
  | "userExists"
  | "passwordTooShort"
  | "invalidEmail"
  | "tooManyRequests"
  | "generic";

/** better-auth returns English messages; map its error codes to our translations. */
function authErrorKey(error: { code?: string; status?: number }): AuthErrorKey {
  const code = error.code ?? "";
  if (error.status === 429) return "tooManyRequests";
  if (code.includes("INVALID_EMAIL_OR_PASSWORD") || code.includes("INVALID_PASSWORD")) {
    return "invalidCredentials";
  }
  if (code.includes("ALREADY_EXISTS")) return "userExists";
  if (code.includes("PASSWORD_TOO_SHORT")) return "passwordTooShort";
  if (code.includes("INVALID_EMAIL")) return "invalidEmail";
  return "generic";
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const t = useTranslations("Auth");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim() || email.split("@")[0] || "Streamer";

    const { error: authError } =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });

    if (authError) {
      setPending(false);
      setError(t(`errors.${authErrorKey(authError)}`));
      return;
    }
    router.replace(mode === "signup" ? "/onboarding" : "/dashboard");
    router.refresh();
  };

  return (
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
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? tc("oneMoment") : mode === "signup" ? t("submitSignup") : t("submitLogin")}
      </Button>
      <p className="text-center text-sm text-muted">
        {mode === "signup" ? (
          <>
            {t("haveAccount")}{" "}
            <Link href="/login" className="text-accent hover:underline">
              {t("logIn")}
            </Link>
          </>
        ) : (
          <>
            {t("newHere")}{" "}
            <Link href="/signup" className="text-accent hover:underline">
              {t("createAnAccount")}
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
