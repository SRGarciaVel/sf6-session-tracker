"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { Button, Dot, ErrorText, buttonClass } from "@/components/ui/primitives";
import { pairingCodeStatus } from "@/domain/companion/pairing";
import { companionUpdateStatus } from "@/domain/companion/update";
import { useSlowFlag } from "@/lib/use-slow-flag";
import { timeAgo, useNow, useOptionalLiveDashboard } from "./LiveDashboard";
import { createCompanionCodeAction, revokeCompanionDeviceAction } from "../actions";
import { ConsoleHeading } from "./OverlaysPanel";
import { CompanionStatusRows, useCompanionReadiness } from "./Readiness";

export interface CompanionDeviceSummary {
  id: string;
  name: string;
  lastSeenAt: string | null;
  clientVersion: string | null;
}

export interface PairingCode {
  code: string;
  expiresAt: string;
}

/** Published release info (server config), see server/companion/release.ts. */
export interface CompanionReleaseInfo {
  latestVersion: string | null;
  downloadUrl: string | null;
}

/** Installed version + "up to date" / "new version available" (never alarming when unknown). */
export function CompanionVersionStatus({
  installed,
  release,
}: {
  installed: string | null;
  release: CompanionReleaseInfo | null;
}) {
  const t = useTranslations("Dashboard.companion.version");
  const status = companionUpdateStatus(installed, release?.latestVersion ?? null);
  if (status.state === "unknown") {
    return <p className="text-xs text-muted">{t("unknown")}</p>;
  }
  return (
    <div className="space-y-1.5 text-sm" data-update-state={status.state}>
      <p className="text-muted">{t("installed", { version: status.installed })}</p>
      {status.state === "upToDate" && <p className="font-semibold text-win">{t("upToDate")}</p>}
      {status.state === "updateAvailable" && (
        <div
          role="status"
          className="space-y-2 border-l-2 border-warn bg-warn/8 px-3 py-2"
          data-testid="companion-update"
        >
          <p className="font-semibold text-warn">{t("available", { version: status.latest })}</p>
          <div className="flex flex-wrap gap-2">
            {release?.downloadUrl && (
              <a href={release.downloadUrl} className={buttonClass("primary", "sm")}>
                {t("download")}
              </a>
            )}
            <Link href="/help/companion#actualizar" className={buttonClass("secondary", "sm")}>
              {t("howTo")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** The one-time code: big, copyable, with its real remaining time (or an expired state). */
export function PairingCodeBox({
  code,
  now,
  onRegenerate,
  pending,
}: {
  code: PairingCode;
  now: number | null;
  onRegenerate: () => void;
  pending: boolean;
}) {
  const t = useTranslations("Dashboard.companion");
  const status = now === null ? null : pairingCodeStatus(code.expiresAt, now);

  if (status?.state === "expired") {
    return (
      <div className="mt-3 border-l-2 border-warn bg-surface-2/60 px-3 py-2" role="status">
        <p className="text-sm font-semibold text-warn">⚠ {t("codeExpired")}</p>
        <Button
          className="mt-2"
          variant="primary"
          size="sm"
          onClick={onRegenerate}
          disabled={pending}
        >
          {pending ? t("generating") : t("newCode")}
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-3 border-l-2 border-cyan bg-cyan/6 px-3 py-3" data-testid="pairing-code">
      <p className="hud-label text-cyan">{t("codeLabel")}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <output className="font-display text-3xl font-bold tracking-[0.2em] text-text tabular select-all">
          {code.code}
        </output>
        <CopyButton
          value={code.code}
          label={t("copyCode")}
          ariaLabel={t("copyCodeAria")}
          size="sm"
        />
      </div>
      <p className="mt-2 text-xs text-muted">{t("codeHelp")}</p>
      <p className="mt-1 text-xs font-semibold text-faint" aria-live="polite">
        {status === null
          ? t("expiresIn", { minutes: 10 })
          : status.state === "expiring"
            ? t("expiresSoon")
            : t("expiresIn", { minutes: status.minutesLeft })}
      </p>
    </div>
  );
}

/** Pair / revoke the SF6 Session Companion browser extension, with its live status. */
export function CompanionPanel({
  devices,
  ingestEnabled,
  release = null,
}: {
  devices: CompanionDeviceSummary[];
  ingestEnabled: boolean;
  release?: CompanionReleaseInfo | null;
}) {
  const t = useTranslations("Dashboard.companion");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const readiness = useCompanionReadiness();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<PairingCode | null>(null);
  const [justPaired, setJustPaired] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slow = useSlowFlag(pending);
  // null during SSR and the first client render (deterministic markup → no hydration
  // mismatch); the real clock starts after mount and ticks every 15 s.
  const now = useNow(15_000);

  // The live state (SSE) counts paired devices: a new one means the code was just used.
  // Refresh the server-rendered device list and swap the code for a confirmation.
  const live = useOptionalLiveDashboard();
  const liveDeviceCount = live ? live.state.companion.deviceCount : null;
  const [seenCount, setSeenCount] = useState(liveDeviceCount);
  if (liveDeviceCount !== seenCount) {
    setSeenCount(liveDeviceCount);
    if (liveDeviceCount !== null && seenCount !== null && liveDeviceCount > seenCount && code) {
      setCode(null);
      setJustPaired(true);
    }
  }
  useEffect(() => {
    if (liveDeviceCount !== null && liveDeviceCount !== devices.length) router.refresh();
  }, [liveDeviceCount, devices.length, router]);

  const generate = () =>
    startTransition(async () => {
      setError(null);
      setJustPaired(false);
      const res = await createCompanionCodeAction();
      if (res.ok) setCode(res.data);
      else setError(res.error);
    });

  const revoke = (id: string) =>
    startTransition(async () => {
      setError(null);
      setConfirmRevoke(null);
      const res = await revokeCompanionDeviceAction(id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });

  const hasDevices = devices.length > 0;

  return (
    <div className="px-5 py-4" id="companion">
      <ConsoleHeading>{t("title")}</ConsoleHeading>
      <p className="mt-2 text-xs leading-relaxed text-muted">{t("intro")}</p>
      {!ingestEnabled && <p className="mt-2 text-xs text-warn">{t("ingestDisabled")}</p>}

      {readiness?.required && (
        <div className="mt-3 space-y-2">
          <CompanionStatusRows readiness={readiness} />
          {readiness.companion !== "notPaired" && live && (
            <CompanionVersionStatus
              installed={live.state.companion.installedVersion}
              release={release}
            />
          )}
        </div>
      )}

      {justPaired && (
        <p className="mt-3 text-sm font-semibold text-win" role="status">
          {t("paired")}
        </p>
      )}

      {!code && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            variant={hasDevices ? "ghost" : "primary"}
            size="sm"
            onClick={generate}
            disabled={pending}
          >
            {pending ? t("generating") : hasDevices ? t("connectAnother") : t("connect")}
          </Button>
        </div>
      )}
      {code && (
        <>
          <PairingCodeBox code={code} now={now} onRegenerate={generate} pending={pending} />
          {/* Outside the dashboard there is no live state: let the user check manually. */}
          {liveDeviceCount === null && (
            <Button className="mt-2" variant="ghost" size="sm" onClick={() => router.refresh()}>
              {t("checkPairing")}
            </Button>
          )}
        </>
      )}
      {slow && <p className="mt-2 text-xs text-muted">{tc("slowServer")}</p>}

      <div className="mt-4">
        {hasDevices && <p className="hud-label text-xs">{t("devicesTitle")}</p>}
        <ul className="mt-1 text-sm">
          {!hasDevices && <li className="text-sm text-muted">{t("noDevices")}</li>}
          {devices.map((d) => (
            <li key={d.id} className="border-b border-line/70 py-1.5 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <Dot tone={d.lastSeenAt ? "win" : "neutral"} />
                <span className="min-w-0 flex-1 truncate">
                  {d.name}
                  {d.clientVersion && (
                    <span className="ml-2 text-xs text-faint tabular">v{d.clientVersion}</span>
                  )}
                </span>
                <span className="text-xs text-faint">
                  {timeAgo(d.lastSeenAt, now, locale, {
                    never: t("neverSeen"),
                    justNow: t("justNow"),
                  })}
                </span>
                {confirmRevoke !== d.id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmRevoke(d.id)}
                    disabled={pending}
                  >
                    {t("revoke")}
                  </Button>
                )}
              </div>
              {confirmRevoke === d.id && (
                <div className="mt-1 flex flex-wrap items-center gap-2" role="group">
                  <span className="flex-1 text-xs text-warn">
                    {t("revokeAsk", { name: d.name })}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(null)}>
                    {tc("cancel")}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => revoke(d.id)}
                    disabled={pending}
                  >
                    {t("revokeConfirm")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Link
        href="/help/companion"
        className="mt-3 inline-block text-sm font-semibold text-cyan underline-offset-4 hover:underline"
      >
        {t("installLink")} →
      </Link>
      <p className="mt-3 text-xs text-faint">{t("privacy")}</p>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
