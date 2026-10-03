/**
 * MockSF6DataProvider — a fake CFN backed by the mock_cfn_* tables.
 *
 * State lives in Postgres (not memory) so the web app (which simulates matches) and the worker
 * (which polls) see the same data, exactly like they would with the real CFN.
 *
 * Conventions:
 *   - Any 6–12 digit id exists, except ids starting with "000" (→ not_found).
 *   - Players are generated deterministically from the id on first lookup.
 *   - `failUntil` simulates an outage (provider throws "unavailable").
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type {
  MatchMode,
  MatchResult,
  NormalizedPlayerProfile,
  NormalizedSF6Match,
} from "@/domain/sf6/types";
import type { Database } from "@/server/db/client";
import { mockCfnMatch, mockCfnPlayer } from "@/server/db/schema";
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

export class MockSF6DataProvider implements SF6DataProvider {
  readonly name = "mock";

  constructor(private readonly db: Database) {}

  async getPlayerProfile(cfnUserId: string): Promise<NormalizedPlayerProfile> {
    const player = await this.ensurePlayer(cfnUserId);
    this.assertAvailable(player.failUntil);
    return {
      cfnUserId,
      displayName: player.displayName,
      mainCharacter: player.mainCharacter,
      rank: mockRankFor(player.leaguePoints, player.masterRate),
      leaguePoints: player.leaguePoints,
      masterRate: player.masterRate,
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
    return rows.map((r) => ({
      externalMatchId: r.id,
      playedAt: r.playedAt,
      mode: r.mode,
      result: r.result,
      playerCharacter: r.playerCharacter,
      playerControlType: "classic",
      opponent: { name: r.opponentName, character: r.opponentCharacter, rank: null },
      ratingAfter: { leaguePoints: r.leaguePointsAfter, masterRate: r.masterRateAfter },
    }));
  }

  /* ───────────── Dev-only helpers (called from guarded dev actions / seed) ───────────── */

  async simulateMatch(
    cfnUserId: string,
    input: { result?: MatchResult; mode?: MatchMode; secondsAgo?: number } = {},
  ): Promise<{ id: string; result: MatchResult }> {
    const player = await this.ensurePlayer(cfnUserId);
    const result: MatchResult = input.result ?? (Math.random() < 0.55 ? "win" : "loss");
    const mode: MatchMode = input.mode ?? "ranked";

    let lp = player.leaguePoints;
    let mr = player.masterRate;
    if (mode === "ranked" && result !== "draw") {
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

    const id = `mock-${randomBytes(8).toString("hex")}`;
    const playedAt = new Date(Date.now() - (input.secondsAgo ?? 0) * 1000);
    await this.db.transaction(async (tx) => {
      await tx.insert(mockCfnMatch).values({
        id,
        cfnUserId,
        playedAt,
        mode,
        result,
        playerCharacter: player.mainCharacter,
        opponentName: pick(OPPONENT_NAMES, randInt(0, 1000)),
        opponentCharacter: pick(SF6_CHARACTERS, randInt(0, 1000)),
        leaguePointsAfter: lp,
        masterRateAfter: mr,
      });
      await tx
        .update(mockCfnPlayer)
        .set({ leaguePoints: lp, masterRate: mr })
        .where(eq(mockCfnPlayer.cfnUserId, cfnUserId));
    });
    return { id, result };
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

  private async ensurePlayer(cfnUserId: string) {
    if (cfnUserId.startsWith("000")) {
      throw new SF6ProviderError("not_found", `No CFN player with id ${cfnUserId}`);
    }
    const existing = await this.db
      .select()
      .from(mockCfnPlayer)
      .where(and(eq(mockCfnPlayer.cfnUserId, cfnUserId)))
      .limit(1);
    if (existing[0]) return existing[0];

    const seed = hash(cfnUserId);
    const isMaster = seed % 2 === 0;
    const values = {
      cfnUserId,
      displayName: `${pick(NAME_PARTS, seed)}${pick(NAME_PARTS, seed >>> 8)}${seed % 100}`,
      mainCharacter: pick(SF6_CHARACTERS, seed >>> 4),
      leaguePoints: isMaster ? MASTER_LP : 15_000 + (seed % 9_000),
      masterRate: isMaster ? 1_450 + (seed % 300) : null,
    };
    await this.db.insert(mockCfnPlayer).values(values).onConflictDoNothing();
    const [row] = await this.db
      .select()
      .from(mockCfnPlayer)
      .where(eq(mockCfnPlayer.cfnUserId, cfnUserId))
      .limit(1);
    if (!row) throw new SF6ProviderError("unavailable", "Mock player could not be created");
    return row;
  }
}
