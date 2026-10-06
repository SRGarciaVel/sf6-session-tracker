"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { Button, ErrorText, Input, Label, buttonClass } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import { authErrorKey } from "../auth-ui";

export function ResetPasswordForm({ token }: { token: string | null }) {
  const t = useTranslations("Auth.reset");
  const ta = useTranslations("Auth");
  const tc = useTranslations("Common");
  const [state, setState] = useState<"form" | "sending" | "done" | "invalid">(
    token ? "form" : "invalid",
  );
  const [error, setError] = useState<string | null>(null);

  // Drop the token from the address bar/history once it is in memory.
  useEffect(() => {
    if (token) window.history.replaceState(null, "", window.location.pathname);
  }, [token]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setError(null);
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password") ?? "");
    if (newPassword !== String(form.get("confirm") ?? "")) {
      setError(t("mismatch"));
      return;
    }
    setState("sending");
    const { error: authError } = await authClient.resetPassword({ newPassword, token });
    if (!authError) {
      setState("done");
      return;
    }
    const key = authErrorKey(authError);
    if (key === "passwordTooShort" || key === "passwordTooLong" || key === "tooManyRequests") {
      setState("form");
      setError(ta(`errors.${key}`));
      return;
    }
    setState("invalid"); // invalid, expired or already used: all the same to the user
  };

  if (state === "done") {
    return (
      <div className="mt-3 space-y-4" data-testid="reset-success">
        <p role="status" className="text-sm text-muted">
          {t("successBody")}
        </p>
        <Link href="/login" className={buttonClass("primary", "lg") + " w-full"}>
          {t("successCta")}
        </Link>
      </div>
    );
  }
  if (state === "invalid") {
    return (
      <div className="mt-3 space-y-4" data-testid="reset-invalid">
        <p role="alert" className="text-sm text-muted">
          {t("invalidBody")}
        </p>
        <Link href="/forgot-password" className={buttonClass("primary", "lg") + " w-full"}>
          {t("requestNew")}
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-4">
      <p className="text-sm text-muted">{t("subtitle")}</p>
      <div>
        <Label htmlFor="password">{t("newPassword")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="mt-1 text-xs text-faint">
          {t("hint")}
        </p>
      </div>
      <div>
        <Label htmlFor="confirm">{t("confirmPassword")}</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
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
    </form>
  );
}
