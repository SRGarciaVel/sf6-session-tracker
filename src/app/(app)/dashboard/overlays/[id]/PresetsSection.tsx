"use client";

/**
 * Creator presets in the overlay builder (Phase 4.5; compact selector in 4.9,
 * docs/creator-presets.md). Every action is a server action that re-checks the session,
 * ownership and `overlays.creatorPresets`; this UI is only a convenience.
 *
 * Flow: pick a preset → Apply (saves it to this overlay) → edit → "Update from current" or
 * "Save current look" as a new one. Rename / Duplicate / Delete sit in a "More" menu.
 * Without the entitlement, saved presets stay listed and deletable (no data loss); the renewal
 * message is shown once by CreatorPanel.
 */
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button, Input, cx } from "@/components/ui/primitives";
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
import { selectClass } from "./controls";

/** What the page sends to the client: no stored config, only what the list shows. */
export interface PresetSummary {
  id: string;
  name: string;
  /** null = the stored preset is no longer valid (can only be deleted). */
  theme: OverlayThemeId | null;
}

type Pending = "apply" | "delete" | "rename" | null;

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
  const [selectedId, setSelectedId] = useState<string>(presets[0]?.id ?? "");
  const [name, setName] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, startTransition] = useTransition();
  const atLimit = presets.length >= PRESETS_PER_ACCOUNT_MAX;
  const selected = presets.find((p) => p.id === selectedId) ?? presets[0] ?? null;

  const run = (
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    okText: string,
  ) =>
    startTransition(async () => {
      const res = await action();
      setPending(null);
      if (res.ok) {
        setMessage({ tone: "ok", text: okText });
        router.refresh();
      } else setMessage({ tone: "error", text: res.error });
    });

  const apply = (id: string) =>
    startTransition(async () => {
      const res = await applyPresetAction({ presetId: id, overlayId });
      setPending(null);
      if (res.ok) {
        onApplied(res.data.config);
        setMessage({ tone: "ok", text: t("applied") });
      } else setMessage({ tone: "error", text: res.error });
    });

  const label = (p: PresetSummary) =>
    `${p.name} · ${p.theme ? tb(`themes.${p.theme}.name`) : t("broken")}`;

  return (
    <div className="space-y-3" data-testid="creator-presets">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          {t("title")}
        </p>
        <span className="font-mono text-xs text-faint">
          {`${presets.length}/${PRESETS_PER_ACCOUNT_MAX}`}
        </span>
      </div>

      {presets.length === 0 ? (
        enabled && <p className="text-xs text-faint">{t("empty")}</p>
      ) : (
        <div className="space-y-2" data-testid="preset-list">
          <label className="block text-sm">
            <span className="sr-only">{t("selectLabel")}</span>
            <select
              className={selectClass}
              value={selected?.id ?? ""}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setPending(null);
              }}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
            </select>
          </label>

          {selected && pending === "apply" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-warn">
                {dirty ? t("applyConfirmDirty") : t("applyConfirm")}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                {tc("cancel")}
              </Button>
              <Button size="sm" onClick={() => apply(selected.id)} disabled={busy}>
                {t("apply")}
              </Button>
            </div>
          )}
          {selected && pending === "delete" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-warn">{t("deleteConfirm")}</span>
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                {tc("cancel")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  run(() => deletePresetAction({ presetId: selected.id }), t("deleted"))
                }
              >
                {t("delete")}
              </Button>
            </div>
          )}
          {selected && pending === "rename" && (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => renamePresetAction({ presetId: selected.id, name: renameTo }),
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
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                {tc("cancel")}
              </Button>
            </form>
          )}

          {selected && pending === null && (
            <div className={cx("flex flex-wrap items-center gap-1.5", busy && "opacity-60")}>
              {enabled && selected.theme && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setPending("apply")}>
                    {t("apply")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run(() => updatePresetAction({ presetId: selected.id, config }), t("updated"))
                    }
                  >
                    {t("update")}
                  </Button>
                </>
              )}
              {enabled ? (
                <details className="relative">
                  <summary className="flex h-8 cursor-pointer list-none items-center px-3 font-display text-xs font-semibold tracking-wider text-muted uppercase hover:text-text focus-visible:outline-2 focus-visible:outline-cyan [&::-webkit-details-marker]:hidden">
                    {t("more")}
                  </summary>
                  <div className="absolute right-0 z-20 mt-1 flex min-w-40 flex-col border border-line-strong bg-surface-2 py-1">
                    {selected.theme && (
                      <button
                        type="button"
                        className="px-3 py-2 text-left text-sm hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
                        onClick={() => {
                          setRenameTo(selected.name);
                          setPending("rename");
                        }}
                      >
                        {t("rename")}
                      </button>
                    )}
                    {selected.theme && (
                      <button
                        type="button"
                        disabled={busy || atLimit}
                        className="px-3 py-2 text-left text-sm hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none disabled:opacity-50"
                        onClick={() =>
                          run(
                            () =>
                              duplicatePresetAction({
                                presetId: selected.id,
                                name: t("copyName", { name: selected.name }).slice(
                                  0,
                                  PRESET_NAME_MAX,
                                ),
                              }),
                            t("duplicated"),
                          )
                        }
                      >
                        {t("duplicate")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="px-3 py-2 text-left text-sm text-loss hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
                      onClick={() => setPending("delete")}
                    >
                      {t("delete")}
                    </button>
                  </div>
                </details>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setPending("delete")}>
                  {t("delete")}
                </Button>
              )}
            </div>
          )}
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
            className="h-9"
          />
          <Button
            type="submit"
            size="sm"
            className="shrink-0"
            disabled={atLimit || busy || name.trim() === ""}
          >
            {t("saveCurrent")}
          </Button>
        </form>
      )}

      <p
        role="status"
        className={cx("min-h-4 text-xs", message?.tone === "error" ? "text-loss" : "text-win")}
      >
        {message?.text ?? ""}
      </p>
    </div>
  );
}
