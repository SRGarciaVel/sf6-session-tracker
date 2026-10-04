/**
 * Pure parsers / normalizers for Buckler's Boot Camp payloads.
 * No HTTP, no env, no Next.js: objects in, normalized tracker types out (+ warnings).
 * Every mapping rule is backed by the captured HAR; see docs/capcom-provider.md.
 */
import type { z } from "zod";
import { CapcomPayloadError } from "./errors";
import {
  CHARACTER_KEY_PATTERN,
  type CharacterRatingProfile,
  type ControlType,
  type MatchMode,
  type MatchResult,
  type NormalizedPlayerProfile,
  type NormalizedSF6Match,
  type RatingPoint,
} from "./types";
import { mapLeagueInfo, type MappedLeague } from "./league";
import {
  battlelogPageSchema,
  cardSchema,
  playPageSchema,
  replaySchema,
  type CapcomFighterBanner,
  type CapcomPlayPage,
  type CapcomReplay,
  type CapcomReplaySide,
} from "./schemas";

/* ───────── validation helpers ───────── */

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new CapcomPayloadError(
      `Capcom ${what} payload is not as expected — ${describeIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

export const isValidCharacterKey = (key: string): boolean =>
  key.length <= 40 && CHARACTER_KEY_PATTERN.test(key);

/* ───────── card ───────── */

export interface CapcomCard {
  cfnUserId: string;
  displayName: string;
  favoriteCharacterKey: string | null;
  /** league_rank number of the favorite character. */
  leagueRankRaw: number | null;
  leaguePoints: number | null;
  masterRate: number | null;
}

/** GET /api/en/card/{cfnId} */
export function parseCapcomCardPayload(raw: unknown): CapcomCard {
  const card = parseOrThrow(cardSchema, raw, "card");
  return {
    cfnUserId: String(card.sid),
    displayName: card.fighter_name,
    favoriteCharacterKey: card.favorite_character_tool_name ?? null,
    leagueRankRaw: card.league_rank_number ?? null,
    leaguePoints: card.lp ?? null,
    masterRate: card.mr ?? null,
  };
}

/* ───────── play (profile + per-character league) ───────── */

export type CapcomPlay = CapcomPlayPage["pageProps"];

/** GET /_next/data/{buildId}/en/profile/{cfnId}/play.json?sid={cfnId} */
export function parseCapcomPlayPayload(raw: unknown): CapcomPlay {
  return parseOrThrow(playPageSchema, raw, "play").pageProps;
}

/** league_rank → label pairs that Capcom itself sent in this payload. */
function labelHintsFrom(banner: CapcomFighterBanner): Map<number, string> {
  const hints = new Map<number, string>();
  const fav = banner.favorite_character_league_info;
  if (fav?.league_rank_info?.league_rank_name) {
    hints.set(fav.league_rank, fav.league_rank_info.league_rank_name);
  }
  return hints;
}

export interface CapcomCharacterDetail {
  characterKey: string;
  characterId: number;
  characterName: string;
  isPlayed: boolean;
  leagueRankRaw: number;
  rankKnown: boolean;
  unrated: boolean;
  /** `current_season_id` of the payload. NOT used as MR phase (semantics unconfirmed). */
  seasonId: number | null;
}

export interface NormalizedCapcomProfile {
  profile: NormalizedPlayerProfile;
  characters: CapcomCharacterDetail[];
  seasonId: number | null;
  seasonIds: number[];
  warnings: string[];
}

export function normalizeCapcomProfile(
  play: CapcomPlay,
  options: { cfnUserId: string },
): NormalizedCapcomProfile {
  const warnings: string[] = [];
  const ownId = String(play.fighter_banner_info.personal_info.short_id);
  if (ownId !== options.cfnUserId || String(play.sid) !== options.cfnUserId) {
    throw new CapcomPayloadError(
      `Capcom play payload belongs to ${ownId}, expected ${options.cfnUserId}`,
    );
  }
  const seasonId = play.play.current_season_id ?? null;
  const hints = labelHintsFrom(play.fighter_banner_info);

  const characters: CharacterRatingProfile[] = [];
  const details: CapcomCharacterDetail[] = [];
  const seen = new Set<string>();
  const unknownRanks = new Map<number, string[]>();
  for (const c of play.play.character_league_infos) {
    const key = c.character_tool_name;
    if (!isValidCharacterKey(key)) {
      warnings.push(
        `invalid character_tool_name "${key}" (character_id ${c.character_id}) — skipped`,
      );
      continue;
    }
    if (seen.has(key)) {
      warnings.push(`duplicate character_tool_name "${key}" — first entry kept`);
      continue;
    }
    seen.add(key);
    const league = mapLeagueInfo(c.league_info, hints);
    if (!league.rankKnown) {
      unknownRanks.set(league.leagueRankRaw, [
        ...(unknownRanks.get(league.leagueRankRaw) ?? []),
        key,
      ]);
    }
    if (league.ratingSystem === "mr" && league.masterRate === null) {
      warnings.push(`${key}: master_league ${c.league_info.master_league} but master_rating 0`);
    }
    characters.push({
      characterKey: key,
      characterName: c.character_name,
      rank: league.rank,
      rankTier: league.rankTier,
      ratingSystem: league.ratingSystem,
      leaguePoints: league.leaguePoints,
      masterRate: league.masterRate,
      phase: null,
    });
    details.push({
      characterKey: key,
      characterId: c.character_id,
      characterName: c.character_name,
      isPlayed: c.is_played,
      leagueRankRaw: league.leagueRankRaw,
      rankKnown: league.rankKnown,
      unrated: league.unrated,
      seasonId,
    });
  }

  for (const [rank, keys] of [...unknownRanks].sort(([a], [b]) => a - b)) {
    warnings.push(`unknown league_rank ${rank} (${keys.join(", ")}) — rank/rankTier left null`);
  }

  const fav = play.fighter_banner_info.favorite_character_tool_name;
  return {
    profile: {
      cfnUserId: options.cfnUserId,
      displayName: play.fighter_banner_info.personal_info.fighter_id,
      favoriteCharacterKey: fav && seen.has(fav) ? fav : null,
      characters,
    },
    characters: details,
    seasonId,
    seasonIds: play.play.season_ids ?? [],
    warnings,
  };
}

/* ───────── battlelog ───────── */

export interface CapcomBattlelogPage {
  cfnUserId: string;
  currentPage: number;
  totalPage: number;
  /** Raw replay entries (validated individually by normalizeCapcomMatches). */
  replays: unknown[];
}

/** GET /_next/data/{buildId}/en/profile/{cfnId}/battlelog.json?[page=N&]sid={cfnId} */
export function parseCapcomBattlelogPayload(raw: unknown): CapcomBattlelogPage {
  const page = parseOrThrow(battlelogPageSchema, raw, "battlelog").pageProps;
  return {
    cfnUserId: String(page.sid),
    currentPage: page.current_page,
    totalPage: page.total_page,
    replays: page.replay_list,
  };
}

/** replay_battle_type → mode. Only ids observed in captured payloads; everything else is unknown. */
const OBSERVED_BATTLE_TYPES: Readonly<Record<number, MatchMode>> = {
  1: "ranked", // replay_battle_type_name "Ranked Match" (20/20 replays in the HAR)
};

export function mapReplayBattleType(value: number): { mode: MatchMode; known: boolean } {
  const mode = OBSERVED_BATTLE_TYPES[value];
  return mode ? { mode, known: true } : { mode: "unknown", known: false };
}

/** battle_input_type 0 is labelled "[t]クラシック" (Classic) in every captured replay. */
export function mapBattleInputType(value: number | undefined): ControlType | null {
  return value === 0 ? "classic" : null;
}

/**
 * Rounds won = number of round_results entries > 0. This is exactly how Capcom's own battlelog
 * component decides win / lose / draw (chunk 80305: `e[l]>0&&a++`, then `e===l?draw:e>l?win:lose`).
 * The non-zero codes (1, 5, 6…) encode the finish type and are not interpreted here.
 */
export function countRoundsWon(roundResults: readonly number[]): number {
  return roundResults.filter((r) => r > 0).length;
}

export class TrackedPlayerNotInReplayError extends Error {
  override readonly name = "TrackedPlayerNotInReplayError";
  constructor(
    readonly replayId: string,
    readonly trackedCfnId: string,
  ) {
    super(`replay ${replayId}: tracked CFN ${trackedCfnId} is neither player1 nor player2`);
  }
}

export interface MatchPerspective {
  side: "P1" | "P2";
  tracked: CapcomReplaySide;
  opponent: CapcomReplaySide;
  result: MatchResult;
  roundsWon: number;
  roundsLost: number;
}

/** Resolve P1/P2 by `player.short_id` — never assumes the tracked player is player1. */
export function resolveMatchPerspective(
  replay: CapcomReplay,
  trackedCfnId: string,
): MatchPerspective {
  const p1 = String(replay.player1_info.player.short_id) === trackedCfnId;
  const p2 = String(replay.player2_info.player.short_id) === trackedCfnId;
  if (p1 === p2) throw new TrackedPlayerNotInReplayError(replay.replay_id, trackedCfnId);
  const tracked = p1 ? replay.player1_info : replay.player2_info;
  const opponent = p1 ? replay.player2_info : replay.player1_info;
  const roundsWon = countRoundsWon(tracked.round_results);
  const roundsLost = countRoundsWon(opponent.round_results);
  const result: MatchResult =
    roundsWon === roundsLost ? "draw" : roundsWon > roundsLost ? "win" : "loss";
  return { side: p1 ? "P1" : "P2", tracked, opponent, result, roundsWon, roundsLost };
}

/** `uploaded_at` is Unix SECONDS (Capcom's formatter does `dayjs(1e3 * uploaded_at)`). */
export function uploadedAtToDate(uploadedAt: unknown): Date | null {
  if (typeof uploadedAt !== "number" || !Number.isInteger(uploadedAt) || uploadedAt <= 0) {
    return null;
  }
  const date = new Date(uploadedAt * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Rating of the tracked character AT the replay. Evidence (docs §ratingBefore): for 19 consecutive
 * A.K.I. ranked replays, replay[n].league_point + (win ? +gain : −loss) = replay[n+1].league_point,
 * and the newest replay + its result = the profile LP ⇒ the replay value is the LP BEFORE the match.
 * Only proven for LP: no Master replay was captured, so MR stays null (raw kept in details).
 */
function ratingBeforeOf(league: MappedLeague): RatingPoint | null {
  if (league.ratingSystem !== "lp" || league.leaguePoints === null) return null;
  return {
    system: "lp",
    value: league.leaguePoints,
    rank: league.rank,
    rankTier: league.rankTier,
    phase: null,
  };
}

export interface CapcomMatchDetail {
  externalMatchId: string;
  side: "P1" | "P2";
  battleTypeRaw: number;
  battleTypeName: string | null;
  roundsWon: number;
  roundsLost: number;
  /** Raw league block of the tracked side at this replay (LP proven "before"; MR unverified). */
  ratingAtMatchRaw: {
    leaguePoint: number;
    leagueRank: number;
    masterLeague: number;
    masterRating: number;
  };
  playingCharacterKey: string | null;
}

export interface RejectedReplay {
  replayId: string | null;
  reason: string;
}

export interface NormalizedCapcomMatches {
  matches: NormalizedSF6Match[];
  details: CapcomMatchDetail[];
  rejected: RejectedReplay[];
  warnings: string[];
}

const FUTURE_TOLERANCE_MS = 60_000;

export function normalizeCapcomMatches(
  replays: readonly unknown[],
  options: { trackedCfnId: string; now?: Date },
): NormalizedCapcomMatches {
  const now = options.now ?? new Date();
  const out: NormalizedCapcomMatches = { matches: [], details: [], rejected: [], warnings: [] };
  const seen = new Set<string>();

  const reject = (replayId: string | null, reason: string) => {
    out.rejected.push({ replayId, reason });
    out.warnings.push(`replay ${replayId ?? "?"} rejected: ${reason}`);
  };

  for (const raw of replays) {
    const rawId =
      raw && typeof raw === "object" && "replay_id" in raw && typeof raw.replay_id === "string"
        ? raw.replay_id
        : null;
    const parsed = replaySchema.safeParse(raw);
    if (!parsed.success) {
      reject(rawId, `invalid replay — ${describeIssues(parsed.error)}`);
      continue;
    }
    const replay = parsed.data;

    if (seen.has(replay.replay_id)) {
      out.warnings.push(`duplicate replay_id ${replay.replay_id} — first occurrence kept`);
      continue;
    }

    let perspective: MatchPerspective;
    try {
      perspective = resolveMatchPerspective(replay, options.trackedCfnId);
    } catch (err) {
      if (err instanceof TrackedPlayerNotInReplayError) {
        reject(replay.replay_id, `tracked CFN ${options.trackedCfnId} not in replay`);
        continue;
      }
      throw err;
    }

    const { tracked, opponent } = perspective;
    if (!isValidCharacterKey(tracked.character_tool_name)) {
      reject(replay.replay_id, `invalid character_tool_name "${tracked.character_tool_name}"`);
      continue;
    }

    const playedAt = uploadedAtToDate(replay.uploaded_at);
    if (!playedAt) {
      reject(replay.replay_id, `invalid uploaded_at ${String(replay.uploaded_at)}`);
      continue;
    }
    if (playedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
      out.warnings.push(
        `replay ${replay.replay_id}: uploaded_at in the future (${playedAt.toISOString()})`,
      );
    }

    const battleType = mapReplayBattleType(replay.replay_battle_type);
    if (!battleType.known) {
      out.warnings.push(
        `replay ${replay.replay_id}: unknown replay_battle_type ${replay.replay_battle_type}` +
          ` ("${replay.replay_battle_type_name ?? ""}") — mode "unknown"`,
      );
    }

    const trackedLeague = mapLeagueInfo(tracked);
    const opponentLeague = mapLeagueInfo(opponent);
    const opponentKey = isValidCharacterKey(opponent.character_tool_name)
      ? opponent.character_tool_name
      : null;
    if (!opponentKey) {
      out.warnings.push(
        `replay ${replay.replay_id}: invalid opponent character_tool_name "${opponent.character_tool_name}"`,
      );
    }

    seen.add(replay.replay_id);
    out.matches.push({
      externalMatchId: replay.replay_id,
      playedAt,
      mode: battleType.mode,
      result: perspective.result,
      characterKey: tracked.character_tool_name,
      characterName: tracked.character_name,
      playerControlType: mapBattleInputType(tracked.battle_input_type),
      opponent: {
        name: opponent.player.fighter_id || null,
        characterKey: opponentKey,
        characterName: opponent.character_name,
        rank: opponentLeague.rank,
      },
      ratingBefore: ratingBeforeOf(trackedLeague),
      ratingAfter: null,
    });
    out.details.push({
      externalMatchId: replay.replay_id,
      side: perspective.side,
      battleTypeRaw: replay.replay_battle_type,
      battleTypeName: replay.replay_battle_type_name ?? null,
      roundsWon: perspective.roundsWon,
      roundsLost: perspective.roundsLost,
      ratingAtMatchRaw: {
        leaguePoint: tracked.league_point,
        leagueRank: tracked.league_rank,
        masterLeague: tracked.master_league,
        masterRating: tracked.master_rating,
      },
      playingCharacterKey: tracked.playing_character_tool_name ?? null,
    });
  }
  return out;
}
