"use client";

/**
 * Overlay builder (Phase 4.9, docs/overlay-builder.md): a focused visual editor.
 *
 *   header   name · save state (Saved / Unsaved / Saving / Failed) · Discard · Save
 *   left     tabs: Appearance · Content · Style · Creator  (one canonical config)
 *   right    sticky live preview (real renderer, EFFECTIVE config) + OBS output
 *   mobile   preview first, controls below, sticky save bar while there are changes
 *
 * State: ONE editable config (stored shape, including any Creator block the owner can't use
 * right now — saving sends it back untouched and the server keeps it). Dirty = canonical
 * comparison with the last saved snapshot. Preview-only state lives in PreviewPane.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { Button, Input, cx } from "@/components/ui/primitives";
import { getEffectiveOverlayConfig } from "@/domain/overlay/creator";
import { OVERLAY_PRESETS, type OverlayConfig } from "@/domain/overlay/config";
import { getOverlayMessages } from "@/i18n/overlay-messages";
import { saveOverlayAction } from "../../actions";
import { useLiveDashboard } from "../../_components/LiveDashboard";
import { EDITOR_TABS, isDirty, type EditorSnapshot, type EditorTab } from "./builder-state";
import { DEFAULT_CHARACTER_ROTATION } from "@/domain/overlay/rotation";
import { CreatorPanel } from "./CreatorPanel";
import { rotationViewSequence } from "./rotation-preview";
import { ObsOutput } from "./ObsOutput";
import { AppearancePanel, ContentPanel, StylePanel, type Update } from "./panels";
import { PreviewPane } from "./PreviewPane";
import type { PresetSummary } from "./PresetsSection";

/** Creator capabilities of the owner (booleans only; never the plan). */
export interface BuilderAccess {
  advancedCustomization: boolean;
  premiumThemes: boolean;
  creatorPresets: boolean;
  motionEffects: boolean;
  characterRotation: boolean;
}

type SaveState = "saved" | "unsaved" | "saving" | "failed";

const STATUS_CLASS: Record<SaveState, string> = {
  saved: "border-win/50 text-win",
  unsaved: "border-warn/60 text-warn",
  saving: "border-line-strong text-muted",
  failed: "border-loss/60 text-loss",
};

