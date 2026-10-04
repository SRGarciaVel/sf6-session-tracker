"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, Dot, ErrorText } from "@/components/ui/primitives";
import { formatTimeAgo } from "@/domain/format";
import { createCompanionCodeAction, revokeCompanionDeviceAction } from "../actions";
import { ConsoleHeading } from "./OverlaysPanel";

export interface CompanionDeviceSummary {
  id: string;
  name: string;
  lastSeenAt: string | null;
}

/** Pair / revoke the SF6 Session Companion browser extension. */
export function CompanionPanel({
  devices,
  ingestEnabled,
}: {
  devices: CompanionDeviceSummary[];
  ingestEnabled: boolean;
}) {
  const t = useTranslations("Dashboard.companion");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const expired = code !== null && new Date(code.expiresAt).getTime() <= now;

  const generate = () =>
    startTransition(async () => {
      setError(null);
      const res = await createCompanionCodeAction();
      if (res.ok) setCode(res.data);
      else setError(res.error);
    });

  const revoke = (id: string) =>
    startTransition(async () => {
      setError(null);
      const res = await revokeCompanionDeviceAction(id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });

  return (
    <div className="px-5 py-4">
      <ConsoleHeading>{t("title")}</ConsoleHeading>
      <p className="mt-2 text-xs leading-relaxed text-muted">{t("intro")}</p>
      {!ingestEnabled && <p className="mt-2 text-xs text-warn">{t("ingestDisabled")}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={generate} disabled={pending}>
          {t("connect")}
        </Button>
        {code && !expired && (
          <span className="font-display text-xl font-bold tracking-[0.2em] text-cyan tabular">
            {code.code}
          </span>
        )}
      </div>
      {code && (
        <p className="mt-1 text-xs text-faint">{expired ? t("codeExpired") : t("codeHelp")}</p>
      )}

      <ul className="mt-3 text-sm">
        {devices.length === 0 && <li className="text-xs text-faint">{t("noDevices")}</li>}
        {devices.map((d) => (
          <li
            key={d.id}
            className="flex items-center gap-2 border-b border-line/70 py-1.5 last:border-b-0"
          >
            <Dot tone={d.lastSeenAt ? "win" : "neutral"} />
            <span className="flex-1 truncate">{d.name}</span>
            <span className="text-xs text-faint">
              {d.lastSeenAt ? formatTimeAgo(d.lastSeenAt, now, locale).text : t("neverSeen")}
            </span>
            <Button variant="ghost" size="sm" onClick={() => revoke(d.id)} disabled={pending}>
              {t("revoke")}
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-faint">{t("privacy")}</p>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
