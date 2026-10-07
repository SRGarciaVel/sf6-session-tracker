/**
 * Creator themes (Phase 4.5, docs/creator-overlays.md; Creator-module candidate). Rendered only
 * from an entitled owner's EFFECTIVE config: without `overlays.premiumThemes` the theme is
 * replaced by its registered Free fallback before reaching the renderer (domain/overlay/creator.ts).
 *
 * Rank-aware themes read a generic prestige `{ level, color, division }` (domain/sf6/rank-prestige.ts)
 * from fixed tables; nothing user- or Capcom-provided becomes CSS. The emblem is SST-native CSS
 * (no official artwork). OBS/CEF-safe: classes + custom properties only (see overlay.css).
 */
import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { formatWinRate } from "@/domain/format";
import { DEFAULT_THEME_VARIANTS, type ThemeVariants } from "@/domain/overlay/variants";
import { rankPrestige, type RankPrestige } from "@/domain/sf6/rank-prestige";
import { Animated, Delta, Ratio, RecentForm, ratingParts, type ThemeProps } from "./parts";

type CssVars = CSSProperties & Record<`--${string}`, string>;

function variantsFor<K extends keyof ThemeVariants>(config: ThemeProps["config"], key: K) {
  return config.variants?.[key] ?? DEFAULT_THEME_VARIANTS[key];
}

/**
 * Prestige to render. The rank is only revealed (color, division, tier) when the streamer shows
 * the rank field; otherwise the emblem is a neutral accent gem.
 */
function prestigeFor(config: ThemeProps["config"], r: ReturnType<typeof ratingParts>) {
  return config.fields.rank ? rankPrestige(r.rankLabel, r.system) : rankPrestige(null, null);
}

function tierVars(p: RankPrestige, revealed: boolean): CssVars {
  // Fixed palette value from rank-prestige.ts; the neutral gem uses the streamer's accent.
  return { "--ov-tier": revealed && p.level > 0 ? p.color : "var(--ov-accent)" };
}

/** SST-native rank emblem: faceted gem + tier ornaments (wings ≥ Master extensions). */
export function RankEmblem({
  prestige,
  className,
}: {
  prestige: RankPrestige;
  className?: string;
}) {
  return (
    <span
      className={`ov-emb ov-tier-${prestige.level} ${className ?? ""}`}
      data-rank-family={prestige.family}
      aria-hidden
    >
      {prestige.level >= 6 && <span className="ov-emb-wings ov-deco" />}
      {prestige.level >= 5 && <span className="ov-emb-ring ov-deco" />}
      <span className="ov-emb-gem">
        <span className="ov-emb-facet" />
        {prestige.division && <span className="ov-emb-div">{prestige.division}</span>}
      </span>
      {prestige.level >= 1 && prestige.level <= 4 && (
        <span className="ov-emb-pips ov-deco">
          {Array.from({ length: prestige.level }, (_, i) => (
            <span key={i} className="ov-emb-pip" />
          ))}
        </span>
      )}
    </span>
  );
}

/* ─────────────── Rank Card — rank + rating led card ─────────────── */

