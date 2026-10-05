import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/primitives";

/**
 * Step 1 of the install guide: the stable download link (COMPANION_DOWNLOAD_URL) with the
 * available version and the checksum, or the "ask the organizer" fallback when unset.
 */
export function CompanionDownload({
  downloadUrl,
  checksumUrl,
  latestVersion,
}: {
  downloadUrl: string | null;
  checksumUrl: string | null;
  latestVersion: string | null;
}) {
  const t = useTranslations("Help");
  if (!downloadUrl) return <p className="text-sm text-warn">{t("downloadMissing")}</p>;
  return (
    <div className="space-y-1.5">
      <a href={downloadUrl} className={buttonClass("primary", "md")} data-testid="download">
        {t("download")}
      </a>
      <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
        {latestVersion && <span>{t("availableVersion", { version: latestVersion })}</span>}
        {checksumUrl && (
          <a
            href={checksumUrl}
            className="underline underline-offset-4 hover:text-text"
            aria-label={t("checksumAria")}
          >
            {t("checksum")}
          </a>
        )}
      </p>
    </div>
  );
}
