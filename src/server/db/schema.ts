import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { SessionFilter } from "@/domain/session/engine";
import type { MatchMode, MatchResult } from "@/domain/sf6/types";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tz("created_at").notNull().defaultNow();

/* ───────────────────────── Auth (better-auth) ───────────────────────── */

export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export const authSession = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: tz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (t) => [index("auth_session_user_id_idx").on(t.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tz("access_token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("auth_account_user_id_idx").on(t.userId)],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

/* ───────────────────────── SF6 domain ───────────────────────── */

export const sf6Player = pgTable(
  "sf6_player",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    cfnUserId: text("cfn_user_id").notNull(),
    displayName: text("display_name").notNull(),
    mainCharacter: text("main_character"),
    // Latest profile snapshot (current rating).
    rank: text("rank"),
    leaguePoints: integer("league_points"),
    masterRate: integer("master_rate"),
    profileUpdatedAt: tz("profile_updated_at"),
    // Tracker state (see docs/architecture.md §2.8).
    nextPollAt: tz("next_poll_at"),
    profileRefreshUntil: tz("profile_refresh_until"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastPollAt: tz("last_poll_at"),
    lastSuccessAt: tz("last_success_at"),
    lastError: text("last_error"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: tz("lease_expires_at"),
    createdAt: createdAt(),
  },
  (t) => [
    // MVP: one tracked player per account.
    uniqueIndex("sf6_player_user_id_uq").on(t.userId),
    index("sf6_player_next_poll_idx").on(t.nextPollAt),
  ],
);

export const gameSession = pgTable(
  "game_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => sf6Player.id, { onDelete: "cascade" }),
    status: text("status").$type<"active" | "ended">().notNull().default("active"),
    startedAt: tz("started_at").notNull().defaultNow(),
    endedAt: tz("ended_at"),
    // Baseline — immutable after creation.
    baselineMatchId: text("baseline_match_id"),
    baselinePlayedAt: tz("baseline_played_at"),
    initialRank: text("initial_rank"),
    initialLeaguePoints: integer("initial_league_points"),
    initialMasterRate: integer("initial_master_rate"),
    // Frozen when the session ends.
    finalRank: text("final_rank"),
    finalLeaguePoints: integer("final_league_points"),
    finalMasterRate: integer("final_master_rate"),
    filter: jsonb("filter").$type<SessionFilter>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("game_session_status_ck", sql`${t.status} in ('active', 'ended')`),
    // At most one active session per player.
    uniqueIndex("game_session_one_active_uq")
      .on(t.playerId)
      .where(sql`${t.status} = 'active'`),
    index("game_session_player_started_idx").on(t.playerId, t.startedAt),
  ],
);

export const match = pgTable(
  "match",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => sf6Player.id, { onDelete: "cascade" }),
    /** Session this match was counted in; NULL = known history outside any session. */
    sessionId: uuid("session_id").references(() => gameSession.id, { onDelete: "set null" }),
    externalMatchId: text("external_match_id").notNull(),
    playedAt: tz("played_at").notNull(),
    mode: text("mode").$type<MatchMode>().notNull(),
    result: text("result").$type<MatchResult>().notNull(),
    playerCharacter: text("player_character"),
    playerControlType: text("player_control_type"),
    opponentName: text("opponent_name"),
    opponentCharacter: text("opponent_character"),
    opponentRank: text("opponent_rank"),
    leaguePointsAfter: integer("league_points_after"),
    masterRateAfter: integer("master_rate_after"),
    ingestedAt: tz("ingested_at").notNull().defaultNow(),
  },
  (t) => [
    // Exactly-once effect: a match can exist once per player.
    uniqueIndex("match_player_external_uq").on(t.playerId, t.externalMatchId),
    index("match_session_idx").on(t.sessionId, t.playedAt),
    index("match_player_played_idx").on(t.playerId, t.playedAt),
    check("match_result_ck", sql`${t.result} in ('win', 'loss', 'draw')`),
  ],
);

export const overlay = pgTable(
  "overlay",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => sf6Player.id, { onDelete: "cascade" }),
    publicToken: text("public_token").notNull().unique(),
    name: text("name").notNull(),
    config: jsonb("config").notNull(),
    createdAt: createdAt(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("overlay_player_idx").on(t.playerId)],
);

/** One row per open SSE connection; heartbeated. Used for "Overlay connections: N". */
export const overlayConnection = pgTable(
  "overlay_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    overlayId: uuid("overlay_id")
      .notNull()
      .references(() => overlay.id, { onDelete: "cascade" }),
    instanceId: text("instance_id").notNull(),
    connectedAt: tz("connected_at").notNull().defaultNow(),
    lastSeenAt: tz("last_seen_at").notNull().defaultNow(),
  },
  (t) => [index("overlay_connection_overlay_idx").on(t.overlayId, t.lastSeenAt)],
);

/* ───────────── Mock CFN data (MockSF6DataProvider only) ───────────── */

export const mockCfnPlayer = pgTable("mock_cfn_player", {
  cfnUserId: text("cfn_user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  mainCharacter: text("main_character").notNull(),
  leaguePoints: integer("league_points").notNull(),
  masterRate: integer("master_rate"),
  /** Simulated outage: provider calls fail until this time. */
  failUntil: tz("fail_until"),
  createdAt: createdAt(),
});

export const mockCfnMatch = pgTable(
  "mock_cfn_match",
  {
    id: text("id").primaryKey(),
    cfnUserId: text("cfn_user_id")
      .notNull()
      .references(() => mockCfnPlayer.cfnUserId, { onDelete: "cascade" }),
    playedAt: tz("played_at").notNull(),
    mode: text("mode").$type<MatchMode>().notNull(),
    result: text("result").$type<MatchResult>().notNull(),
    playerCharacter: text("player_character").notNull(),
    opponentName: text("opponent_name").notNull(),
    opponentCharacter: text("opponent_character").notNull(),
    leaguePointsAfter: integer("league_points_after").notNull(),
    masterRateAfter: integer("master_rate_after"),
  },
  (t) => [index("mock_cfn_match_user_played_idx").on(t.cfnUserId, t.playedAt)],
);

export type Sf6PlayerRow = typeof sf6Player.$inferSelect;
export type GameSessionRow = typeof gameSession.$inferSelect;
export type MatchRow = typeof match.$inferSelect;
export type OverlayRow = typeof overlay.$inferSelect;
