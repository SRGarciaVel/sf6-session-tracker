"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { LocalTime } from "@/components/ui/LocalTime";
import { Button, ErrorText, Input } from "@/components/ui/primitives";
import { redeemCreatorKeyAction } from "../actions";
import { ConsoleHeading } from "./OverlaysPanel";

/**
 * Plan status + Creator Key redemption. Display only: the server resolves the plan
 * (getPlanSummary) and performs the redeem; this component never decides access.
 */
export function CreatorBetaPanel({
  plan,
  activeUntil,
}: {
  plan: "free" | "creator_beta";
  activeUntil: string | null;
}) {
  const t = useTranslations("Dashboard.creatorBeta");
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const redeem = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await redeemCreatorKeyAction(key);
      if (res.ok) {
        setKey("");
        setSuccess(res.data.activeUntil);
        router.refresh();
      } else setError(res.error);
    });
  };

  return (
    <div className="px-5 py-4" id="creator-beta">
      <ConsoleHeading>{t("title")}</ConsoleHeading>
      <p className="mt-2 text-sm">
        <span className="hud-label mr-2">{t("planLabel")}</span>
        <span className="font-semibold" data-testid="plan-name">
          {{ free: t("free"), creator_beta: t("creatorBeta") }[plan]}
        </span>
        {/* Set by the server only for time-bound plans (grants). */}
        {activeUntil && (
          <span className="ml-2 text-xs text-muted">
            {t("activeUntil")} <LocalTime iso={activeUntil} format="date" />
          </span>
        )}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted">{t("intro")}</p>

      {success && (
        <p className="mt-3 text-sm font-semibold text-win" role="status">
          ✓ {t("success")} {t("activeUntil")} <LocalTime iso={success} format="date" />.
        </p>
      )}

      <form onSubmit={redeem} className="mt-3 flex flex-wrap gap-2">
        <label htmlFor="creator-key" className="sr-only">
          {t("keyLabel")}
        </label>
        <Input
          id="creator-key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="SST-XXXX-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={64}
          className="h-9 min-w-0 flex-1 font-mono text-sm tracking-wider"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending || key.trim() === ""}>
          {pending ? t("redeeming") : t("redeem")}
        </Button>
      </form>
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}
