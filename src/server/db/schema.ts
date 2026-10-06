import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PlanId } from "@/domain/entitlements/plans";
import type { SessionFilter } from "@/domain/session/engine";
import type {
  MatchMode,
  MatchResult,
  NormalizedPlayerProfile,
  NormalizedSF6Match,
  RatingSystem,
} from "@/domain/sf6/types";

/** A NormalizedSF6Match as stored in JSON (playedAt serialized to ISO). */
export type CompanionWireMatch = Omit<NormalizedSF6Match, "playedAt"> & { playedAt: string };

/** Raw bytes (postgres bytea ↔ Node Buffer). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tz("created_at").notNull().defaultNow();

/* ───────────────────────── Auth (better-auth) ───────────────────────── */

export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** Explicit UI language preference ("es" | "en"); NULL = not chosen yet. */
  locale: text("locale"),
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
    /** Character shown on the CFN profile card. Ratings live in player_character_rating. */
    favoriteCharacterKey: text("favorite_character_key"),
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
    /**
     * "per_character": ratings in session_character_baseline.
     * "legacy": created before per-character ratings; initial_* / final_* above are a single
     * global value of unknown character and are NOT used for deltas.
     */
    ratingModel: text("rating_model")
      .$type<"per_character" | "legacy">()
      .notNull()
      .default("per_character"),
    createdAt: createdAt(),
  },
  (t) => [
    check("game_session_status_ck", sql`${t.status} in ('active', 'ended')`),
    check("game_session_rating_model_ck", sql`${t.ratingModel} in ('per_character', 'legacy')`),
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
    characterKey: text("character_key").notNull(),
    /** Display name of the character used (column kept from v1 as `player_character`). */
    characterName: text("player_character").notNull(),
    playerControlType: text("player_control_type"),
    opponentName: text("opponent_name"),
    opponentCharacterKey: text("opponent_character_key"),
    opponentCharacter: text("opponent_character"),
    opponentRank: text("opponent_rank"),
    ratingBeforeSystem: text("rating_before_system").$type<RatingSystem>(),
    ratingBeforeValue: integer("rating_before_value"),
    ratingBeforeRank: text("rating_before_rank"),
    ratingBeforePhase: integer("rating_before_phase"),
    ratingAfterSystem: text("rating_after_system").$type<RatingSystem>(),
    ratingAfterValue: integer("rating_after_value"),
    ratingAfterRank: text("rating_after_rank"),
    ratingAfterRankTier: text("rating_after_rank_tier"),
    ratingAfterPhase: integer("rating_after_phase"),
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

/** Latest known rating of each character of a player (current profile snapshot). */
export const playerCharacterRating = pgTable(
  "player_character_rating",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => sf6Player.id, { onDelete: "cascade" }),
    characterKey: text("character_key").notNull(),
    characterName: text("character_name").notNull(),
    rank: text("rank"),
    rankTier: text("rank_tier"),
    ratingSystem: text("rating_system").$type<RatingSystem>(),
    leaguePoints: integer("league_points"),
    masterRate: integer("master_rate"),
    phase: integer("phase"),
    /** When the provider reported this value (guards against older snapshots overwriting newer). */
    observedAt: tz("observed_at").notNull(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("player_character_rating_uq").on(t.playerId, t.characterKey)],
);

/** Per-character rating at session start (initial_*) and at session end (final_*). */
export const sessionCharacterBaseline = pgTable(
  "session_character_baseline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => gameSession.id, { onDelete: "cascade" }),
    characterKey: text("character_key").notNull(),
    characterName: text("character_name").notNull(),
    /** "session_start" (fresh profile) | "prior_snapshot" (stored earlier snapshot) | "none". */
    source: text("source").$type<"session_start" | "prior_snapshot" | "none">().notNull(),
    initialRank: text("initial_rank"),
    initialRankTier: text("initial_rank_tier"),
    initialRatingSystem: text("initial_rating_system").$type<RatingSystem>(),
    initialLeaguePoints: integer("initial_league_points"),
    initialMasterRate: integer("initial_master_rate"),
    initialPhase: integer("initial_phase"),
    finalRank: text("final_rank"),
    finalRankTier: text("final_rank_tier"),
    finalRatingSystem: text("final_rating_system").$type<RatingSystem>(),
    finalLeaguePoints: integer("final_league_points"),
    finalMasterRate: integer("final_master_rate"),
    finalPhase: integer("final_phase"),
    capturedAt: tz("captured_at").notNull(),
    finalizedAt: tz("finalized_at"),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("session_character_baseline_uq").on(t.sessionId, t.characterKey)],
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
  favoriteCharacterKey: text("favorite_character_key"),
  /** Character the next simulated match is played with (dev tools). */
  currentCharacterKey: text("current_character_key"),
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
    characterKey: text("character_key").notNull(),
    playerCharacter: text("player_character").notNull(),
    opponentName: text("opponent_name").notNull(),
    opponentCharacter: text("opponent_character").notNull(),
    ratingBeforeSystem: text("rating_before_system").$type<RatingSystem>(),
    ratingBeforeValue: integer("rating_before_value"),
    ratingAfterSystem: text("rating_after_system").$type<RatingSystem>(),
    ratingAfterValue: integer("rating_after_value"),
  },
  (t) => [index("mock_cfn_match_user_played_idx").on(t.cfnUserId, t.playedAt)],
);

