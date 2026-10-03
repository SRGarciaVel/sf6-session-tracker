/**
 * MockSF6DataProvider — a fake CFN backed by the mock_cfn_* tables.
 *
 * State lives in Postgres (not memory) so the web app (which simulates matches) and the worker
 * (which polls) see the same data, exactly like they would with the real CFN.
 *
 * Conventions:
 *   - Any 6–12 digit id exists, except ids starting with "000" (→ not_found).
 *   - Players are generated deterministically from the id on first lookup, with a per-character
 *     roster: A.K.I. (Diamond, LP), Kimberly and Cammy (Master, MR). Favorite = A.K.I.
 *   - Simulated matches are played with the player's "current character" (dev tools can switch
 *     it, including to a character that is not in the roster yet).
 *   - `failUntil` simulates an outage (provider throws "unavailable").
 */
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { toCharacterKey } from "@/domain/sf6/rating";
import type {
  CharacterKey,
  CharacterRatingProfile,
  MatchMode,
  MatchResult,
  NormalizedPlayerProfile,
  NormalizedSF6Match,
  RatingPoint,
} from "@/domain/sf6/types";
import type { Database } from "@/server/db/client";
import { mockCfnCharacter, mockCfnMatch, mockCfnPlayer } from "@/server/db/schema";
import { SF6ProviderError, type SF6DataProvider } from "../provider";

export const SF6_CHARACTERS = [
  "Ryu",
  "Ken",
  "Chun-Li",
  "Luke",
  "Jamie",
  "Juri",
  "Kimberly",
  "Guile",
  "JP",
  "Marisa",
  "Manon",
  "Dee Jay",
  "Cammy",
  "Lily",
  "Zangief",
  "Blanka",
  "Dhalsim",
  "E. Honda",
  "A.K.I.",
  "Rashid",
  "Ed",
  "Akuma",
  "M. Bison",
  "Terry",
  "Mai",
  "Elena",
  "Sagat",
] as const;

const NAME_PARTS = [
  "Hado",
  "Shoryu",
  "Tatsu",
  "Drive",
  "Rush",
  "Parry",
  "Punish",
  "Frame",
  "Combo",
  "Neutral",
];
const OPPONENT_NAMES = [
  "Kazunoko",
  "Gachikun",
  "Daigo-fan",
  "PunkWannabe",
  "Moke",
  "TokidoAlt",
  "Leshar_ish",
  "AngryBird9",
  "MenaRD_ish",
  "XiaoHai_ish",
  "Snake Eyez",
  "Nemo2",
];

const MASTER_LP = 25_000;
const RANK_TIERS: Array<[name: string, minLp: number, step: number]> = [
  ["Diamond", 20_000, 1_000],
  ["Platinum", 14_000, 1_200],
  ["Gold", 9_000, 1_000],
  ["Silver", 5_000, 800],
  ["Bronze", 3_000, 400],
  ["Iron", 1_000, 400],
  ["Rookie", 0, 200],
];