export function RankCardTheme({ config, live }: ThemeProps) {
  const t = useTranslations("Overlay");
  const v = variantsFor(config, "rank-card");
  const s = live.session;
  const f = config.fields;
  const r = ratingParts(live, config);
  const p = prestigeFor(config, r);

  const stats: Array<{ key: string; label: string; node: ReactNode }> = [];
  if (f.wins || f.losses)
    stats.push({
      key: "rec",
      label: t("record"),
      node: (
        <>
          {f.wins && <Animated value={s.wins} className="ov-win" flash="win" />}
          {f.wins && f.losses && <span className="ov-rc-dash">-</span>}
          {f.losses && <Animated value={s.losses} className="ov-loss" flash="loss" />}
        </>
      ),
    });
  if (f.winRate)
    stats.push({
      key: "wr",
      label: t("winRate"),
      node: <Animated value={formatWinRate(s.winRate, config.locale)} />,
    });
  if (f.totalGames)
    stats.push({ key: "tg", label: t("games"), node: <Animated value={s.totalGames} /> });
  if (f.winStreak)
    stats.push({ key: "ws", label: t("streak"), node: <Animated value={s.currentWinStreak} /> });
  if (f.bestStreak)
    stats.push({ key: "bs", label: t("best"), node: <Animated value={s.bestWinStreak} /> });

  return (
    <div
      className={[
        "ov-panel ov-rc ov-shadow",
        `ov-rc-${v.density}`,
        `ov-rc-badge-${v.badge}`,
        `ov-rc-glow-${v.glow}`,
        `ov-rc-bg-${v.background}`,
      ].join(" ")}
      style={{ ...tierVars(p, f.rank), "--ov-bg-solid": config.backgroundColor } as CssVars}
    >
      <span className="ov-rc-band ov-deco" aria-hidden />
      <div className="ov-rc-badge">
        <RankEmblem prestige={p} />
        {f.rank && <span className="ov-rc-rank">{r.rank}</span>}
      </div>
      <div className="ov-rc-body">
        <div className="ov-rc-head">
          <span className="ov-rc-char ov-char">{r.character}</span>
          {config.showTitle && <span className="ov-rc-title">{config.title || t("session")}</span>}
        </div>
        {(f.rating || f.ratingDelta) && (
          <div className="ov-rc-rating">
            {f.rating && (
              <>
                <Animated value={r.value} />
                <span className="ov-unit">{r.label}</span>
              </>
            )}
            {f.ratingDelta && (
              <Delta delta={r.delta} locale={config.locale} className="ov-rc-delta" />
            )}
          </div>
        )}
        {stats.length > 0 && (
          <div className="ov-rc-stats">
            {stats.map((st) => (
              <span key={st.key} className="ov-rc-stat">
                <span className="ov-label">{st.label}</span>
                <span className="ov-rc-val">{st.node}</span>
              </span>
            ))}
          </div>
        )}
        {f.recentForm && <RecentForm results={s.recentResults} max={10} />}
      </div>
    </div>
  );
}

/* ─────────────── Broadcast — flat sports-TV lower third ─────────────── */

