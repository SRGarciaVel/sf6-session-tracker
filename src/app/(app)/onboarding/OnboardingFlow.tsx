"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button, ErrorText, Input, Label, cx } from "@/components/ui/primitives";
import { formatInteger } from "@/domain/format";
import { confirmPlayerAction, lookupPlayerAction, type PlayerPreview } from "./actions";

const STEPS = ["CFN User ID", "Verify", "Confirm", "Overlay"];

export function OnboardingFlow({ devHint }: { devHint: boolean }) {
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
        {STEPS.map((label, i) => (
          <li key={label} className="space-y-2">
            <div className={cx("h-1 rounded-full", i <= step ? "bg-accent" : "bg-line")} />
            <span
              className={cx(
                "text-[11px] font-semibold tracking-wider uppercase",
                i <= step ? "text-text" : "text-faint",
              )}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      <form onSubmit={lookup} className="space-y-3">
        <Label htmlFor="cfn">CFN User ID</Label>
        <div className="flex gap-2">
          <Input
            id="cfn"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 1234567890"
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
            {pending && !preview ? "Checking…" : "Find player"}
          </Button>
        </div>
        <p className="text-xs text-faint">
          Find it on Buckler&apos;s Boot Camp → your profile. It&apos;s the numeric User Code, not
          your fighter name.
          {devHint &&
            " (Mock mode: any 6–12 digit number works; IDs starting with 000 are “not found”.)"}
        </p>
      </form>

      <ErrorText>{error}</ErrorText>

      {preview && (
        <div className="animate-rise rounded-lg border border-accent/40 bg-accent/5 p-5">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-accent uppercase">
            Player found
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-display text-2xl font-bold">{preview.displayName}</p>
              <p className="text-sm text-muted">
                {preview.mainCharacter ?? "Unknown character"} · {preview.rank ?? "Unranked"}
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-3xl font-bold tabular">
                {formatInteger(
                  preview.ratingSystem === "mr" ? preview.masterRate : preview.leaguePoints,
                )}
              </p>
              <p className="text-xs font-semibold tracking-widest text-muted">
                {preview.ratingSystem === "mr" ? "MR" : "LP"}
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            size="lg"
            className="mt-5 w-full"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? "Setting up…" : "This is me — create my overlay"}
          </Button>
        </div>
      )}
    </div>
  );
}