/** Mock-only LP → rank label mapping. The domain never derives rank from LP. */
export function mockRankFor(lp: number, mr: number | null): string {
  if (mr !== null || lp >= MASTER_LP) return "Master";
  for (const [name, min, step] of RANK_TIERS) {
    if (lp >= min) return `${name} ${Math.min(5, Math.floor((lp - min) / step) + 1)}`;
  }
  return "Rookie 1";
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pick<T>(list: readonly T[], seed: number): T {
  return list[seed % list.length] as T;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const CHARACTER_NAMES = new Map<CharacterKey, string>(
  SF6_CHARACTERS.map((name) => [toCharacterKey(name), name]),
);

type MockCharacterRow = typeof mockCfnCharacter.$inferSelect;

function toProfile(row: MockCharacterRow): CharacterRatingProfile {
  const rank = mockRankFor(row.leaguePoints, row.masterRate);
  return {
    characterKey: row.characterKey,
    characterName: row.characterName,
    rank,
    rankTier: toCharacterKey(rank),
    ratingSystem: row.masterRate !== null ? "mr" : "lp",
    leaguePoints: row.leaguePoints,
    masterRate: row.masterRate,
    phase: null,
  };
}

function pointOf(row: Pick<MockCharacterRow, "leaguePoints" | "masterRate">): RatingPoint {
  const rank = mockRankFor(row.leaguePoints, row.masterRate);
  return row.masterRate !== null
    ? { system: "mr", value: row.masterRate, rank, rankTier: toCharacterKey(rank) }
    : { system: "lp", value: row.leaguePoints, rank, rankTier: toCharacterKey(rank) };
}

export class MockSF6DataProvider implements SF6DataProvider {
  readonly name = "mock";

  constructor(private readonly db: Database) {}

  async getPlayerProfile(cfnUserId: string): Promise<NormalizedPlayerProfile> {
    const player = await this.ensurePlayer(cfnUserId);
    this.assertAvailable(player.failUntil);
    const roster = await this.roster(cfnUserId);
    return {
      cfnUserId,
      displayName: player.displayName,
      favoriteCharacterKey: player.favoriteCharacterKey,
      characters: roster.map(toProfile),
    };
  }

  async getRecentMatches(cfnUserId: string): Promise<NormalizedSF6Match[]> {
    const player = await this.ensurePlayer(cfnUserId);
    this.assertAvailable(player.failUntil);
    const rows = await this.db
      .select()
      .from(mockCfnMatch)
      .where(eq(mockCfnMatch.cfnUserId, cfnUserId))
      .orderBy(desc(mockCfnMatch.playedAt))
      .limit(20);
    const point = (system: "lp" | "mr" | null, value: number | null): RatingPoint | null =>
      system && value !== null ? { system, value } : null;
    return rows.map((r) => ({
      externalMatchId: r.id,
      playedAt: r.playedAt,
      mode: r.mode,
      result: r.result,
      characterKey: r.characterKey,
      characterName: r.playerCharacter,
      playerControlType: "classic",
      opponent: {
        name: r.opponentName,
        characterKey: toCharacterKey(r.opponentCharacter),
        characterName: r.opponentCharacter,
        rank: null,
      },
      ratingBefore: point(r.ratingBeforeSystem, r.ratingBeforeValue),
      ratingAfter: point(r.ratingAfterSystem, r.ratingAfterValue),
    }));
  }

  /* ───────────── Dev-only helpers (called from guarded dev actions / seed / tests) ───────────── */

  /**
   * Play one match with the current character. Ranked matches move that character's rating
   * (and only that character's). `omitRatingBefore` simulates a source without "before" values.
   */
  async simulateMatch(
    cfnUserId: string,
    input: {
      result?: MatchResult;
      mode?: MatchMode;
      secondsAgo?: number;
      omitRatingBefore?: boolean;
    } = {},
  ): Promise<{ id: string; result: MatchResult; characterKey: CharacterKey }> {
    const player = await this.ensurePlayer(cfnUserId);
    const roster = await this.roster(cfnUserId);
    const char = roster.find((c) => c.characterKey === player.currentCharacterKey) ?? roster[0];
    if (!char) throw new SF6ProviderError("unavailable", "Mock roster is empty");
    const result: MatchResult = input.result ?? (Math.random() < 0.55 ? "win" : "loss");
    const mode: MatchMode = input.mode ?? "ranked";

    let lp = char.leaguePoints;
    let mr = char.masterRate;
    const ranked = mode === "ranked" && result !== "draw";
    if (ranked) {
      const won = result === "win";
      if (mr !== null) {
        mr = Math.max(0, mr + (won ? randInt(8, 25) : -randInt(8, 25)));
      } else {
        lp = Math.max(0, lp + (won ? randInt(60, 150) : -randInt(40, 120)));
        if (lp >= MASTER_LP) {
          lp = MASTER_LP;
          mr = 1500;
        }
      }
    }
    const before = mode === "ranked" ? pointOf(char) : null;
    const after = mode === "ranked" ? pointOf({ leaguePoints: lp, masterRate: mr }) : null;

    const id = `mock-${randomBytes(8).toString("hex")}`;
    const playedAt = new Date(Date.now() - (input.secondsAgo ?? 0) * 1000);
    await this.db.transaction(async (tx) => {
      await tx.insert(mockCfnMatch).values({
        id,
        cfnUserId,
        playedAt,
        mode,
        result,
        characterKey: char.characterKey,
        playerCharacter: char.characterName,
        opponentName: pick(OPPONENT_NAMES, randInt(0, 1000)),
        opponentCharacter: pick(SF6_CHARACTERS, randInt(0, 1000)),
        ratingBeforeSystem: input.omitRatingBefore ? null : (before?.system ?? null),
        ratingBeforeValue: input.omitRatingBefore ? null : (before?.value ?? null),
        ratingAfterSystem: after?.system ?? null,
        ratingAfterValue: after?.value ?? null,
      });
      await tx
        .update(mockCfnCharacter)
        .set({ leaguePoints: lp, masterRate: mr })
        .where(
          and(
            eq(mockCfnCharacter.cfnUserId, cfnUserId),
            eq(mockCfnCharacter.characterKey, char.characterKey),
          ),
        );
    });
    return { id, result, characterKey: char.characterKey };
  }

  /**
   * Switch the character used for the next simulated matches. A character outside the roster is
   * added as a fresh Rookie (0 LP) — i.e. a character that was NOT in the session baseline.
   */
  async setCharacter(cfnUserId: string, characterKey: CharacterKey): Promise<string> {
    await this.ensurePlayer(cfnUserId);
    const name = CHARACTER_NAMES.get(characterKey);
    if (!name) throw new SF6ProviderError("not_found", `Unknown mock character ${characterKey}`);
    await this.db
      .insert(mockCfnCharacter)
      .values({ cfnUserId, characterKey, characterName: name, leaguePoints: 0, masterRate: null })
      .onConflictDoNothing();
    await this.db
      .update(mockCfnPlayer)
      .set({ currentCharacterKey: characterKey })
      .where(eq(mockCfnPlayer.cfnUserId, cfnUserId));
    return name;
  }

  async getCurrentCharacter(cfnUserId: string): Promise<CharacterKey | null> {
    return (await this.ensurePlayer(cfnUserId)).currentCharacterKey;
  }

  async setOutage(cfnUserId: string, seconds: number): Promise<void> {
    await this.ensurePlayer(cfnUserId);
    await this.db
      .update(mockCfnPlayer)
      .set({ failUntil: seconds > 0 ? new Date(Date.now() + seconds * 1000) : null })
      .where(eq(mockCfnPlayer.cfnUserId, cfnUserId));
  }

  private assertAvailable(failUntil: Date | null): void {
    if (failUntil && failUntil.getTime() > Date.now()) {
      throw new SF6ProviderError("unavailable", "Mock CFN outage (simulated)");
    }
  }

  private async roster(cfnUserId: string): Promise<MockCharacterRow[]> {
    return this.db
      .select()
      .from(mockCfnCharacter)
      .where(eq(mockCfnCharacter.cfnUserId, cfnUserId))
      .orderBy(asc(mockCfnCharacter.characterName));
  }

  private async ensurePlayer(cfnUserId: string) {
    if (cfnUserId.startsWith("000")) {
      throw new SF6ProviderError("not_found", `No CFN player with id ${cfnUserId}`);
    }
    const seed = hash(cfnUserId);
    await this.db
      .insert(mockCfnPlayer)
      .values({
        cfnUserId,
        displayName: `${pick(NAME_PARTS, seed)}${pick(NAME_PARTS, seed >>> 8)}${seed % 100}`,
        favoriteCharacterKey: "aki",
        currentCharacterKey: "aki",
      })
      .onConflictDoNothing();
    // Default roster (also re-seeds players created before per-character ratings).
    const existing = await this.roster(cfnUserId);
    if (existing.length === 0) {
      await this.db
        .insert(mockCfnCharacter)
        .values([
          {
            cfnUserId,
            characterKey: "aki",
            characterName: "A.K.I.",
            leaguePoints: 20_000 + (seed % 3_000),
            masterRate: null,
          },
          {
            cfnUserId,
            characterKey: "kimberly",
            characterName: "Kimberly",
            leaguePoints: MASTER_LP,
            masterRate: 1_450 + (seed % 100),
          },
          {
            cfnUserId,
            characterKey: "cammy",
            characterName: "Cammy",
            leaguePoints: MASTER_LP,
            masterRate: 1_480 + ((seed >>> 3) % 120),
          },
        ])
        .onConflictDoNothing();
      await this.db
        .update(mockCfnPlayer)
        .set({ favoriteCharacterKey: "aki", currentCharacterKey: "aki" })
        .where(eq(mockCfnPlayer.cfnUserId, cfnUserId));
    }
    const [row] = await this.db
      .select()
      .from(mockCfnPlayer)
      .where(eq(mockCfnPlayer.cfnUserId, cfnUserId))
      .limit(1);
    if (!row) throw new SF6ProviderError("unavailable", "Mock player could not be created");
    return row;
  }
}