export function OverlayBuilder({
  overlayId,
  initialName,
  initialConfig,
  url,
  access,
  presets,
}: {
  overlayId: string;
  initialName: string;
  initialConfig: OverlayConfig;
  url: string;
  /** Owner entitlements, resolved on the server (display only: saving is enforced server-side). */
  access: BuilderAccess;
  presets: PresetSummary[];
}) {
  const router = useRouter();
  const t = useTranslations("Builder");
  const tc = useTranslations("Common");
  const { state } = useLiveDashboard();

  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState(initialConfig);
  const [saved, setSaved] = useState<EditorSnapshot>({ name: initialName, config: initialConfig });
  const [tab, setTab] = useState<EditorTab>("appearance");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [saving, startSave] = useTransition();

  const dirty = isDirty(saved, { name, config });
  const saveState: SaveState = saving
    ? "saving"
    : saveError
      ? "failed"
      : dirty
        ? "unsaved"
        : "saved";
  // Same rule as OBS: Creator values render only while the owner is entitled.
  const effectiveConfig = useMemo(
    () => getEffectiveOverlayConfig(config, { overlays: access }),
    [config, access],
  );
  const canvas = OVERLAY_PRESETS[effectiveConfig.preset];
  // Localized default title in the OVERLAY's language (what OBS shows when the title is empty).
  const overlayStrings = getOverlayMessages(config.locale).Overlay;
  const defaultTitle =
    typeof overlayStrings === "object" && typeof overlayStrings.session === "string"
      ? overlayStrings.session
      : "";

  const update: Update = useCallback((fn) => {
    setConfig((c) => fn(c));
    setSaveError(null);
    setNotice(null);
  }, []);

  // Browser-level guard (reload / close tab) only while there is something to lose.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () =>
    startSave(async () => {
      const snapshot = { name, config };
      // A network failure (offline, server restart) must not lose edits either.
      const res = await saveOverlayAction(overlayId, snapshot).catch(() => ({
        ok: false as const,
        error: t("saveNetworkError"),
      }));
      if (res.ok) {
        setSaved(snapshot);
        setSaveError(null);
        setNotice({ tone: "ok", text: t("savedMessage") });
      } else {
        // Local edits are kept: nothing is reset on failure.
        setSaveError(res.error);
      }
    });

  const discard = () => {
    setConfig(saved.config);
    setName(saved.name);
    setSaveError(null);
  };

  /* Tabs (WAI-ARIA tabs pattern: arrow keys move between tabs). */
  const tabRefs = useRef<Record<EditorTab, HTMLButtonElement | null>>({
    appearance: null,
    content: null,
    style: null,
    creator: null,
  });
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = EDITOR_TABS.indexOf(tab);
    const next =
      e.key === "ArrowRight"
        ? EDITOR_TABS[(i + 1) % EDITOR_TABS.length]
        : e.key === "ArrowLeft"
          ? EDITOR_TABS[(i - 1 + EDITOR_TABS.length) % EDITOR_TABS.length]
          : e.key === "Home"
            ? EDITOR_TABS[0]
            : e.key === "End"
              ? EDITOR_TABS[EDITOR_TABS.length - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const saveButton = (testId: string) => (
    <Button variant="primary" onClick={save} disabled={!dirty || saving} data-testid={testId}>
      {saving ? t("saving") : t("save")}
    </Button>
  );

  return (
    <div className="space-y-4 pb-20 lg:pb-0">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="z-20 -mx-4 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:sticky lg:top-[3.625rem]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link
              href="/dashboard"
              onClick={(e) => {
                if (!dirty) return;
                e.preventDefault();
                setLeaving(true);
              }}
              className="text-sm text-muted hover:text-text"
            >
              {tc("backToDashboard")}
            </Link>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="font-display text-xl font-bold sm:text-2xl">{t("title")}</h1>
              <Input
                value={name}
                maxLength={40}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaveError(null);
                }}
                aria-label={t("nameAria")}
                className="h-8 w-full max-w-64 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              role="status"
              aria-live="polite"
              data-testid="save-state"
              data-state={saveState}
              className={cx(
                "border px-2 py-1 font-display text-[0.7rem] font-semibold tracking-[0.12em] whitespace-nowrap uppercase",
                STATUS_CLASS[saveState],
              )}
            >
              {saveState === "saved" ? `✓ ${t("status.saved")}` : t(`status.${saveState}`)}
            </span>
            <Button variant="ghost" onClick={discard} disabled={!dirty || saving}>
              {t("discard")}
            </Button>
            <span className="hidden lg:inline-flex">{saveButton("save-button")}</span>
          </div>
        </div>
        {saveError && (
          <p role="alert" className="mt-2 text-sm text-loss">
            {t("saveFailed", { reason: saveError })}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className={cx("mt-2 text-sm", notice.tone === "ok" ? "text-win" : "text-loss")}
          >
            {notice.text}
          </p>
        )}
        {leaving && (
          <div
            role="alertdialog"
            aria-labelledby="leave-title"
            className="mt-2 flex flex-wrap items-center gap-2"
          >
            <span id="leave-title" className="text-sm text-warn">
              {t("leaveWarning")}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setLeaving(false)} autoFocus>
              {t("leaveStay")}
            </Button>
            <Button size="sm" variant="danger" onClick={() => router.push("/dashboard")}>
              {t("leaveDiscard")}
            </Button>
          </div>
        )}
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* ── Preview + OBS (first on mobile, sticky on desktop) ── */}
        <div
          className="min-w-0 space-y-4 lg:sticky lg:top-[9.5rem] lg:order-2"
          data-testid="preview-column"
        >
          <PreviewPane
            config={effectiveConfig}
            liveState={state.live}
            onCanvasChange={(preset) => update((c) => ({ ...c, preset }))}
            rotationAvailable={access.characterRotation}
          />
          <ObsOutput overlayId={overlayId} url={url} canvas={canvas} onMessage={setNotice} />
        </div>

        {/* ── Editor ───────────────────────────────────────────── */}
        <div className="hud-panel min-w-0 lg:order-1" data-testid="editor">
          <div
            role="tablist"
            aria-label={t("editorLabel")}
            className="flex border-b border-line-strong"
          >
            {EDITOR_TABS.map((id) => (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={onTabKey}
                className={cx(
                  "relative flex-1 px-2 py-3 font-display text-xs font-semibold tracking-[0.12em] uppercase transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan sm:text-sm",
                  "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:transition-transform",
                  tab === id
                    ? cx(
                        "text-text after:scale-x-100",
                        id === "creator" ? "after:bg-magenta" : "after:bg-cyan",
                      )
                    : "text-muted after:scale-x-0 hover:text-text",
                )}
              >
                {t(`tabs.${id}`)}
              </button>
            ))}
          </div>

          {EDITOR_TABS.map((id) => (
            <div
              key={id}
              role="tabpanel"
              id={`panel-${id}`}
              aria-labelledby={`tab-${id}`}
              hidden={tab !== id}
              className="px-4 py-5 sm:px-5"
            >
              {id === "appearance" && (
                <AppearancePanel
                  config={config}
                  update={update}
                  premiumThemes={access.premiumThemes}
                />
              )}
              {id === "content" && (
                <ContentPanel
                  config={config}
                  update={update}
                  characters={state.live.session.characters}
                  rotationActive={effectiveConfig.creator?.characterRotation?.enabled === true}
                  defaultTitle={defaultTitle}
                />
              )}
              {id === "style" && (
                <StylePanel
                  config={config}
                  update={update}
                  onOpenCreator={() => setTab("creator")}
                />
              )}
              {id === "creator" && (
                <CreatorPanel
                  config={config}
                  update={update}
                  advancedCustomization={access.advancedCustomization}
                  creatorPresets={access.creatorPresets}
                  motionEffects={access.motionEffects}
                  characterRotation={access.characterRotation}
                  rotationViews={rotationViewSequence(
                    state.live.session,
                    config.creator?.characterRotation ?? DEFAULT_CHARACTER_ROTATION,
                  )}
                  overlayId={overlayId}
                  presets={presets}
                  dirty={dirty}
                  onPresetApplied={(applied) => {
                    // Applying a preset saves it server-side: the result is the new stored state.
                    setConfig(applied);
                    setSaved((prev) => ({ name: prev.name, config: applied }));
                    setSaveError(null);
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Mobile save bar (only while there is something to save) ── */}
      {(dirty || saveState === "failed") && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-line-strong bg-bg/95 px-4 py-3 backdrop-blur-sm lg:hidden"
          data-testid="mobile-save-bar"
        >
          <span className="text-sm text-warn">{t(`status.${saveState}`)}</span>
          {saveButton("save-button-mobile")}
        </div>
      )}
    </div>
  );
}
