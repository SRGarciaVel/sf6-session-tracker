/**
 * Presentation projection (Phase 5.3A, docs/creator-overlays.md): the ONE place that turns the
 * view the rotation controller picked into what the themes render. Themes keep reading
 * `config.ratingCharacterKey` / `config.statsScope` / `config.title` through the shared helpers
 * (ratingParts, resolveOverlayStats), so no theme decides anything about views.
 *
 * The returned config is presentation only — never saved: the stored statsScope,
 * ratingCharacterKey and title are untouched.
 *
 *   session view    global statistics (statsScope "session", whatever is stored). SF6 has no
 *                   session-wide rating, so none is invented: the rating shown is the ACTIVE
 *                   character's (latest match), labelled with its name like every rating, or the
 *                   neutral placeholder when there is none.
 *   character view  that character's rating, rank and delta. Statistics: the stored statsScope
 *                   in "characters" mode (Phase 5.2 semantics); always the character's own in
 *                   the mixed modes.
 *
 * View identification (mixed modes only): the title slot carries the view label ("SESIÓN" /
 * "CHUN-LI"). A custom title is kept and the label appended ("RANKED · CHUN-LI"); with the title
 * hidden only the label shows. "characters" mode renders exactly as in Phase 5.2 (no label).
 */
import type { OverlayConfig } from "./config";
import type { PresentationMode, PresentationView } from "./rotation";
import type { LiveSessionState } from "./state";

export interface Presentation {
  /** Config the themes render with (presentation only). */
  config: OverlayConfig;
  /** View identifier shown to viewers (mixed modes), else null. */
  viewLabel: string | null;
}

export function resolvePresentation(
  config: OverlayConfig,
  session: Pick<LiveSessionState, "activeCharacterKey" | "characters">,
  view: PresentationView | null,
  mode: PresentationMode,
  labels: { session: string },
): Presentation {
  if (view === null) return { config, viewLabel: null };
  const mixed = mode !== "characters";
  if (view.kind === "character") {
    const projected: OverlayConfig = {
      ...config,
      ratingCharacterKey: view.characterKey,
      statsScope: mixed ? "character" : config.statsScope,
    };
    if (!mixed) return { config: projected, viewLabel: null };
    const name =
      session.characters.find((c) => c.characterKey === view.characterKey)?.characterName ??
      view.characterKey;
    return { config: withViewTitle(projected, config, name), viewLabel: name };
  }
  const projected: OverlayConfig = {
    ...config,
    ratingCharacterKey: session.activeCharacterKey,
    statsScope: "session",
  };
  return { config: withViewTitle(projected, config, labels.session), viewLabel: labels.session };
}

function withViewTitle(
  projected: OverlayConfig,
  stored: OverlayConfig,
  label: string,
): OverlayConfig {
  const custom = stored.showTitle ? stored.title.trim() : "";
  return { ...projected, showTitle: true, title: custom ? `${custom} · ${label}` : label };
}
