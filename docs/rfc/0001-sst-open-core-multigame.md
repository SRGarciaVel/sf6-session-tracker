# RFC 0001 — SST: open core, cloud and a multi-game path

| Field      | Value                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------- |
| Status     | **Draft**                                                                                   |
| Date       | 2026-10-05                                                                                  |
| Scope      | Architecture, product boundaries, data model evolution. **No implementation.**              |
| Applies to | `main` at `889385a` (closed beta live on Render + Supabase, embedded mode, Companion 0.1.0) |

> SST is not affiliated with or endorsed by Capcom. Street Fighter and Street Fighter 6 are
> trademarks of Capcom Co., Ltd.

---

## 1. Executive summary

"SF6 Session Tracker" becomes **SST — Session Stats Tracker** ("Session tracking & overlays for
fighting games"). Street Fighter 6 is the first and, today, **only** supported game. This RFC
audits the real repository and proposes how to get there without breaking the live beta.

**What the audit found**

- **The core logic is already mostly game-neutral.** The Session Engine (`src/domain/session/engine.ts`)
  computes W/L, win rate, streaks, membership and per-character deltas, and none of it depends on
  SF6 rules. The same holds for ingestion (dedupe + session assignment), the worker runtime and
  leases, realtime (LISTEN/NOTIFY + SSE), overlays (tokens, connections, config), auth, rate
  limiting and the Companion's pairing/device/versioning framework.
- **The leakage is in vocabulary and types, not in algorithms.** The engine imports its types
  from `src/domain/sf6/` → `@sf6/capcom-core/types`:
  - closed `RatingSystem = "lp" | "mr"`;
  - `CharacterRatingProfile.leaguePoints` / `masterRate`;
  - a `MatchMode` containing SF6's `battle_hub`;
  - `NormalizedSF6Match`;
  - `SF6DataProvider.getPlayerProfile(cfnUserId)`.
- **Real multi-game blockers are few and well located:**
  1. LP/MR stored as two typed columns in `player_character_rating` and `session_character_baseline`;
  2. one player per account (`sf6_player_user_id_uq`) and no game id anywhere;
  3. a Companion protocol whose identity field is `cfnUserId`.
     Table names like `sf6_player` are ugly but **not** blockers.
- **There is nothing commercial to protect yet.** No plans, entitlements, premium features or
  billing exist. Limits are hardcoded (10 overlays, 10 history rows on the dashboard).

**Recommendations**

1. **Brand first, code later.** Rename the product surface (README, metadata, Companion display
   name) to SST with "Supported game: Street Fighter 6". Keep technical names unless a rename
   removes a real blocker.
2. **Entitlements before multi-game.** Creator Beta is near-term and concrete; a second game is
   not. Build a small server-side plan → entitlements resolver and Creator Keys (hashed,
   one-time, atomic redeem) **in the public repo**. That code has no commercial value by itself;
   the value is in premium features that don't exist yet.
3. **Neutral contracts as a type-level move**, then additive DB changes (generic rating value,
   then `game_id`) only when a second game is actually scheduled. No big-bang refactor and no
   table renames.
4. **Open core:**
   - Public: everything that exists today, plus the entitlement interface.
   - Private ("SST Cloud"): plan administration, billing, the premium overlay catalog, advanced
     analytics and creator widgets, added as private modules **when they exist**.
   - Recommended split: a private repository that composes the public core (Option B, §13).
     No microservices.
5. **Companion:** one shared framework, **one extension per game** by default, so host
   permissions stay minimal. Revisit a single multi-game extension only with real demand.

---

## 2. Current architecture (as built)

```
Buckler's Boot Camp (Capcom)                         ← SF6 + Buckler + CFN + LP/MR
  │  read in the user's browser with their own session
  ▼
SF6 Session Companion (apps/companion-extension)     ← Buckler transports, CFN, SF6 polling
  │  normalizes with @sf6/capcom-core (parse/league/contract) → NormalizedSF6Match / Profile
  │  POST /api/companion/sync  { cfnUserId, profile, matches, client.version }
  ▼
Companion API (src/server/companion/service.ts)      ← CFN (identity check), stores per account
  │  companion_snapshot (user_id, cfn_user_id)  +  ingestMatches()
  ▼
CompanionSF6DataProvider (src/server/sf6/providers)  ← SF6DataProvider contract (cfnUserId)
  │  freshness check (COMPANION_SNAPSHOT_MAX_AGE_MS)
  ▼
Tracker / worker (src/server/tracking)               ← neutral (leases, polling policy);
  │  claim → pollPlayer → provider → ingest              calls provider with cfnUserId
  ▼
Ingestion (src/server/ingestion/ingest.ts)           ← neutral: dedupe (player, external id),
  │  match rows, session assignment under lock         session assignment, rating refresh
  ▼
PostgreSQL                                            ← LP/MR columns in rating tables
  │  pg_notify('sf6_events')
  ▼
Session Engine (src/domain/session) on read           ← neutral logic, SF6-typed inputs
  ▼
Realtime hub + SSE (src/server/realtime)              ← neutral
  ▼
Dashboard / OBS overlay (src/app, src/components)     ← neutral rendering; SF6 copy + LP/MR units
```

**Who knows what**

| Concept                                           | Known by                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Buckler (site, `_next/data`, buildId, transports) | `packages/sf6-capcom-core` (parse, buckler, build-id, pagination), `apps/companion-extension/src/lib/buckler-*`, `src/server/sf6/providers/capcom/` (server prototype)                           |
| CFN user id                                       | Companion protocol (`cfnUserId`), `sf6_player.cfn_user_id`, `companion_snapshot` PK, provider method arguments, tracker, onboarding UI, readiness, dev scripts                                   |
| LP / MR / phase                                   | `@sf6/capcom-core/types` (`RatingSystem`, `CharacterRatingProfile`), `src/domain/sf6/rating.ts`, rating tables' columns, `game_session` legacy columns, overlay state (`system`), UI unit labels |
| Characters                                        | Everywhere as `characterKey` (slug) + `characterName`. The concept is generic; the keys are SF6's.                                                                                               |
| SF6 match modes                                   | `MATCH_MODES` incl. `battle_hub`; default session filter `["ranked"]`                                                                                                                            |
| Nothing game-specific                             | session math, ingestion, leases/worker runtime, realtime, overlay tokens/connections, auth, rate limiting, heartbeat, Companion pairing/devices/versions, release tooling                        |

**Where SF6 concepts leak into the general domain**

1. `src/domain/session/engine.ts` imports `RatingSystem`, `MatchMode`, `CharacterKey` and
   `RatingPoint` from `@/domain/sf6/types`. The logic doesn't care, but the types fix LP/MR.
2. `src/domain/overlay/state.ts` uses `RatingSystem` for `system`; the overlay renders an LP/MR
   unit.
3. `src/server/dashboard/state.ts` and the readiness model (`src/domain/companion/readiness.ts`)
   expose a field literally named `buckler`.
4. The provider contract is `SF6DataProvider` with `cfnUserId` parameters, and every caller
   passes a CFN id.
5. `sf6_player` is the root of every per-player table (`player_id → sf6_player.id`).

---

## 3. SF6 coupling audit

**Classification**

- **A** — correctly SF6-specific: keep as is.
- **B** — should be generic in SST Core: generalize when it pays off.
- **C** — infrastructure that is already neutral.

| Area               | Element                                                                                    | Class        | Notes                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------- |
| Data source        | Buckler parser, buildId, pagination, league mapping (`packages/sf6-capcom-core`)           | A            | Pure and well isolated. Stays SF6-only. Its name `@sf6/capcom-core` is accurate.                           |
| Data source        | Server Capcom provider prototype (`src/server/sf6/providers/capcom`)                       | A            | Research and fallback. Not used in production.                                                             |
| Data source        | Mock provider + `mock_cfn_*` tables                                                        | A            | Dev only. Can stay SF6-shaped.                                                                             |
| Identity           | CFN user id format and validation (`cfnUserIdSchema`)                                      | A            | The _value_ is SF6. The _slot_ ("external player id") is B.                                                |
| Identity           | `sf6_player.cfn_user_id`, protocol `cfnUserId`                                             | B            | Becomes `(game_id, external_player_id)` conceptually; column rename not required.                          |
| Rating             | `RatingSystem = "lp" \| "mr"`, `phase`                                                     | A/B          | The values are SF6 (A); the closed union inside core types is B.                                           |
| Rating             | `leaguePoints` / `masterRate` fields and columns                                           | B            | **Real blocker**: two typed columns instead of one value + system.                                         |
| Rating             | Comparability rule (same character, system, phase) in `domain/sf6/rating.ts`               | B            | Generic rule ("same subject, system, season"). Only the `ratingPointOf` LP/MR switch is SF6.               |
| Rating             | `match.rating_before_* / rating_after_*` (system, value, rank, phase)                      | C/B          | **Already generic shape.** Only the `system` type is closed.                                               |
| Characters         | `characterKey` slug + display name, per-character progress, active character               | B            | Generic for fighting games; needs a game scope, not a redesign.                                            |
| Match              | `externalMatchId`, `playedAt`, `result`, opponent name/character/rank                      | B            | Already generic.                                                                                           |
| Match              | `MatchMode` incl. `battle_hub`; `ControlType` (classic/modern/dynamic)                     | A/B          | Mode set should be declared per game; control type is SF6-only (A, optional field).                        |
| Session            | Engine, membership/baseline, stats, streaks, recap                                         | B→C          | Logic is neutral. It becomes C once its imports are neutral types.                                         |
| Session            | `game_session` `initial/final_league_points/master_rate/rank` (legacy model)               | A            | Only for `rating_model = 'legacy'` sessions. Frozen history, keep.                                         |
| Tracking           | Worker runtime, leases, polling policy, backoff                                            | C            | Polling numbers live in env/`COMPANION_POLLING`.                                                           |
| Ingestion          | Dedupe + session assignment under lock                                                     | C            | Keyed by `(player_id, external_match_id)`.                                                                 |
| Realtime           | Hub, `sf6_events` channel name, SSE, connection limits                                     | C            | Channel name is cosmetic.                                                                                  |
| Overlays           | Tokens, connections, config schema, themes, presets                                        | C            | Overlay _content_ shows LP/MR units (B, via rating system labels).                                         |
| Auth / security    | Better Auth, CSRF/origin, rate limits, client IP                                           | C            |                                                                                                            |
| Companion          | Pairing, device tokens, state, sync loop, versions, release tooling                        | C            | Framework.                                                                                                 |
| Companion          | Buckler client/transports, host permission `streetfighter.com/6/buckler/*`                 | A            | Adapter.                                                                                                   |
| Companion protocol | `companionSyncRequestSchema` `{ cfnUserId, profile, matches }`                             | B            | Needs `game` + generic player id in a v2. v1 stays for SF6.                                                |
| Readiness / UI     | `buckler` field, "Inicia sesión en Buckler", CFN labels                                    | A/B          | Copy is legitimately SF6 while SF6 is the only game; the field name should be `source` once there are two. |
| Env                | `SF6_PROVIDER`, `CAPCOM_*`                                                                 | A            | Correctly specific (selects SF6 implementations).                                                          |
| Env                | `COMPANION_*`, `TRACKER_*`, `WORKER_*`, auth, rate limit, runtime mode                     | C            |                                                                                                            |
| Naming             | Root package `sf6-session-tracker`, `__sf6*` globals, `.sf6-overlay` CSS, `demo@sf6.local` | C (cosmetic) | Not blockers.                                                                                              |
| Tests              | Fixtures `tests/fixtures/capcom/*`, integration tests on SF6 data                          | A            | SF6 tests stay. Neutral modules get game-agnostic tests when their types move.                             |

---

## 4. Domain boundaries

Three layers, validated against what exists:

```
┌────────────────────────── SST Core (game-neutral) ───────────────────────────┐
│ contracts: GameId, PlayerRef, Fighter, RatingPoint, NormalizedMatch/Profile  │
│ session engine · ingestion · tracker runtime · realtime · overlays · auth    │
│ companion framework (pairing, devices, sync loop, versions)                  │
└──────────────▲─────────────────────────────────────────────▲─────────────────┘
               │ implements GameProvider + GameDescriptor     │ consumes Entitlements
┌──────────────┴───────────────┐               ┌──────────────┴──────────────────┐
│ Game module: sf6             │               │ Edition: self-hosted | cloud     │
│ @sf6/capcom-core (Buckler)   │               │ cloud: plans, creator keys,      │
│ providers: companion/capcom/ │               │ billing, premium modules         │
│ mock · companion adapter     │               │ (private, later)                 │
│ rating systems lp/mr, modes  │               └─────────────────────────────────┘
└──────────────────────────────┘
```

**Rule:** core never imports a game module. Game modules depend on core contracts. The
composition root (`src/server/sf6/index.ts` today, a game registry later) wires them together.

---

## 5. Multi-game target architecture (contracts)

Minimal and validated against the current types. Most of this is renaming or widening what
already exists, not new concepts.

| Contract            | Shape (conceptual)                                                                                          | Today's equivalent                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GameId`            | string literal union, starting with `"sf6"`                                                                 | implicit                                                                                       |
| `GameDescriptor`    | `{ id, displayName, matchModes, defaultSessionModes, ratingSystems, playerIdPattern, characterKeyPattern }` | scattered: `MATCH_MODES`, `DEFAULT_SESSION_FILTER`, `cfnUserIdSchema`, `CHARACTER_KEY_PATTERN` |
| `PlayerRef`         | `{ game: GameId; externalId: string }`                                                                      | `cfnUserId`                                                                                    |
| `Fighter`           | `{ key: string; name: string }` (key unique **within** a game)                                              | `characterKey` + `characterName`                                                               |
| `RatingSystemId`    | game-declared string, e.g. `"lp"`, `"mr"` for SF6                                                           | `RatingSystem`                                                                                 |
| `RatingPoint`       | `{ system, value: number \| null, rank?, rankTier?, season? }`                                              | `RatingPoint` (value required today; `phase` = season)                                         |
| `NormalizedProfile` | `{ player: PlayerRef, displayName, favoriteFighter?, ratings: FighterRating[] }`                            | `NormalizedPlayerProfile`                                                                      |
| `NormalizedMatch`   | `{ externalMatchId, playedAt, mode, result, fighter, opponent, ratingBefore?, ratingAfter?, extras? }`      | `NormalizedSF6Match` (`playerControlType` → game `extras`)                                     |
| `GameProvider`      | `getPlayerProfile(externalId)`, `getRecentMatches(externalId)` (+ optional `getMatchesSince`)               | `SF6DataProvider` (same methods, same `scope` option)                                          |

**Deliberately not added:** generic stat plugins, per-game engine hooks, a universal match schema
beyond the above, or tournaments, teams and regions (§19).

`MatchMode` becomes `string` declared by the game descriptor. The engine already treats modes
opaquely (`filter.modes.includes(match.mode)`), so only the type widens. `"ranked"` stays the
SF6 default.

---

## 6. Rating and fighter model

**Today**

- **Per character.** Ratings travel with `characterKey` (enforced by AGENTS rules and tests).
- **Two systems per character** (LP for Rookie→Diamond, MR for Master) **plus a phase**.
  Values are only comparable within the same system and phase (`areComparable`), and the delta
  is `null` otherwise, never invented.
- **Storage:**
  - `match`: generic shape (`rating_*_system/value/rank/phase`).
  - `player_character_rating` and `session_character_baseline`: typed `league_points` /
    `master_rate` columns plus `rating_system`.
  - `game_session`: legacy global values (frozen, `rating_model = 'legacy'`).
- **Ranks without a value** are already supported: rank text and a rank-change display
  (`initial.rank → current.rank`) work even when the delta is `null`.

**Requirements for other games**

- rating per character (SF6, likely GG/Tekken);
- one rating per account (some games);
- tier/rank only, with no number;
- several systems or seasons.

**Options**

| Option                                           | Description                                                                                                       | Pros                                                                                                                               | Cons                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **R1 — keep typed columns, add more**            | add `<game>_points` columns per game                                                                              | no migration of existing rows                                                                                                      | schema grows per game; queries branch per game; rejected                                                              |
| **R2 — generic value + system id (recommended)** | rating rows hold `rating_system` (game-declared id), `rating_value` (nullable int), `rank`, `rank_tier`, `season` | same shape as `match` already has; LP/MR become two system ids; tiers-only = `value null`; deltas keep working via `areComparable` | one additive migration + backfill on two tables; dual-read window                                                     |
| **R3 — JSONB rating blob**                       | `rating jsonb` per row                                                                                            | maximum flexibility                                                                                                                | loses constraints and indexability; easy to "invent" comparisons; rejected for core (fine for optional game `extras`) |

**Recommendation: R2.**

- **Rating subject.** Keep `character_key` as the subject. For a game with an account-wide
  rating, the game descriptor declares `ratingScope: "player"` and the provider reports it under
  a reserved subject key (e.g. `"_player"`). This needs no new table and no special case in the
  engine (it already groups by key). **Defer** implementing the player scope until such a game
  is scheduled.
- **Migration path (when scheduled):**
  1. Add `rating_value`.
  2. Backfill it as `CASE rating_system WHEN 'mr' THEN master_rate WHEN 'lp' THEN league_points END`.
  3. Dual-write, then read from the new column.
  4. Drop the old columns in a later release.
- **Display.** Units ("LP", "MR") come from the game descriptor's rating system labels instead
  of a hardcoded `system === "mr" ? "MR" : "LP"`.

---

### 6.1 Fighter / character model

`character` stays a **core** concept: every fighting game in scope has selectable fighters and
per-fighter performance. Keep:

- `characterKey`: stable slug, unique **per game** (the pattern already exists);
- `characterName`: display only, already stored per row because names are localized/changing;
- per-character progress and the **active character** resolution, which are already generic in the engine.

**Changes when a second game exists:**

- the game scope comes from the player row (`game_id`). Keys are never compared across games
  because sessions and players are per game;
- `ControlType` and other mechanics move to an optional per-game `extras` object (§19).

No `fighter` table or global catalog is needed. Providers report key + name, as they do today.

---

## 7. Provider model

**Today:** `SF6DataProvider` (`src/server/sf6/provider.ts`) with three implementations
(`companion` in production, `capcom` prototype, `mock` dev) behind `ResilientProvider` (timeouts,
inflight dedupe, profile cache) and selected by `SF6_PROVIDER`. It is a clean boundary: providers
only fetch and normalize, never compute stats.

**Target layout** (move only when a second game is scheduled):

```
src/server/games/
  registry.ts              GameId → { descriptor, provider factory }
  sf6/
    descriptor.ts          modes, rating systems (lp/mr), id patterns, labels
    providers/{companion,capcom,mock}.ts
packages/
  sf6-capcom-core/         unchanged (Buckler)
  <game>-core/             only if that game also needs browser-side parsing
```

| Lives in a provider / game module                | Does NOT live in a provider                       |
| ------------------------------------------------ | ------------------------------------------------- |
| fetching / receiving data from the game's source | session membership, W/L, streaks, deltas (engine) |
| parsing and normalization into core contracts    | dedupe and session assignment (ingestion)         |
| id validation (player, fighter keys)             | polling schedule and leases (tracker)             |
| rating systems, modes, labels (descriptor)       | storage, realtime, overlays, entitlements         |
| freshness rules for pushed data (companion)      | UI copy beyond labels the descriptor provides     |

`ResilientProvider` and `ProviderCallOptions.scope` (SEC-001 per-account isolation) are already
neutral and stay in core.

---

## 8. Database impact

"Migration needed" means "only when the phase that needs it runs" (§17). **No table renames are
recommended:** renaming tables holding live data costs downtime risk, FK and index churn, and
breaks raw SQL and dashboards, for no functional gain.

| Table                                        | Purpose                                       | SF6-specific?                                      | Change in future?                                                                                                                                                                                                                                | Priority              | Migration                    | Risk                                                                      |
| -------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `sf6_player`                                 | tracked player + tracker state                | name + `cfn_user_id`                               | add `game_id text not null default 'sf6'`; unique `(user_id, game_id)` replaces `(user_id)`. **Keep table name** (ugly but acceptable). Column `cfn_user_id` can stay (documented as external id) or be renamed in the same migration if desired | P2 (only for game #2) | additive + unique index swap | Medium: unique index swap on a live table                                 |
| `game_session`                               | sessions + baseline                           | legacy LP/MR columns (frozen)                      | none                                                                                                                                                                                                                                             | —                     | none                         | —                                                                         |
| `match`                                      | ingested matches                              | no (generic rating shape)                          | widen `rating_*_system` type in code only; optional `extras jsonb` for game mechanics                                                                                                                                                            | P3                    | none / additive              | Low                                                                       |
| `player_character_rating`                    | latest rating per character                   | **yes**: `league_points`, `master_rate`            | add `rating_value` (R2), backfill, dual-write, later drop                                                                                                                                                                                        | P2                    | additive + backfill          | Medium: must keep the overlay/engine output identical (equivalence tests) |
| `session_character_baseline`                 | per-character start/end ratings               | **yes**: `initial/final_league_points/master_rate` | `initial_rating_value`, `final_rating_value` (R2)                                                                                                                                                                                                | P2                    | additive + backfill          | Medium (same)                                                             |
| `overlay`, `overlay_connection`              | OBS overlays                                  | no                                                 | entitlement checks in code only (theme, count)                                                                                                                                                                                                   | P1                    | none                         | Low                                                                       |
| `companion_device`                           | paired browsers (token hash, version)         | no                                                 | optional `game_id` only if one device serves several games (§9, not recommended now)                                                                                                                                                             | —                     | none                         | —                                                                         |
| `companion_pairing_code`                     | one-time pairing codes                        | no                                                 | none                                                                                                                                                                                                                                             | —                     | none                         | —                                                                         |
| `companion_snapshot`                         | latest pushed profile/matches per (user, CFN) | PK uses `cfn_user_id`                              | add `game_id` to PK when game #2 has a companion                                                                                                                                                                                                 | P3                    | PK change (careful)          | Medium                                                                    |
| `mock_cfn_*`                                 | dev mock data                                 | yes                                                | none (dev only)                                                                                                                                                                                                                                  | —                     | none                         | —                                                                         |
| `auth_*`                                     | Better Auth                                   | no                                                 | none                                                                                                                                                                                                                                             | —                     | none                         | —                                                                         |
| `rate_limit_bucket`, `auth_rate_limit`       | distributed rate limits                       | no                                                 | none                                                                                                                                                                                                                                             | —                     | none                         | —                                                                         |
| **new** `account_plan` / `entitlement_grant` | plan + time-bound grants (§11)                | no                                                 | new                                                                                                                                                                                                                                              | P1                    | additive                     | Low                                                                       |
| **new** `creator_key`                        | Creator Keys (§12)                            | no                                                 | new                                                                                                                                                                                                                                              | P1                    | additive                     | Low                                                                       |

**Acceptable but ugly:**

- names: `sf6_player`, `cfn_user_id`, `player_character` (the `match` column holding the
  character name), `mock_cfn_*`, the `sf6_events` channel.

**Real blockers for a second game:**

- one player per account;
- the LP/MR typed columns;
- the snapshot PK without a game.

---

## 9. Companion strategy

**Framework (reusable):**

- pairing and device tokens;
- tracker client (`credentials: "omit"`, bearer);
- storage and state;
- alarm scheduling, the sync loop and cycle (`runCycle`), and recovery;
- popup shell, i18n and diagnostics;
- version reporting and update notices;
- release packaging, validation, checksum and GitHub Releases.

**SF6/Buckler adapter:**

- `buckler-client`, `buckler-transport` (service worker / isolated tab / main tab);
- the host permission `https://www.streetfighter.com/6/buckler/*`;
- `@sf6/capcom-core` parsing;
- `COMPANION_POLLING` numbers tuned to Buckler;
- the CFN input and "Probar conexión con Buckler" copy.

| Option                                                               | Pros                                                                                                                                                      | Cons                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — one multi-game "SST Companion"**                               | one install; one update channel; one pairing per browser                                                                                                  | host permissions for every game's site (privacy surface, store review, user trust); a regression in one adapter ships to every user; `optional_host_permissions` flows add UX and code; protocol must multiplex games from day one |
| **B — one extension per game over a shared framework** (recommended) | minimal permissions per extension; independent releases and risk; matches today's code (one adapter) and release tooling; protocol v2 can just add `game` | several installs for multi-game players; framework must be extracted into a shared package when game #2 starts                                                                                                                     |

**Recommendation: B.** It matches the architecture (one adapter today, release tooling per
package) and the security posture (closed allowlists, no optional permissions). Extract the
framework into a shared package only in the phase that adds game #2.

**Protocol plan.** Keep v1 (`cfnUserId`) for SF6 indefinitely. A v2 adds `game` and `playerId`,
and the server accepts both, keyed by the extension's declared game.

---

## 10. Open-source / private boundary

**Criteria:** commercial value, security (secrecy must never be a security control), maintenance,
contribution potential, self-hosting usefulness and anti-fork value. Everything already
published is MIT (§15); this matrix is about **where future code lives**.

| Module                                                                                       | Long-term home                                                   | Why                                                                                  |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Session Engine, rating rules, normalized contracts                                           | **PUBLIC / Core**                                                | the product's trust anchor; benefits from scrutiny and contributions                 |
| Game modules (`@sf6/capcom-core`, providers, SF6 companion adapter)                          | **PUBLIC / Core**                                                | useful to the community; low anti-fork value (the data source is public and fragile) |
| Tracker runtime, ingestion, realtime, overlays (tokens, connections, base themes)            | **PUBLIC / Core**                                                | self-hosting needs them                                                              |
| Dashboard, basic recap and history, OBS guide, i18n, help pages                              | **PUBLIC / Core**                                                | Core must be genuinely useful                                                        |
| Auth (Better Auth integration), rate limiting, security hardening                            | **PUBLIC / Core**                                                | generic; hiding it adds no value and loses review                                    |
| Companion framework + release tooling                                                        | **PUBLIC / Core**                                                |                                                                                      |
| Entitlement **interface** + resolver + "core" defaults; `creator_key` schema and redeem flow | **SHARED / Public**                                              | enforcement must exist in core code paths; secrecy of the check gives no protection  |
| Plan administration, key issuance tooling for the official service, billing, invoices        | **PRIVATE / Cloud**                                              | operational, official-service only                                                   |
| Premium overlay catalog (new themes/widgets), cloud presets, branding customization          | **PRIVATE / Creator**                                            | direct commercial value; new code, not today's themes                                |
| Advanced analytics, long-term insights, retention jobs beyond core                           | **PRIVATE / Creator**                                            | value + infra cost                                                                   |
| Experimental creator features                                                                | **PRIVATE / Creator** (graduate to Core when mature, if desired) |                                                                                      |

**Already public and staying public:** the three existing themes (`minimal`, `competitive`,
`fighter`), the three presets, today's history and recap. Moving them behind a plan would
remove value from Core and is not recommended.

---

## 11. Entitlements

**Plan ≠ entitlements.** A plan is a commercial label; entitlements are what the code checks.

```
plan:        free | creator_beta   (later: free | plus | creator)
grants:      time-bound overrides (e.g. creator_beta until 2027-01-31, source = creator_key:<id>)
edition:     self-hosted | cloud    (deployment, not a user property)

resolveEntitlements(account, edition) = defaults(edition) ⊕ plan(account) ⊕ active grants
```

**Illustrative entitlement set.** Names to be finalized in the implementing PR.

| Key                                               | Type    | free                                  | creator_beta | self-hosted default         |
| ------------------------------------------------- | ------- | ------------------------------------- | ------------ | --------------------------- |
| `overlays.max`                                    | number  | 10 (today's hardcoded limit)          | 25           | configurable                |
| `overlays.premiumThemes`                          | boolean | false                                 | true         | false (catalog not in Core) |
| `history.dashboardRows` / `history.retentionDays` | number  | 10 rows / unlimited (no purge exists) | more         | configurable                |
| `stats.advanced`                                  | boolean | false                                 | true         | false                       |
| `branding.customizable`                           | boolean | false                                 | true         | true for own instance       |
| `features.experimental`                           | boolean | false                                 | true         | false                       |

**Rules**

- **Server-side only.** Resolve on the server in actions, routes and the overlay payload
  builder. The client receives entitlements **only to render UI**; it never unlocks anything.
- **Downgrades never delete data.** Over-limit items become read-only or hidden, not removed.
- **The public overlay endpoint** checks the overlay owner's entitlements before rendering a
  premium theme, and falls back to a core theme.
- **Storage** (P1): `account_plan(user_id PK, plan, updated_at)` plus
  `entitlement_grant(id, user_id, plan_or_entitlement, source, starts_at, expires_at, revoked_at)`.
  A missing row means `free`.
- **Cache per request.** No new realtime events are needed: plan changes are rare; refresh on
  the next request.

---

## 12. Creator Keys

**Format:**

- `SST-XXXX-XXXX-XXXX-XXXX-XXXX` (Crockford base32, 20 random chars ≈ 100 bits, CSPRNG);
- the human prefix `SST-` and dashes are ignored on input; case-insensitive.

**Table `creator_key`**

| Column                                    | Notes                                                                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` uuid PK                              |                                                                                                                                                     |
| `key_hash` text unique                    | **HMAC-SHA-256(key, server pepper)** preferred over plain SHA-256: a DB leak alone can't confirm keys; at 100 bits plain SHA-256 is also acceptable |
| `key_hint` text                           | last 4 chars, for support conversations. Never the full key                                                                                         |
| `plan` text                               | `creator_beta`                                                                                                                                      |
| `grant_days` int null                     | length of the grant once redeemed (null = until revoked)                                                                                            |
| `expires_at` timestamptz null             | key must be redeemed before this                                                                                                                    |
| `status` text                             | `issued` → `redeemed` \| `revoked` \| `expired` (check constraint)                                                                                  |
| `issued_by`, `issued_at`, `note`          | issuance audit (who/why: streamer name)                                                                                                             |
| `redeemed_by` user id null, `redeemed_at` |                                                                                                                                                     |
| `revoked_by`, `revoked_at`                |                                                                                                                                                     |

**Redeem flow**

1. Server action, so Next's origin check applies.
2. Require an authenticated user.
3. Rate limit, `failClosed: true`: per user (e.g. 5 per hour) and per IP.
4. Normalize the input and compute the HMAC.
5. In **one transaction**:
   ```sql
   update creator_key
      set status = 'redeemed', redeemed_by = $user, redeemed_at = now()
    where key_hash = $hash and status = 'issued'
      and (expires_at is null or expires_at > now())
   returning id, plan, grant_days;
   ```
   If a row comes back, insert the `entitlement_grant` (source = key id). If not, roll back.
6. Respond with one generic error for unknown, used, revoked or expired keys: "this key isn't
   valid or was already used". There is no oracle.
7. Log `{ keyId (when matched), userId, outcome }`, **never the key**. Alert on bursts of
   failures.

| Threat                       | Mitigation                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Brute force                  | 100-bit keys + rate limits (fail-closed) + generic errors + monitoring                                                   |
| Race (two users, same key)   | single conditional `UPDATE … WHERE status='issued'`: exactly one row wins                                                |
| Replay of a redeemed key     | status check; the grant is tied to the redeemer                                                                          |
| Key leaked publicly (stream) | revoke → `status='revoked'`; if already redeemed, revoke the grant too                                                   |
| Client-side unlock           | impossible: entitlements are resolved server-side; the UI only reads them                                                |
| DB read access               | hashes only (HMAC with an env pepper); no plaintext keys stored or logged                                                |
| Issuer abuse                 | issuance via an operator CLI (like `dev:cleanup-test-accounts`) with an audit trail; no public issuance endpoint in beta |

**Issuance in beta:**

- a CLI `pnpm keys:issue --plan creator_beta --days 90 --note "<streamer>"`;
- it prints the key **once**;
- no admin UI yet.

---

## 13. Cloud separation options

| Option                                                                            | Description                                                                                                                                                                                                                                                                         | Pros                                                                                                            | Cons                                                                                                          | Complexity / ops          | Risk        |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------- |
| **A — public monorepo + private service**                                         | official premium features as a separate private service the public app calls                                                                                                                                                                                                        | clean secrecy boundary                                                                                          | network hop, auth between services, two deploys, a free-tier cold start doubled; premature                    | High                      | Medium-high |
| **B — private repo composes public core** (recommended, when premium code exists) | `sst-cloud` (private) depends on the public core as a package or git submodule. It adds private modules (premium themes, analytics, billing) through explicit extension points (entitlement resolver, overlay theme registry, settings panels) and builds the **official** instance | one deploy (still embedded mode on Render); private code never touches the public repo; core stays fully usable | contract drift between repos (mitigate: versioned core releases + CI in the private repo against core `main`) | Medium                    | Medium      |
| **C — partially private backend**                                                 | fork of the app kept private for the official instance                                                                                                                                                                                                                              | fastest to start                                                                                                | permanent merge debt; community fixes hard to bring in; drift guaranteed                                      | Low initially, high later | High        |

**For the current beta:** no split yet. Implement the entitlement foundation and Creator Keys in
the public repo (they protect nothing by secrecy). Choose **B** the day the first premium module
is written. Prepare by keeping extension points (theme registry, entitlement resolver) explicit
in core.

---

## 14. Self-hosting

**A self-hosted SST Core user gets:**

- account system;
- the SF6 Companion and tracking;
- dashboard and session history;
- basic overlays, all current themes and OBS;
- realtime;
- i18n;
- embedded or split deployment.

Entitlements resolve to the **core edition defaults**: limits configurable by the operator,
premium flags false because the premium modules aren't in the code.

**Exclusive to the official service:**

- managed hosting and persistence;
- the premium catalog, advanced analytics and cloud presets;
- Creator Beta perks and future billing;
- official Companion releases pointing to the official tracker origin (self-hosters build their
  own with `COMPANION_TRACKER_ORIGINS`).

**Forks:**

- A fork can raise its own limits. That's fine and expected under MIT.
- A fork cannot get premium modules, because they never ship publicly.
- A fork cannot use the SST name or logo for a competing official service (trademark, §16).

---

## 15. Licensing considerations (not legal advice)

- **Already MIT.** The repository has been public under **MIT** since 2026-10-04 (`8cb8b47`,
  public visibility the same day). Every published commit is MIT forever for whoever obtained
  it; this cannot be revoked.
- **Future code.** The copyright holder can license **new** code differently: keep it
  proprietary in a private repo (Option B), or relicense future versions of the public repo.
  Relicensing public code later is socially costly and needs every contributor's agreement for
  their parts.
- **Contributions.** With external contributors and a commercial service, consider a CLA or a
  DCO plus an explicit inbound=outbound policy. **Legal review required** before accepting
  significant contributions if dual licensing is ever planned.
- **Brand assets.** The logo files (`docs/brand/`, `public/brand/`) are in the MIT repo.
  Whether MIT covers brand assets is ambiguous. Recommend adding a trademark/brand notice:
  "SST name and logo are not licensed under MIT". **Legal review required** before
  commercialization.
- **Capcom terms.** The Companion reads the user's own Buckler data. Using Capcom names in a
  commercial product and the Buckler terms of service need **legal review before paid plans**.

---

## 16. Branding / trademark migration

**Target:**

- "**SST — Session Stats Tracker**", tagline "Session tracking & overlays for fighting games.";
- "Supported game: Street Fighter 6";
- disclaimer kept everywhere it appears today.

| Item                                                                   | Current                 | Change                                                        | When                                                                                                                                      |
| ---------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| README title, tagline, intro                                           | "SF6 Session Tracker"   | SST + tagline + "Supported game: Street Fighter 6"            | **NOW** (next docs PR)                                                                                                                    |
| App metadata (`title`, OG site name, logo `aria-label`, OG image text) | "SF6 Session Tracker"   | "SST" / "SST — Session Stats Tracker"                         | **NOW** (small UI PR; keep the disclaimer)                                                                                                |
| Landing/auth copy, i18n strings mentioning the product                 | SF6-centric             | product = SST; game-specific copy stays where it is about SF6 | **LATER** (with i18n review)                                                                                                              |
| Companion display name                                                 | "SF6 Session Companion" | "SST Companion for Street Fighter 6"                          | **LATER** (next Companion version; the unpacked extension ID doesn't change with the name)                                                |
| Release asset names `sf6-session-companion-beta.*`                     |                         | keep. Renaming breaks the stable download URL                 | **NEVER / not necessary**                                                                                                                 |
| GitHub repo name `sf6-session-tracker`                                 |                         | rename to `sst` or similar                                    | **LATER**: verify that GitHub's redirect also covers `releases/latest/download/…`, update `COMPANION_DOWNLOAD_URL`, docs and badges first |
| Root package name `sf6-session-tracker`                                |                         | `sst`                                                         | **LATER** (cosmetic)                                                                                                                      |
| `@sf6/capcom-core`                                                     |                         | none (accurately SF6)                                         | **NEVER**                                                                                                                                 |
| Env `SF6_PROVIDER`, `CAPCOM_*`                                         |                         | none (select SF6 implementations)                             | **NEVER**                                                                                                                                 |
| Routes                                                                 | no `sf6` in any route   | none                                                          | **NEVER**                                                                                                                                 |
| DB names (`sf6_player`, `cfn_user_id`, `sf6_events`)                   |                         | none (§8)                                                     | **NEVER / not necessary**                                                                                                                 |
| Internal globals (`__sf6*`), CSS `.sf6-overlay`, `demo@sf6.local`      |                         | none                                                          | **NEVER / not necessary**                                                                                                                 |

---

## 17. Incremental roadmap

Ordered by value and risk. Business-relevant work (Creator Beta) comes before speculative work
(game #2). Each phase is independently shippable and leaves SF6 behaviour unchanged.

| Phase                                                 | Objective                                                                                               | Code affected                                                                                | Migrations                                               | Risk                   | Verify                                                                                               | Rollback                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **0 — RFC**                                           | agree on boundaries                                                                                     | docs                                                                                         | none                                                     | none                   | review                                                                                               | —                                                                   |
| **1 — Brand surface**                                 | SST name, tagline, "Supported game: SF6", disclaimer                                                    | README, metadata, OG text, logo label, brand notice                                          | none                                                     | Low                    | visual check, `pnpm build`                                                                           | revert PR                                                           |
| **2 — Entitlement foundation**                        | plan → entitlements resolver; everyone `free`; existing limits (10 overlays, history rows) read from it | new `src/server/entitlements/*`, overlay actions, dashboard history, overlay payload builder | additive `account_plan`, `entitlement_grant`             | Low                    | tests: identical behaviour for `free`; limits come from the resolver                                 | drop usage; tables are inert                                        |
| **3 — Creator Keys + `creator_beta`**                 | invite streamers                                                                                        | `creator_key` table, redeem server action and UI, issuance CLI, audit logs                   | additive `creator_key`                                   | Medium (security)      | unit tests on the atomic redeem (parallel redeem test), rate limits, generic errors; security review | revoke all keys; feature-flag the redeem UI                         |
| **4 — First Creator features**                        | real premium value (e.g. a premium theme, extended history)                                             | theme registry extension point; resolver checks in the public overlay payload                | none                                                     | Medium                 | entitlement tests incl. downgrade; overlay falls back to a core theme                                | disable entitlement → core theme                                    |
| **5 — Cloud split (Option B)**                        | move premium modules to the private repo                                                                | composition points; private CI against core                                                  | none                                                     | Medium                 | official build = core + private; core build still passes alone                                       | ship premium modules from core temporarily                          |
| **6 — Neutral contracts (types only)**                | core types out of `domain/sf6`; `GameProvider` alias; game descriptor for SF6                           | `src/domain/*`, provider interface, overlay state units                                      | none                                                     | Low-medium             | type-level PR with **zero behaviour change**; full suite + equivalence tests                         | revert PR                                                           |
| **7 — Generic rating storage (R2)**                   | `rating_value` columns; descriptor-driven units                                                         | rating tables, ingestion, sessions service                                                   | additive + backfill; drop old columns in a later release | Medium                 | backfill check (`rating_value` = LP/MR per system on every row); overlay/recap snapshots unchanged   | read path switch is a code revert; old columns kept until confirmed |
| **8 — Game identity** (only with a scheduled game #2) | `game_id` on player/snapshot; one player per (user, game)                                               | players, onboarding, companion protocol v2, readiness naming                                 | additive column + unique index swap                      | Medium-high            | migration rehearsal on a prod copy; protocol v1 tests unchanged                                      | keep v1 paths; index swap is reversible while one game exists       |
| **9 — Second game**                                   | real provider + companion adapter                                                                       | new game module; framework extraction                                                        | per §8                                                   | High (new data source) | research spike first (like the CFN research), contract checks, fixtures                              | feature-flag the game                                               |

Phases 6–9 are **optional until a second game is chosen** with a confirmed data source. Phase 6
can be pulled earlier if it makes the Phase 4 code cleaner, because it's type-only.

---

## 18. Risk register

| Risk                                                         | Probability | Impact     | Mitigation                                                                                                                                     |
| ------------------------------------------------------------ | ----------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Overengineering for imaginary games                          | High        | Medium     | §19; phases 6–9 gated on a confirmed game #2                                                                                                   |
| Breaking the live SF6 beta                                   | Medium      | High       | additive migrations only; equivalence tests on engine/overlay output; staged dual-read/write; deploy outside play hours                        |
| DB migration risk (backfill, index swap, PK change)          | Medium      | High       | rehearse on a copy of production; one change per migration; keep old columns until verified                                                    |
| Naming churn (renames with no value)                         | Medium      | Low-medium | §16 NEVER list; renames only where they remove a blocker                                                                                       |
| Entitlement bypass                                           | Medium      | High       | resolve server-side in every enforcement point (actions, routes, public overlay payload); tests per entitlement; client gets display data only |
| Creator Key leak / brute force                               | Medium      | Medium     | 100-bit keys, HMAC hashes, fail-closed rate limits, generic errors, revocation                                                                 |
| Public repo leakage of private code or secrets               | Low-medium  | High       | Option B (private repo); no private code in the public tree; secret scanning stays on                                                          |
| Private/public contract drift                                | Medium      | Medium     | versioned core contracts; private CI against core `main`; extension points documented                                                          |
| Provider instability (Buckler changes)                       | High        | High       | already mitigated by contract checks, fixtures, resilient provider and Companion updates; unaffected by this RFC                               |
| Future games differ more than assumed                        | Medium      | Medium     | research spike before committing; `extras` escape hatch; no premature abstractions                                                             |
| Trademark positioning (Capcom names in a commercial product) | Medium      | High       | game-neutral brand; "Supported game" wording; disclaimer; **legal review before paid plans**                                                   |
| Operational complexity (two repos, more deploys)             | Medium      | Medium     | stay single-deploy (embedded) until load requires split mode; no extra services                                                                |
| Free tier limits (Render/Supabase) with more users           | Medium      | Medium     | split mode already designed (`docs/deploy-render.md`); move when beta traffic justifies it                                                     |

---

## 19. Do not generalize yet

- **Universal stat plugins / per-game stat engines.** W/L, win rate, streaks and rating deltas
  cover every fighting game in sight.
- **Tournaments, brackets, teams, clubs, matchmaking regions.** No feature uses them.
- **Universal replay parser / replay storage.** Providers return normalized matches; raw data
  is not stored by design (privacy).
- **Game-specific mechanics** (control types, drive gauge, input modes) beyond an optional,
  display-only `extras` field.
- **Account-wide ("player scope") ratings.** Design allows it (§6); build it with the game that
  needs it.
- **Multi-game Companion (option A), `optional_host_permissions`, a game marketplace.**
- **A fighter catalog table / character metadata service.** Providers report key + name.
- **Microservices, queues, Redis.** Postgres leases, LISTEN/NOTIFY and the embedded worker are
  enough at this scale.
- **Usage-based billing, seats, organizations/teams.** One account, one streamer.
- **A generic plugin system for overlays.** Use an explicit theme registry instead.

---

## 20. Decisions (ADR summary)

| #   | Decision                                                                                                                                            | Status                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | **SST becomes the game-neutral product brand**; SF6 is presented as "Supported game: Street Fighter 6" with the Capcom disclaimer                   | **ACCEPT NOW**                                    |
| 2   | **SF6 remains the first and only supported provider**; no multi-game claims until a second game works end to end                                    | **ACCEPT NOW**                                    |
| 3   | **Core remains open source (MIT)**: engine, contracts, SF6 module, Companion, tracking, realtime, overlays incl. today's themes, auth, self-hosting | **ACCEPT NOW**                                    |
| 4   | **Commercial value lives in official cloud services and new premium modules**, never by removing existing Core features                             | **ACCEPT NOW**                                    |
| 5   | **Plans and entitlements are separate concepts**, resolved server-side; the client never unlocks features                                           | **ACCEPT NOW**                                    |
| 6   | **Creator Keys**: hashed (HMAC), one-time, atomic conditional redeem, generic errors, fail-closed rate limits, operator CLI issuance                | **ACCEPT NOW** (design)                           |
| 7   | **Roadmap order**: brand → entitlements → Creator Keys → creator features → cloud split; neutral contracts and multi-game later                     | **REVIEW**                                        |
| 8   | **Cloud separation via a private repo composing public core (Option B)**, only when the first premium module exists                                 | **REVIEW**                                        |
| 9   | **Rating model R2** (system id + nullable value + rank/tier + season, per character subject)                                                        | **REVIEW** (implement in Phase 7)                 |
| 10  | **No table renames** (`sf6_player`, `cfn_user_id` stay); additive columns only                                                                      | **ACCEPT NOW**                                    |
| 11  | **Companion: one extension per game over a shared framework (option B)**; protocol v1 kept for SF6                                                  | **REVIEW**                                        |
| 12  | **Game identity (`game_id`, one player per user+game)**                                                                                             | **DEFER** (until game #2 is scheduled)            |
| 13  | **Brand assets / CLA / Capcom-terms legal review**                                                                                                  | **DEFER** (required before paid plans)            |
| 14  | **GitHub repository rename**                                                                                                                        | **DEFER** (after verifying release-URL redirects) |

### Human decisions needed before implementation

1. **Plan names and limits** for `free` vs `creator_beta` (overlay count, history rows/retention,
   which premium features exist first).
2. **Creator Beta terms:** grant duration, whether keys expire unredeemed, how many keys are issued.
3. **Which feature is the first "Creator" value** (premium theme? extended history? analytics?).
   Without one, entitlements have nothing to gate.
4. **Private repo timing** (Option B) and who has access.
5. **Brand notice** for the logo and name, and when to involve legal review.
6. **Product rename timing** in the app UI (Phase 1) versus waiting for the Ranked E2E smoke test.
