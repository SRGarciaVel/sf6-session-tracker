/**
 * SF6 Session Companion ↔ Session Tracker contract (pure, zod only).
 *
 * The companion is ONLY a data source: it reports observations (profile + matches) that it
 * normalized in the user's browser. Sessions, W/L, baselines and deltas stay server-side.
 * Nothing Capcom-auth related (cookies, tokens, headers) is ever part of this contract.
 */
import { z } from "zod";
import { cfnUserIdSchema, normalizedMatchSchema, normalizedProfileSchema } from "./contract";
import type { NormalizedPlayerProfile, NormalizedSF6Match } from "./types";

/**
 * Polling cadence — the single source of truth (the server echoes it in every state response).
 * MV3 `chrome.alarms` cannot fire more often than every 30 s, so ~20 s is not reachable without
 * keep-alive hacks; 30 s is the platform minimum and is what we use while a session is active.
 */
export const COMPANION_POLLING = {
  /** chrome.alarms period (platform minimum). Each tick asks the tracker for its state. */
  alarmPeriodMs: 30_000,
  /** Battlelog page 1 while a session is active. */
  activeBattlelogMs: 30_000,
  /** play.json (per-character ratings) while a session is active. */
  activeProfileMs: 90_000,
  /** Battlelog + play when NO session is active (keeps the server snapshot fresh for "Start"). */
  idleBucklerMs: 120_000,
  /** Recovery after a restart / gap: battlelog pages walked back at most. */
  recoveryMaxPages: 3,
  /** After 403 / 429 / login-required from Buckler: wait before touching Buckler again. */
  bucklerBackoffMs: 10 * 60_000,
} as const;
export type CompanionPolling = { [K in keyof typeof COMPANION_POLLING]: number };

export const COMPANION_LIMITS = {
  maxMatchesPerSync: 100,
  maxBodyBytes: 256 * 1024,
  /** Server-side rate limit per device. Expected cadence is 30 s, so this never bites normally. */
  minSyncIntervalMs: 5_000,
  knownReplayIds: 50,
} as const;

export const COMPANION_TRANSPORTS = ["service_worker", "isolated_tab", "main_tab"] as const;
export type CompanionTransportKind = (typeof COMPANION_TRANSPORTS)[number];

/* ───────── pairing ───────── */

/** 8 Crockford base32 chars (no I, L, O, U), shown as XXXX-XXXX. */
export const PAIRING_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PAIRING_CODE_LENGTH = 8;

export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export const pairingCodeSchema = z
  .string()
  .transform(normalizePairingCode)
  .pipe(z.string().regex(new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`)));

export const companionPairRequestSchema = z.strictObject({
  code: pairingCodeSchema,
  deviceName: z.string().trim().min(1).max(60),
});

/* ───────── state ───────── */

export const companionStateSchema = z.object({
  /** CFN registered in the tracker for this user (null = none yet). */
  cfnUserId: z.string().nullable(),
  displayName: z.string().nullable(),
  activeSession: z.boolean(),
  /** Most recent externalMatchIds the tracker already has (recovery after restarts). */
  knownReplayIds: z.array(z.string()).max(COMPANION_LIMITS.knownReplayIds),
  /** Whether synced matches are ingested (SF6_PROVIDER=companion) or only stored as snapshot. */
  ingestEnabled: z.boolean(),
  polling: z.object({
    alarmPeriodMs: z.number().int().positive(),
    activeBattlelogMs: z.number().int().positive(),
    activeProfileMs: z.number().int().positive(),
    idleBucklerMs: z.number().int().positive(),
    recoveryMaxPages: z.number().int().positive(),
    bucklerBackoffMs: z.number().int().positive(),
  }),
  serverTime: z.string(),
});
export type CompanionState = z.infer<typeof companionStateSchema>;

export const companionPairResponseSchema = z.object({
  deviceId: z.string(),
  deviceToken: z.string(),
  state: companionStateSchema,
});
export type CompanionPairResponse = z.infer<typeof companionPairResponseSchema>;

/* ───────── sync ───────── */

const isoDate = z.iso.datetime({ offset: true });

/** A normalized match on the wire: playedAt travels as an ISO string. */
export const companionMatchWireSchema = normalizedMatchSchema.extend({
  playedAt: isoDate.transform((s) => new Date(s)),
});

/** Top level is STRICT: an unexpected key (e.g. "cookies") rejects the whole request. */
export const companionSyncRequestSchema = z.strictObject({
  cfnUserId: cfnUserIdSchema,
  observedAt: isoDate,
  profile: normalizedProfileSchema.nullable(),
  matches: z.array(companionMatchWireSchema).max(COMPANION_LIMITS.maxMatchesPerSync),
  gapSuspected: z.boolean(),
  client: z.strictObject({
    version: z.string().max(20),
    transport: z.enum(COMPANION_TRANSPORTS),
  }),
});
export type CompanionSyncRequest = z.input<typeof companionSyncRequestSchema>;
export type CompanionSyncParsed = z.output<typeof companionSyncRequestSchema>;

export const companionSyncResponseSchema = z.object({
  inserted: z.number().int(),
  duplicates: z.number().int(),
  state: companionStateSchema,
});
export type CompanionSyncResponse = z.infer<typeof companionSyncResponseSchema>;

/* ───────── wire serialization (whitelist) ───────── */

/** Explicit whitelist: exactly the contract fields, nothing else from Buckler. */
export function toWireMatch(m: NormalizedSF6Match) {
  return {
    externalMatchId: m.externalMatchId,
    playedAt: m.playedAt.toISOString(),
    mode: m.mode,
    result: m.result,
    characterKey: m.characterKey,
    characterName: m.characterName,
    playerControlType: m.playerControlType ?? null,
    opponent: {
      name: m.opponent.name,
      characterKey: m.opponent.characterKey ?? null,
      characterName: m.opponent.characterName ?? null,
      rank: m.opponent.rank ?? null,
    },
    ratingBefore: m.ratingBefore ?? null,
    ratingAfter: m.ratingAfter ?? null,
  };
}

export function toWireProfile(p: NormalizedPlayerProfile) {
  return {
    cfnUserId: p.cfnUserId,
    displayName: p.displayName,
    favoriteCharacterKey: p.favoriteCharacterKey ?? null,
    characters: p.characters.map((c) => ({
      characterKey: c.characterKey,
      characterName: c.characterName,
      rank: c.rank,
      rankTier: c.rankTier,
      ratingSystem: c.ratingSystem,
      leaguePoints: c.leaguePoints,
      masterRate: c.masterRate,
      phase: c.phase ?? null,
    })),
  };
}

/* ───────── secret guard ───────── */

/** Key names that must never appear in anything the companion sends to the tracker. */
export const FORBIDDEN_PAYLOAD_KEY =
  /cookie|authorization|set-cookie|session[-_ ]?(token|id)|csrf|xsrf|password|passwd|bearer|secret|access[-_ ]?token|refresh[-_ ]?token|id[-_ ]?token|api[-_ ]?key|buckler[-_ ]?r?[-_ ]?id/i;

/** Paths of forbidden keys anywhere in `value` (empty = clean). */
export function findForbiddenKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findForbiddenKeys(v, `${path}[${i}]`));
  if (value === null || typeof value !== "object" || value instanceof Date) return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(FORBIDDEN_PAYLOAD_KEY.test(k) ? [`${path}.${k}`] : []),
    ...findForbiddenKeys(v, `${path}.${k}`),
  ]);
}