export function BroadcastTheme({ config, live }: ThemeProps) {
  const t = useTranslations("Overlay");
  const v = variantsFor(config, "broadcast");
  const s = live.session;
  const f = config.fields;
  const r = ratingParts(live, config);

  const segs: Array<{ key: string; label: ReactNode; node: ReactNode; className?: string }> = [];
  if (f.wins)
    segs.push({
      key: "w",
      label: t("wins"),
      node: <Animated value={s.wins} className="ov-win" flash="win" />,
    });
  if (f.losses)
    segs.push({
      key: "l",
      label: t("losses"),
      node: <Animated value={s.losses} className="ov-loss" flash="loss" />,
    });
  if (f.winRate)
    segs.push({
      key: "wr",
      label: t("winRate"),
      node: <Animated value={formatWinRate(s.winRate, config.locale)} />,
    });
  if (f.totalGames)
    segs.push({ key: "tg", label: t("games"), node: <Animated value={s.totalGames} /> });
  if (f.rank) segs.push({ key: "rk", label: t("rank"), node: r.rank, className: "ov-bc-rank" });
  if (f.rating || f.ratingDelta)
    segs.push({
      key: "rt",
      label: <span className="ov-char">{r.character}</span>,
      node: (
        <>
          {f.rating && (
            <>
              <Animated value={r.value} />
              <span className="ov-unit">{r.label}</span>
            </>
          )}
          {f.ratingDelta && <Delta delta={r.delta} locale={config.locale} className="ov-delta" />}
        </>
      ),
    });
  if (f.winStreak)
    segs.push({ key: "ws", label: t("streak"), node: <Animated value={s.currentWinStreak} /> });
  if (f.bestStreak)
    segs.push({ key: "bs", label: t("best"), node: <Animated value={s.bestWinStreak} /> });

  return (
    <div
      className={[
        "ov-bc",
        `ov-bc-sep-${v.separators}`,
        `ov-bc-accent-${v.accent}`,
        `ov-bc-${v.density}`,
      ].join(" ")}
    >
      {config.showTitle && (
        <div className="ov-bc-tab">
          <span>{config.title || t("session")}</span>
        </div>
      )}
      <div className="ov-bc-bar">
        {segs.map((seg) => (
          <div key={seg.key} className={`ov-bc-seg ${seg.className ?? ""}`}>
            <span className="ov-label">{seg.label}</span>
            <span className="ov-bc-val">{seg.node}</span>
          </div>
        ))}
        {f.recentForm && s.recentResults.length > 0 && (
          <div className="ov-bc-seg ov-bc-form">
            <RecentForm results={s.recentResults} max={5} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Prestige — ornamental, high-tier ─────────────── */

export function PrestigeTheme({ config, live }: ThemeProps) {
  const t = useTranslations("Overlay");
  const v = variantsFor(config, "prestige");
  const s = live.session;
  const f = config.fields;
  const r = ratingParts(live, config);
  const p = prestigeFor(config, r);

  return (
    <div
      className={[
        "ov-panel ov-pr ov-shadow",
        `ov-pr-glow-${v.glow}`,
        `ov-pr-frame-${v.frame}`,
        v.animatedAccent ? "ov-pr-sheen" : "",
        `ov-pr-level-${p.level}`,
      ].join(" ")}
      style={tierVars(p, f.rank)}
    >
      <span className="ov-pr-corner ov-pr-tl ov-deco" aria-hidden />
      <span className="ov-pr-corner ov-pr-tr ov-deco" aria-hidden />
      <span className="ov-pr-corner ov-pr-bl ov-deco" aria-hidden />
      <span className="ov-pr-corner ov-pr-br ov-deco" aria-hidden />
      <span className="ov-pr-rule ov-deco" aria-hidden />

      <div className="ov-pr-side">
        {(f.wins || f.losses) && (
          <>
            <span className="ov-label">{t("record")}</span>
            <span className="ov-pr-val">
              {f.wins && <Animated value={s.wins} className="ov-win" flash="win" />}
              {f.wins && f.losses && <span className="ov-pr-dash">-</span>}
              {f.losses && <Animated value={s.losses} className="ov-loss" flash="loss" />}
            </span>
          </>
        )}
        {f.totalGames && (
          <span className="ov-pr-sub">
            <Animated value={s.totalGames} /> <span className="ov-unit">{t("unitGames")}</span>
          </span>
        )}
      </div>

      <div className="ov-pr-center">
        {config.showTitle && <span className="ov-pr-title">{config.title || t("session")}</span>}
        <RankEmblem prestige={p} className="ov-pr-emb" />
        {f.rank && <span className="ov-pr-rank">{r.rank}</span>}
        {(f.rating || f.ratingDelta) && (
          <span className="ov-pr-rating">
            <span className="ov-char ov-pr-char">{r.character}</span>
            {f.rating && (
              <>
                <Animated value={r.value} />
                <span className="ov-unit">{r.label}</span>
              </>
            )}
            {f.ratingDelta && <Delta delta={r.delta} locale={config.locale} className="ov-delta" />}
          </span>
        )}
      </div>

      <div className="ov-pr-side ov-pr-right">
        {f.winRate && (
          <>
            <span className="ov-label">{t("winRate")}</span>
            <span className="ov-pr-val">
              <Animated value={formatWinRate(s.winRate, config.locale)} />
            </span>
            <Ratio wins={s.wins} losses={s.losses} />
          </>
        )}
        {(f.winStreak || f.bestStreak) && (
          <span className="ov-pr-sub">
            {f.winStreak && (
              <>
                <span className="ov-unit">{t("streak")}</span>{" "}
                <Animated value={s.currentWinStreak} />
              </>
            )}
            {f.winStreak && f.bestStreak && " · "}
            {f.bestStreak && (
              <>
                <span className="ov-unit">{t("best")}</span> <Animated value={s.bestWinStreak} />
              </>
            )}
          </span>
        )}
        {f.recentForm && <RecentForm results={s.recentResults} max={6} />}
      </div>
    </div>
  );
}
