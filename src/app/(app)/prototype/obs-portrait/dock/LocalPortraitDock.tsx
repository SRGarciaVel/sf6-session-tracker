"use client";

/**
 * PROTOTYPE — OBS Custom Browser Dock page (design/phase-m2/local-portrait-prototype.md): pick a
 * local image, validate it from its bytes, keep it in THIS browser's IndexedDB, preview, replace
 * or delete it. Nothing is uploaded: no request carries the image, no log or telemetry sees it.
 */
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { LocalTime } from "@/components/ui/LocalTime";
import { formatDecimal, formatInteger } from "@/domain/format";
import {
  LocalPortraitError,
  announceLocalPortraitChange,
  deleteLocalPortrait,
  loadLocalPortrait,
  saveLocalPortrait,
  type LocalPortraitErrorCode,
  type LocalPortraitRecord,
} from "@/lib/local-portrait/store";
import {
  LOCAL_PORTRAIT_MAX_BYTES,
  LOCAL_PORTRAIT_MAX_SIDE,
  validateLocalImage,
  type ImageDecoder,
  type ValidationError,
} from "@/lib/local-portrait/validate";

type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "deleted" }
  | { kind: "invalid"; error: ValidationError }
  | { kind: "storage"; code: LocalPortraitErrorCode };

const noSubscribe = () => () => {};

const codeOf = (error: unknown): LocalPortraitErrorCode =>
  error instanceof LocalPortraitError ? error.code : "failed";

export function LocalPortraitDock({
  sourcePath,
  factory,
  decode,
}: {
  sourcePath: string;
  /** Tests inject an IndexedDB implementation and a decoder; the page uses the browser's. */
  factory?: IDBFactory;
  decode?: ImageDecoder;
}) {
  const t = useTranslations("Prototype.localPortrait");
  const locale = useLocale();
  const [record, setRecord] = useState<LocalPortraitRecord | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const input = useRef<HTMLInputElement>(null);
  const busy = status.kind === "loading" || status.kind === "saving";

  // One object URL per shown record, revoked when it changes or the page goes away.
  const preview = useMemo(() => (record ? URL.createObjectURL(record.blob) : null), [record]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  // Absolute URL to paste in OBS: this page's own origin (null while server-rendering).
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => null,
  );
  const sourceUrl = origin ? new URL(sourcePath, origin).toString() : sourcePath;

  // Initial read of the saved image (ignored if the page is gone before it resolves).
  useEffect(() => {
    let alive = true;
    loadLocalPortrait({ factory }).then(
      (saved) => {
        if (!alive) return;
        setRecord(saved);
        setStatus({ kind: "ready" });
      },
      (error: unknown) => {
        if (alive) setStatus({ kind: "storage", code: codeOf(error) });
      },
    );
    return () => {
      alive = false;
    };
  }, [factory]);

  async function choose(file: File | undefined) {
    if (!file || busy) return;
    setStatus({ kind: "saving" });
    const result = await validateLocalImage(file, decode);
    if (input.current) input.current.value = "";
    if (!result.ok) return setStatus({ kind: "invalid", error: result.error });
    try {
      const saved = await saveLocalPortrait(result, { factory });
      setRecord(saved);
      setStatus({ kind: "saved" });
      announceLocalPortraitChange({ type: "saved", id: saved.id });
    } catch (error) {
      setStatus({ kind: "storage", code: codeOf(error) });
    }
  }

  async function remove() {
    if (busy) return;
    try {
      await deleteLocalPortrait({ factory });
      setRecord(null);
      setStatus({ kind: "deleted" });
      announceLocalPortraitChange({ type: "deleted", id: "test" });
    } catch (error) {
      setStatus({ kind: "storage", code: codeOf(error) });
    }
  }

  const kb = (bytes: number) => formatDecimal(bytes / 1024, locale, 1);
  const limits = {
    kb: formatInteger(LOCAL_PORTRAIT_MAX_BYTES / 1024, locale),
    px: LOCAL_PORTRAIT_MAX_SIDE,
  };
  const message =
    status.kind === "invalid"
      ? t(`invalid.${status.error}`, limits)
      : status.kind === "storage"
        ? t(`storage.${status.code}`)
        : status.kind === "loading"
          ? t("state.loading")
          : status.kind === "saving"
            ? t("state.saving")
            : status.kind === "saved"
              ? t("state.saved")
              : status.kind === "deleted"
                ? t("state.deleted")
                : record
                  ? ""
                  : t("state.empty");
  const isError = status.kind === "invalid" || status.kind === "storage";

  return (
    <main className="mx-auto grid max-w-xl gap-5 p-4 sm:p-6" data-testid="local-portrait-dock">
      <header className="grid gap-2">
        <span className="hud-tag self-start text-warn">{t("badge")}</span>
        <h1 className="hud-heading m-0 text-2xl">{t("title")}</h1>
        <p className="m-0 text-sm text-muted">{t("intro")}</p>
        <p className="m-0 border-l-4 border-warn bg-warn/8 px-3 py-2 text-sm" data-testid="rights">
          {t("rights")}
        </p>
      </header>

      <section className="hud-panel grid gap-4 p-4" aria-labelledby="lp-image">
        <h2 id="lp-image" className="hud-label m-0">
          {t("preview")}
        </h2>
        <div
          className="grid aspect-square w-40 place-items-center border border-line bg-bg/60"
          data-testid="preview"
          data-state={record ? "image" : "empty"}
        >
          {record && preview ? (
            <Image
              unoptimized
              src={preview}
              alt={t("preview")}
              width={record.width}
              height={record.height}
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        {record && (
          <p className="m-0 text-xs text-muted tabular" data-testid="meta">
            {t.rich("meta", {
              type: record.type.replace("image/", "").toUpperCase(),
              kb: kb(record.size),
              width: record.width,
              height: record.height,
              time: () => <LocalTime iso={record.savedAt} format="time" />,
            })}
          </p>
        )}
        <p
          role={isError ? "alert" : "status"}
          aria-live={isError ? undefined : "polite"}
          className={isError ? "m-0 text-sm text-loss" : "m-0 text-sm text-muted"}
          data-testid="status"
          data-state={status.kind}
        >
          {message}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`btn btn-primary btn-md ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            {record ? t("replace") : t("choose")}
            <input
              ref={input}
              type="file"
              // A hint for the picker only: the content is validated from its bytes.
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={busy}
              data-testid="file"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
          </label>
          {record && (
            <button
              type="button"
              className="btn btn-secondary btn-md"
              onClick={() => void remove()}
              disabled={busy}
              data-testid="delete"
            >
              {t("delete")}
            </button>
          )}
        </div>
        <p className="m-0 text-xs text-faint">{t("limits", limits)}</p>
      </section>

      <section className="hud-panel grid gap-2 p-4" aria-labelledby="lp-obs">
        <h2 id="lp-obs" className="hud-label m-0">
          {t("obsTitle")}
        </h2>
        <p className="m-0 text-sm text-muted">{t("obsHint")}</p>
        <code className="block overflow-x-auto bg-bg/60 p-2 text-xs" data-testid="source-url">
          {sourceUrl}
        </code>
        <CopyButton value={sourceUrl} label={t("copy")} />
      </section>
    </main>
  );
}
