"use client";

/**
 * "Resend verification email" with a visible cooldown. The response is the same whether or not
 * an account exists / is already verified (Better Auth), so the UI only ever says "if there is a
 * pending account, a new link is on its way". Server limits: per IP and per email.
 */
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { Button, ErrorText, Input, Label } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import { RESEND_COOLDOWN_SECONDS, VERIFY_EMAIL_CALLBACK, authErrorKey } from "./auth-ui";

export function ResendVerification({ email: knownEmail }: { email?: string | null }) {
  const t = useTranslations("Auth.verify");
  const ta = useTranslations("Auth");
  const [email, setEmail] = useState(knownEmail ?? "");
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const resend = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!email || cooldown > 0) return;
    setError(null);
    setStatus("sending");
    const { error: authError } = await authClient.sendVerificationEmail({
      email: email.trim(),
      callbackURL: VERIFY_EMAIL_CALLBACK,
    });
    if (authError && authErrorKey(authError) === "tooManyRequests") {
      setStatus("idle");
      setError(ta("errors.tooManyRequests"));
      setCooldown(RESEND_COOLDOWN_SECONDS);
      return;
    }
    if (authError && authErrorKey(authError) === "invalidEmail") {
      setStatus("idle");
      setError(ta("errors.invalidEmail"));
      return;
    }
    // Any other outcome looks the same to the user (no account-state oracle).
    setStatus("sent");
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  return (
    <form onSubmit={resend} className="space-y-3" data-testid="resend-verification">
      {!knownEmail && (
        <div>
          <Label htmlFor="resend-email">{ta("email")}</Label>
          <Input
            id="resend-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      )}
      <Button
        type="submit"
        variant="secondary"
        className="w-full"
        disabled={!email || cooldown > 0 || status === "sending"}
      >
        {cooldown > 0 ? t("resendIn", { seconds: cooldown }) : t("resend")}
      </Button>
      <p aria-live="polite" className="text-sm text-muted">
        {status === "sent" ? t("resent") : ""}
      </p>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
