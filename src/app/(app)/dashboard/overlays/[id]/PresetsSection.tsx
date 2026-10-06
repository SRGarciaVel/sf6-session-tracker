"use client";

/**
 * Creator presets in the overlay builder (Phase 4.5, docs/creator-presets.md). Every action is a
 * server action that re-checks the session, ownership and `overlays.creatorPresets`; this UI is
 * only a convenience. Without the entitlement, saved presets stay listed (and deletable) with a
 * renewal note.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge, Button, Input, cx } from "@/components/ui/primitives";
import type { OverlayConfig, OverlayThemeId } from "@/domain/overlay/config";
import { PRESETS_PER_ACCOUNT_MAX, PRESET_NAME_MAX } from "@/domain/overlay/presets";
import {
  applyPresetAction,
  createPresetAction,
  deletePresetAction,
  duplicatePresetAction,
  renamePresetAction,
  updatePresetAction,
} from "../../actions";

/** What the page sends to the client: no stored config, only what the list shows. */
export interface PresetSummary {
  id: string;
  name: string;
  /** null = the stored preset is no longer valid (can only be deleted). */
  theme: OverlayThemeId | null;
}

type Pending = { kind: "apply" | "delete" | "rename"; id: string } | null;

export function PresetsSection({
  overlayId,
  presets,
  config,
  enabled,
  dirty,
  onApplied,
}: {
  overlayId: string;
  presets: PresetSummary[];
  /** Current editor config ("save current look" / "update from current"). */
  config: OverlayConfig;
  enabled: boolean;
  dirty: boolean;
  onApplied: (config: OverlayConfig) => void;
}) {
  const t = useTranslations("Builder.presetsCreator");
  const tb = useTranslations("Builder");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [name, setName] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [confirm, setConfirm] = useState<Pending>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, startTransition] = useTransition();
  const atLimit = presets.length >= PRESETS_PER_ACCOUNT_MAX;

  const run = (
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    okText: string,
  ) =>
    startTransition(async () => {
      const res = await action();
      setConfirm(null);
      if (res.ok) {
        setMessage({ tone: "ok", text: okText });
        router.refresh();
      } else setMessage({ tone: "error", text: res.error });
    });

  const apply = (id: string) =>
    startTransition(async () => {
      const res = await applyPresetAction({ presetId: id, overlayId });
      setConfirm(null);
      if (res.ok) {
        onApplied(res.data.config);
        setMessage({ tone: "ok", text: t("applied") });
      } else setMessage({ tone: "error", text: res.error });
    });

  return (
    <section
      className="space-y-3 border-b border-line px-5 py-4 last:border-b-0"
      aria-labelledby="creator-presets-title"
      data-testid="creator-presets"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="creator-presets-title" className="hud-heading">
          {t("title")}
        </h3>
        <Badge tone="accent">Creator Beta</Badge>
        <span className="ml-auto font-mono text-xs text-faint">
          {`${presets.length}/${PRESETS_PER_ACCOUNT_MAX}`}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted">{t("summary")}</p>

      {!enabled && (
        <div className="space-y-1 border-l-2 border-line-strong bg-surface-2/60 px-3 py-2 text-xs">
          {presets.length > 0 && <p className="font-semibold text-text">{t("savedButInactive")}</p>}
          <p className="text-muted">
            {tb("creator.inviteOnly")}{" "}
            <Link href="/dashboard#creator-beta" className="text-cyan underline underline-offset-4">
              {tb("creator.haveKey")}
            </Link>
          </p>
        </div>
      )}

      {enabled && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const res = await createPresetAction({ name, config });
              if (res.ok) setName("");
              return res;
            }, t("created"));
          }}
        >
          <Input
            value={name}
            maxLength={PRESET_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            aria-label={t("namePlaceholder")}
            disabled={atLimit || busy}
          />
          <Button type="submit" size="sm" disabled={atLimit || busy || name.trim() === ""}>
            {t("saveCurrent")}
          </Button>
        </form>
      )}

      {presets.length === 0 ? (
        enabled && <p className="text-xs text-faint">{t("empty")}</p>
      ) : (
        <ul className="-mx-5 divide-y divide-line border-y border-line" data-testid="preset-list">
          {presets.map((p) => {
            const pending = confirm?.id === p.id ? confirm.kind : null;
            return (
              <li key={p.id} className="space-y-2 px-5 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="min-w-0 font-semibold break-words">{p.name}</span>
                  <span className="text-xs text-muted">
                    {p.theme ? tb(`themes.${p.theme}.name`) : t("broken")}
                  </span>
                </div>
                {pending === "apply" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-warn">
                      {dirty ? t("applyConfirmDirty") : t("applyConfirm")}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      {tc("cancel")}
                    </Button>
                    <Button size="sm" onClick={() => apply(p.id)} disabled={busy}>
                      {t("apply")}
                    </Button>
                  </div>
                ) : pending === "delete" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-warn">{t("deleteConfirm")}</span>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      {tc("cancel")}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() =>
                        run(() => deletePresetAction({ presetId: p.id }), t("deleted"))
                      }
                    >
                      {t("delete")}
                    </Button>
                  </div>
                ) : pending === "rename" ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(
                        () => renamePresetAction({ presetId: p.id, name: renameTo }),
                        t("renamed"),
                      );
                    }}
                  >
                    <Input
                      value={renameTo}
                      maxLength={PRESET_NAME_MAX}
                      onChange={(e) => setRenameTo(e.target.value)}
                      aria-label={t("rename")}
                      autoFocus
                    />
                    <Button type="submit" size="sm" disabled={busy || renameTo.trim() === ""}>
                      {t("rename")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      {tc("cancel")}
                    </Button>
                  </form>
                ) : (
                  <div className={cx("flex flex-wrap gap-1.5", busy && "opacity-60")}>
                    {enabled && p.theme && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setConfirm({ kind: "apply", id: p.id })}
                        >
                          {t("apply")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(() => updatePresetAction({ presetId: p.id, config }), t("updated"))
                          }
                        >
                          {t("update")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRenameTo(p.name);
                            setConfirm({ kind: "rename", id: p.id });
                          }}
                        >
                          {t("rename")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || atLimit}
                          onClick={() =>
                            run(
                              () =>
                                duplicatePresetAction({
                                  presetId: p.id,
                                  name: t("copyName", { name: p.name }).slice(0, PRESET_NAME_MAX),
                                }),
                              t("duplicated"),
                            )
                          }
                        >
                          {t("duplicate")}
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirm({ kind: "delete", id: p.id })}
                    >
                      {t("delete")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {message && (
        <p
          role="status"
          className={cx("text-xs", message.tone === "ok" ? "text-win" : "text-loss")}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
