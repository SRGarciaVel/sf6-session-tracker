"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";
import { Button, ErrorText, Input, Label, cx } from "@/components/ui/primitives";
import { formatInteger } from "@/domain/format";
import { confirmPlayerAction, lookupPlayerAction, type PlayerPreview } from "./actions";

const STEPS = ["stepCfnId", "stepVerify", "stepConfirm", "stepOverlay"] as const;

export function OnboardingFlow({ devHint }: { devHint: boolean }) {
  const t = useTranslations("Onboarding");
  const locale = useLocale();
  const [cfnId, setCfnId] = useState("");
  const [preview, setPreview] = useState<PlayerPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const step = preview ? 2 : pending ? 1 : 0;

  const lookup = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPreview(null);
    startTransition(async () => {
      const result = await lookupPlayerAction(cfnId);
      if (result.ok) setPreview(result.data);
      else setError(result.error);
    });
  };

  const confirm = () => {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const result = await confirmPlayerAction(preview.cfnUserId);
      // On success the action redirects to the dashboard.
      if (result && !result.ok) setError(result.error);
    });
  };

  return (
    <div className="space-y-8">
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((step_, i) => (
          <li key={step_} className="space-y-2">
            <div
              className={cx(
                "h-1.5 -skew-x-[20deg] transition-colors",
                i <= step ? "bg-cyan shadow-[0_0_8px_rgb(47_224_255/0.5)]" : "bg-line-strong",
              )}
            />
            <span
              className={cx(
                "font-display text-xs font-bold tracking-[0.08em] uppercase",
                i <= step ? "text-text" : "text-faint",
              )}
            >
              {t(step_)}
            </span>
          </li>
        ))}
      </ol>

      <form onSubmit={lookup} className="space-y-3">
        <Label htmlFor="cfn">{t("cfnLabel")}</Label>
        <div className="flex gap-2">
          <Input
            id="cfn"
            inputMode="numeric"
            autoComplete="off"
            placeholder={t("cfnPlaceholder")}
            value={cfnId}
            onChange={(e) => {
              setCfnId(e.target.value.replace(/\D/g, "").slice(0, 12));
              setPreview(null);
            }}
            className="font-mono text-base tracking-wider"
            required
          />
          <Button
            type="submit"
            variant={preview ? "secondary" : "primary"}
            disabled={pending || cfnId.length < 6}
            className="h-11"
          >
            {pending && !preview ? t("checking") : t("findPlayer")}
          </Button>
        </div>
        <p className="text-xs text-faint">
          {t("help")}
          {devHint && ` ${t("devHint")}`}
        </p>
      </form>

      <ErrorText>{error}</ErrorText>

      {preview && (
        <div className="animate-panel-in border-l-4 border-cyan bg-cyan/6 p-5">
          <p className="hud-label text-cyan">{t("playerFound")}</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-display text-3xl leading-none font-bold">{preview.displayName}</p>
              <p className="text-sm text-muted">
                {preview.character?.characterName ?? t("unknownCharacter")} ·{" "}
                {preview.character?.rank ?? t("unranked")}
              </p>
              <p className="text-xs text-faint">
                {t("charactersFound", { count: preview.characterCount })}
              </p>
            </div>
            {preview.character && (
              <div className="text-right">
                <p className="font-display text-3xl font-bold tabular">
                  {formatInteger(preview.character.value, locale)}
                </p>
                <p className="text-xs font-semibold tracking-widest text-muted">
                  {preview.character.ratingSystem === "mr" ? "MR" : "LP"}
                </p>
              </div>
            )}
          </div>
          <Button
            variant="primary"
            size="lg"
            className="mt-5 w-full"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? t("settingUp") : t("confirm")}
          </Button>
        </div>
      )}
    </div>
  );
}