/** Per-character roster of a mock CFN player. */
export const mockCfnCharacter = pgTable(
  "mock_cfn_character",
  {
    cfnUserId: text("cfn_user_id")
      .notNull()
      .references(() => mockCfnPlayer.cfnUserId, { onDelete: "cascade" }),
    characterKey: text("character_key").notNull(),
    characterName: text("character_name").notNull(),
    leaguePoints: integer("league_points").notNull(),
    masterRate: integer("master_rate"),
  },
  (t) => [uniqueIndex("mock_cfn_character_uq").on(t.cfnUserId, t.characterKey)],
);

/* ───────────────────────── SF6 Session Companion ───────────────────────── */

/**
 * A browser companion paired to a user. Only the SHA-256 of its random device token is stored.
 * Scoped to /api/companion/* — it is not a web session.
 */
export const companionDevice = pgTable(
  "companion_device",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    lastSeenAt: tz("last_seen_at"),
    revokedAt: tz("revoked_at"),
    /** Extension version reported in the last sync (client.version), for update notices. */
    clientVersion: text("client_version"),
  },
  (t) => [
    uniqueIndex("companion_device_token_hash_uq").on(t.tokenHash),
    index("companion_device_user_idx").on(t.userId),
  ],
);

/** One-time, short-lived pairing code (hash only). */
export const companionPairingCode = pgTable(
  "companion_pairing_code",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: tz("expires_at").notNull(),
    usedAt: tz("used_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("companion_pairing_code_hash_uq").on(t.codeHash),
    index("companion_pairing_code_user_idx").on(t.userId),
  ],
);

/**
 * Latest normalized observation pushed by an account's companion for a CFN (served by the
 * "companion" provider). Strictly per account (SEC-001): never read for another account.
 */
export const companionSnapshot = pgTable(
  "companion_snapshot",
  {
    cfnUserId: text("cfn_user_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => companionDevice.id, { onDelete: "set null" }),
    /** NormalizedPlayerProfile (JSON). */
    profile: jsonb("profile").$type<NormalizedPlayerProfile>(),
    profileObservedAt: tz("profile_observed_at"),
    /** Latest normalized matches (wire format: ISO playedAt), newest first, bounded. */
    matches: jsonb("matches").$type<CompanionWireMatch[]>().notNull().default([]),
    matchesObservedAt: tz("matches_observed_at"),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.cfnUserId] })],
);

/* ───────────────────────── Plans (RFC 0001 §11, docs/entitlements.md) ───────────────────────── */

/**
 * Explicit base plan of an account. NO ROW = "free": existing accounts need no backfill.
 * Entitlements are derived in code from the effective plan, never stored here.
 */
export const accountPlan = pgTable(
  "account_plan",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => authUser.id, { onDelete: "cascade" }),
    plan: text("plan").$type<PlanId>().notNull(),
    createdAt: createdAt(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [check("account_plan_plan_ck", sql`${t.plan} in ('free', 'creator_beta')`)],
);

/**
 * Time-bound plan override on top of the base plan (e.g. a 90-day creator_beta grant).
 * Active = not revoked, started, not expired. A grant can only raise the effective plan.
 * Rows are never deleted to "downgrade": they expire or get revoked (audit trail).
 */
