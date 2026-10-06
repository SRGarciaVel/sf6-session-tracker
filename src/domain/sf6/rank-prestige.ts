/**
 * Street Fighter 6 rank → generic "prestige" for rank-aware overlay themes (Phase 4.5).
 *
 * Input is ONLY what SST already stores: Capcom's own rank label (e.g. "Diamond 1", "Master";
 * extensions only if Capcom's payload labels them) and the rating system ("mr" = Master tier).
 * Unknown labels never invent a rank: they fall back to the system, else to "unranked".
 * Themes consume `{ family, level }` and SST-native colors; no official artwork is used.
 */
import type { RatingSystem } from "./types";

export type RankFamily =
  | "unranked"
  | "rookie"
  | "iron"
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond"
  | "master"
  | "high-master"
  | "grand-master"
  | "ultimate-master";

export interface RankPrestige {
  family: RankFamily;
  /** 0 unranked · 1 lower · 2 mid · 3 high · 4 diamond · 5 master · 6 master extensions. */
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** SST-native accent for the family (not Capcom's palette). */
  color: string;
  /** Division within the family ("1".."5") when the label has one. */
  division: string | null;
}

const FAMILIES: Record<RankFamily, { level: RankPrestige["level"]; color: string }> = {
  unranked: { level: 0, color: "#8a93a6" },
  rookie: { level: 1, color: "#9aa4b8" },
  iron: { level: 1, color: "#a7aeb8" },
  bronze: { level: 1, color: "#d08b5b" },
  silver: { level: 2, color: "#d5deea" },
  gold: { level: 2, color: "#f5c451" },
  platinum: { level: 3, color: "#5fe3d0" },
  diamond: { level: 4, color: "#82a8ff" },
  master: { level: 5, color: "#c48dff" },
  "high-master": { level: 6, color: "#6ee7ff" },
  "grand-master": { level: 6, color: "#ffb347" },
  "ultimate-master": { level: 6, color: "#ff6aa8" },
};

/** "Diamond 1" / "High Master" → family + division. */
const LABEL =
  /^(rookie|iron|bronze|silver|gold|platinum|diamond|master|high[ -]?master|grand[ -]?master|ultimate[ -]?master)(?:\s+([1-5]))?$/i;

export function rankPrestige(
  rankLabel: string | null | undefined,
  system: RatingSystem | null | undefined,
): RankPrestige {
  const match = rankLabel ? LABEL.exec(rankLabel.trim()) : null;
  let family: RankFamily;
  if (match?.[1]) {
    const key = match[1].toLowerCase().replace(/[ -]/g, "");
    family = (
      key.endsWith("master") && key !== "master" ? `${key.slice(0, -6)}-master` : key
    ) as RankFamily;
  } else {
    // No usable label: MR only exists at Master tier; anything else stays neutral.
    family = system === "mr" ? "master" : "unranked";
  }
  const { level, color } = FAMILIES[family];
  return { family, level, color, division: match?.[2] ?? null };
}
