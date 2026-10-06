"use client";

/**
 * OBS output (Phase 4.9): the overlay's Browser Source URL is OUTPUT, not configuration, so it
 * lives in its own block next to the preview. Copy (with ✓ feedback via CopyButton) and open in
 * a new tab. Rotating the URL and deleting the overlay sit in a separate, collapsed danger area.
 */
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { Button, buttonClass } from "@/components/ui/primitives";
import { deleteOverlayAction, rotateOverlayTokenAction } from "../../actions";

export function ObsOutput({
  overlayId,
  url,
  canvas,
  onMessage,
}: {
  overlayId: string;
  url: string;
  canvas: { width: number; height: number };
  onMessage: (message: { tone: "ok" | "error"; text: string }) => void;
}) {
  const t = useTranslations("Builder");
  const tc = useTranslations("Common");
  const tDash = useTranslations("Dashboard.overlays");
  const router = useRouter();
  const [confirm, setConfirm] = useState<"rotate" | "delete" | null>(null);
  const [pending, startTransition] = useTransition();

  const rotate = () =>
    startTransition(async () => {
      setConfirm(null);
      const res = await rotateOverlayTokenAction(overlayId);
      if (res.ok) {
        onMessage({ tone: "ok", text: t("rotatedMessage") });
        router.refresh();
      } else onMessage({ tone: "error", text: res.error });
    });

  const remove = () =>
    startTransition(async () => {
      const res = await deleteOverlayAction(overlayId);
      if (res.ok) router.push("/dashboard");
      else onMessage({ tone: "error", text: res.error });
    });

  return (
    <section
      aria-labelledby="obs-title"
      className="hud-panel space-y-3 p-4"
      data-testid="obs-output"
    >
      <h2 id="obs-title" className="hud-heading">
        {t("urlTitle")}
      </h2>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        aria-label={t("urlTitle")}
        className="h-9 w-full border border-line bg-surface-0 px-3 font-mono text-xs text-muted focus:border-cyan focus:text-text focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <CopyButton value={url} label={tDash("copyUrl")} size="sm" />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass("secondary", "sm")}
        >
          {t("openOverlay")}
        </a>
      </div>
      <p className="text-xs text-faint">
        {t("obsHint", { width: canvas.width, height: canvas.height })}
      </p>

      <details className="border-t border-line pt-3">
        <summary className="cursor-pointer text-xs text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-cyan">
          {t("dangerZone")}
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {confirm === "rotate" ? (
            <>
              <span className="text-xs text-warn">{t("regenerateWarn")}</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                {tc("cancel")}
              </Button>
              <Button size="sm" variant="danger" onClick={rotate} disabled={pending}>
                {t("generateNew")}
              </Button>
            </>
          ) : confirm === "delete" ? (
            <>
              <span className="text-xs text-warn">{t("deleteWarn")}</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                {tc("cancel")}
              </Button>
              <Button size="sm" variant="danger" onClick={remove} disabled={pending}>
                {t("deleteConfirm")}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setConfirm("rotate")}>
                {t("regenerate")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm("delete")}>
                {t("delete")}
              </Button>
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-faint">{t("urlNote")}</p>
      </details>
    </section>
  );
}