export const entitlementGrant = pgTable(
  "entitlement_grant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    plan: text("plan").$type<PlanId>().notNull(),
    /** Who issued it: "operator" now; "creator_key" from Phase 3. */
    source: text("source").$type<"operator" | "creator_key">().notNull(),
    startsAt: tz("starts_at").notNull().defaultNow(),
    /** NULL = until revoked. */
    expiresAt: tz("expires_at"),
    revokedAt: tz("revoked_at"),
    createdAt: createdAt(),
    /** The Creator Key this grant came from (source = 'creator_key'); one grant per key. */
    creatorKeyId: uuid("creator_key_id").references(() => creatorKey.id, {
      onDelete: "restrict",
    }),
  },
  (t) => [
    index("entitlement_grant_user_idx").on(t.userId),
    uniqueIndex("entitlement_grant_creator_key_uq")
      .on(t.creatorKeyId)
      .where(sql`${t.creatorKeyId} is not null`),
    check(
      "entitlement_grant_creator_key_source_ck",
      sql`(${t.source} = 'creator_key') = (${t.creatorKeyId} is not null)`,
    ),
    check("entitlement_grant_plan_ck", sql`${t.plan} in ('creator_beta')`),
    check("entitlement_grant_source_ck", sql`${t.source} in ('operator', 'creator_key')`),
    check(
      "entitlement_grant_window_ck",
      sql`${t.expiresAt} is null or ${t.expiresAt} > ${t.startsAt}`,
    ),
  ],
);

/**
 * One-time Creator Key (docs/creator-keys.md). Plaintext is never stored: key_hash =
 * HMAC-SHA-256(CREATOR_KEY_PEPPER, key). State is derived, not a status column:
 *   redeemed = redeemed_at set · revoked = revoked_at set (independent of redemption)
 *   expired  = not redeemed and expires_at <= now (no job needed)
 * Redeemable = not redeemed, not revoked, not expired (one conditional UPDATE). Rows are never
 * deleted (audit trail); issuance/revocation use the operator connection.
 */
export const creatorKey = pgTable(
  "creator_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyHash: bytea("key_hash").notNull(),
    /** Last 4 characters (not secret), for support: "••••-ABCD". */
    keyHint: text("key_hint").notNull(),
    /** What the key grants, frozen at issuance (redeem never reinterprets old keys). */
    plan: text("plan").$type<PlanId>().notNull(),
    grantDays: integer("grant_days").notNull(),
    issuedAt: tz("issued_at").notNull().defaultNow(),
    /** Unredeemed keys stop working at this instant (issued_at + 30 days). */
    expiresAt: tz("expires_at").notNull(),
    /** Operator label (not an SST account). */
    issuedBy: text("issued_by").notNull(),
    issuedNote: text("issued_note"),
    /** SET NULL keeps the audit row (and redeemed_at) if the account is deleted. */
    redeemedBy: text("redeemed_by").references(() => authUser.id, { onDelete: "set null" }),
    redeemedAt: tz("redeemed_at"),
    revokedAt: tz("revoked_at"),
    revokedBy: text("revoked_by"),
  },
  (t) => [
    uniqueIndex("creator_key_hash_uq").on(t.keyHash),
    index("creator_key_redeemed_by_idx").on(t.redeemedBy),
    check("creator_key_hash_len_ck", sql`octet_length(${t.keyHash}) = 32`),
    check("creator_key_hint_ck", sql`${t.keyHint} ~ '^[0-9A-HJKMNP-TV-Z]{4}$'`),
    check("creator_key_plan_ck", sql`${t.plan} in ('creator_beta')`),
    check("creator_key_grant_days_ck", sql`${t.grantDays} between 1 and 366`),
    check("creator_key_window_ck", sql`${t.expiresAt} > ${t.issuedAt}`),
    check(
      "creator_key_note_len_ck",
      sql`${t.issuedNote} is null or length(${t.issuedNote}) <= 200`,
    ),
    // Who redeemed may become NULL (account deleted); a redeemer without a time never exists.
    check("creator_key_redeemed_ck", sql`${t.redeemedBy} is null or ${t.redeemedAt} is not null`),
    check("creator_key_revoked_ck", sql`${t.revokedBy} is null or ${t.revokedAt} is not null`),
  ],
);

/* ───────────────────────── Rate limiting (distributed) ───────────────────────── */

/** App rate-limit counters shared by every instance (RATE_LIMIT_STORE=postgres). */
export const rateLimitBucket = pgTable("rate_limit_bucket", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: tz("reset_at").notNull(),
});

/** Better Auth's own rate-limit storage (rateLimit.storage = "database"). */
export const authRateLimit = pgTable("auth_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export type CompanionDeviceRow = typeof companionDevice.$inferSelect;
export type CompanionSnapshotRow = typeof companionSnapshot.$inferSelect;

export type Sf6PlayerRow = typeof sf6Player.$inferSelect;
export type GameSessionRow = typeof gameSession.$inferSelect;
export type MatchRow = typeof match.$inferSelect;
export type OverlayRow = typeof overlay.$inferSelect;
