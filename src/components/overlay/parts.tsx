/**
 * Shared overlay render parts (used by the Free themes in OverlayView and the Creator themes in
 * creator-themes.tsx). Pure presentation: values arrive pre-computed from the server.
 */
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { OverlayConfig } from "@/domain/overlay/config";
import { pickRatingCharacter, type PlayerLiveState } from "@/domain/overlay/state";
import { deltaTone, formatDelta, formatInteger } from "@/domain/format";
import type { MatchResult } from "@/domain/sf6/types";

/**
 * Re-mounts its span when the value changes so the CSS tick animation runs; the very first
 * render is static (no animation on page load / OBS refresh). `flash` tints the glow.
 */
export function Animated({
  value,
  className,
  flash,
}: {
  value: string | number;
  className?: string;
  flash?: "win" | "loss";
}) {
  const [tracked, setTracked] = useState({ value, version: 0 });
  if (tracked.value !== value) setTracked({ value, version: tracked.version + 1 });
  const cls = [
    "ov-num",
    tracked.version > 0 ? "ov-changed" : "",
    tracked.version > 0 && flash ? `ov-flash-${flash}` : "",
    className ?? "",
  ]
    .join(" ")
    .trim();
  return (
    <span key={tracked.version} className={cls}>
      {value}
    </span>
  );
}

function toneClass(delta: number | null): string {
  const tone = deltaTone(delta);
  return tone === "positive" ? "ov-pos" : tone === "negative" ? "ov-neg" : "ov-neutral";
}

/** ▲ +24 / ▼ -18 — glyph + sign, so up/down never depends on color alone. */
export function Delta({
  delta,
  locale,
  className,
}: {
  delta: number | null;
  locale: string;
  className: string;
}) {
  const tone = deltaTone(delta);
  return (
    <span className={`${className} ${toneClass(delta)}`}>
      {tone !== "neutral" && (
        <span className="ov-arrow" aria-hidden>
          {tone === "positive" ? "▲" : "▼"}
        </span>
      )}
      <Animated
        value={formatDelta(delta, locale)}
        flash={tone === "positive" ? "win" : tone === "negative" ? "loss" : undefined}
      />
    </span>
  );
}

export function Ratio({ wins, losses }: { wins: number; losses: number }) {
  return (
    <span className="ov-ratio" aria-hidden>
      {wins + losses === 0 ? (
        <span className="ov-ratio-empty" />
      ) : (
        <>
          <span className="ov-ratio-w" style={{ flexGrow: wins }} />
          <span className="ov-ratio-l" style={{ flexGrow: losses }} />
        </>
      )}
    </span>
  );
}

const RESULT_KEY = { win: "resultWin", loss: "resultLoss", draw: "resultDraw" } as const;

export function RecentForm({ results, max = 8 }: { results: MatchResult[]; max?: number }) {
  const t = useTranslations("Overlay");
  if (results.length === 0) return null;
  return (
    <span className="ov-form">
      {results.slice(-max).map((r, i) => (
        <span key={`${i}-${r}`} className={`ov-form-chip ov-r-${r}`}>
          {t(RESULT_KEY[r])}
        </span>
      ))}
    </span>
  );
}

export interface ThemeProps {
  config: OverlayConfig;
  live: PlayerLiveState;
}

/**
 * Rating of ONE character: the overlay's pinned `ratingCharacterKey`, else the active character
 * (latest Ranked match). W/L stays global; this never mixes characters.
 */
export function ratingParts(live: PlayerLiveState, config: OverlayConfig) {
  const c = pickRatingCharacter(live.session, config.ratingCharacterKey);
  const system = c?.current?.system ?? c?.ratingSystem ?? null;
  return {
    // MR / LP are official game terms: not translated.
    label: system === "mr" ? "MR" : system === "lp" ? "LP" : "",
    character: c?.characterName ?? "—",
    value: formatInteger(c?.current?.value ?? null, config.locale),
    delta: c?.delta ?? null,
    rank: c?.current?.rank ?? c?.initial?.rank ?? "—",
    /** Raw rank label (null = unknown) and system, for rank-aware Creator themes. */
    rankLabel: c?.current?.rank ?? c?.initial?.rank ?? null,
    system,
  };
}

/** Joins nodes with a separator element (no per-stat boxes). */
export function joinWith(
  nodes: Array<{ key: string; node: ReactNode }>,
  sep: (key: string) => ReactNode,
) {
  return nodes.map((item, i) => (
    <span key={item.key} style={{ display: "contents" }}>
      {i > 0 && sep(item.key)}
      {item.node}
    </span>
  ));
}

export function Cell({
  label,
  children,
  className,
  labelClassName,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <div className={`ov-cell ${className ?? ""}`}>
      <span className={labelClassName ? `ov-label ${labelClassName}` : "ov-label"}>{label}</span>
      {children}
    </div>
  );
}
