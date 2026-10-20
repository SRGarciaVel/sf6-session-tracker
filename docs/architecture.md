# SST — Session Stats Tracker: Architecture

Practical reference for how the system is put together and why. Keep it short; update it when a
decision changes.

## 1. Shape of the system

```
 Capcom / CFN  (Buckler _next/data, read in the user's browser by the SST Companion for Street Fighter 6 —
               docs/companion.md; server prototype in providers/capcom/, docs/capcom-provider.md)
        │
        ▼
 SF6DataProvider  ── src/server/sf6/          (fetch + normalize; nothing else)
        │
        ▼
 Tracking Worker  ── src/worker/              (persistent Node process, N replicas OK)
   claim lease → poll → ingest → schedule next poll
        │
        ▼
 Match Ingestion  ── src/server/ingestion/    (validate → dedupe → persist, one transaction)
        │                                       + pg_notify('sf6_events') on commit
        ▼
 PostgreSQL  ◄──────────── source of truth (sessions, matches, overlays, tracker state)
        │
        ▼  LISTEN sf6_events (one connection per web instance)
 Next.js web app ── src/app/
   ├─ Session Engine (pure, src/domain/session) computes stats on read
   ├─ Realtime hub   (src/server/realtime)      fans out to N SSE subscribers
   ├─ Dashboard      (authenticated)
   └─ /overlay/<token>  (public, OBS Browser Source)
```

One codebase, two deployment modes (§12): **split** — **web** (`next start`) + **worker**
(`node dist/worker.mjs`) — or **embedded**, where the same scheduler runs inside the web process
(`TRACKER_RUNTIME_MODE=embedded`, single free web service for the closed beta).
There's no Redis, queue or microservice. Postgres provides the leases (row locks) and the event bus
(`LISTEN/NOTIFY`).

## 2. Key decisions

| #   | Decision                                  | Why                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Drizzle ORM** (not Prisma)              | SQL-first and typed, with no query-engine binary. It runs the same in Next and in the worker. Partial unique indexes and `ON CONFLICT DO NOTHING` are first-class. Migrations are plain SQL in `drizzle/`.                                                                                                                                              |
| 2   | **SSE** (not WebSocket)                   | Traffic is server→client only. SSE runs over plain HTTP, `EventSource` auto-reconnects, and it works in OBS CEF without libraries. Every SSE message carries the **full authoritative state**, never a delta.                                                                                                                                           |
| 3   | **Polling** in a worker, adaptive         | 20 s ± jitter while a session is active, exponential backoff on errors (30 → 60 → 120 → 300 s cap), and `Retry-After` is honoured. All values come from env (`src/server/env.ts`). The pure policy lives in `src/domain/tracking/polling.ts`.                                                                                                           |
| 4   | **Caching**                               | `ResilientProvider` wraps every provider with a timeout, single-flight (concurrent identical calls share one upstream request) and a short TTL cache for **profile lookups only**. Match lists are never cached because they are the freshness-critical data. Overlays and dashboards read Postgres, so N overlays never fan out to Capcom.             |
| 5   | **better-auth** (email + password)        | Maintained, built for Drizzle and Next, sessions stored in DB, httpOnly cookies, origin checks and rate limiting built in. Social logins (Twitch/Discord) can be added as providers later.                                                                                                                                                              |
| 6   | **Hosting: Railway** (or Fly.io / Render) | Needs (a) long-lived SSE connections, (b) a process that runs without an HTTP request, and (c) one persistent `LISTEN` connection. Pure Vercel fits none of those well: functions have max durations and a `setInterval` dies with the instance. Deploy a `web` service, a `worker` service and managed Postgres.                                       |
| 7   | **Background worker**                     | `TrackerRuntime` (`src/server/tracking/worker-runtime.ts`): a 1 s scheduler tick claims _due_ players, polls them with bounded concurrency and schedules the next poll in the DB. Stops gracefully (stops claiming, finishes in-flight work, releases leases). Hosted by `src/worker/index.ts` (split) or `src/instrumentation.ts` (embedded), see §12. |
| 8   | **No duplicate trackers**                 | Each player row holds a **lease**: `lease_owner` and `lease_expires_at`. Players are claimed with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`. If a worker dies, the lease expires and another worker continues. Even if two workers overlap, ingestion is idempotent (see §4), so stats stay correct.                                     |
| 9   | **Persistent sessions**                   | The session baseline is written to Postgres when the session starts. Stats are **derived** from the session's matches by the pure Session Engine, so restarts of OBS, browsers, web or worker cannot lose or reset anything.                                                                                                                            |
| 10  | **Overlay tokens**                        | 192-bit random `base64url` (32 chars) in `overlays.public_token`. It is unrelated to internal ids, so it can't be enumerated. The format is validated before any DB hit, endpoints are rate-limited per IP, and the token can be rotated from the dashboard.                                                                                            |

## 3. Data model (`src/server/db/schema.ts`)

**Ratings belong to characters, never to the player.** In SF6 rank, LP and MR are tracked per
character, and two characters' ratings are never subtracted from each other.

```
auth_user ─1:1─ sf6_player ─1:N─ player_character_rating   (current snapshot per character)
                    │
                    ├─1:N─ game_session ─1:N─ session_character_baseline  (initial + final per character)
                    │            └─1:N─ match  (character_key, rating_before/after; unique player+external id)
                    ├─1:N─ match  (pre-session matches have session_id = NULL)
                    └─1:N─ overlay ─1:N─ overlay_connection (presence)
```

- **sf6_player**: CFN id, display name and `favorite_character_key`. It also holds tracker state:
  `next_poll_at`, `consecutive_failures`, `last_success_at`, `last_error`, `lease_owner`,
  `lease_expires_at` and `profile_refresh_until`. It has **no rating columns**.
- **player_character_rating**: the latest profile value per `(player_id, character_key)` (unique),
  covering rank, rank tier, `rating_system` (`lp` | `mr`), LP, MR and phase.
  - `observed_at` guards the upsert: an older snapshot never overwrites a newer one.
- **game_session**: status, start and end times, the match baseline (`baseline_match_id`,
  `baseline_played_at`), `filter`, and `rating_model`.
  - `rating_model` is `per_character`, or `legacy` for sessions created before migration 0002.
  - The old `initial_*` / `final_*` columns are kept read-only for legacy sessions and are
    **never used for deltas**, because their character is unknown.
  - A partial unique index allows one active session per player.
- **session_character_baseline**: one row per `(session_id, character_key)` (unique).
  - `initial_*` is written at session start for every character of the profile
    (`source = session_start`, or `prior_snapshot` for characters only known from an earlier
    snapshot).
  - `final_*` and `finalized_at` are frozen when the session ends.
  - Characters played without a start baseline get a row with `source = none` at the end.
- **match**: `character_key` (required) plus `player_character` (display name), opponent fields,
  and `rating_before_*` / `rating_after_*` (system, value, rank, phase).
  - Unique on `(player_id, external_match_id)`.
  - W/L, win rate, streaks and deltas are **derived, not stored**.
- **overlay**: `public_token` and `config`. The config is jsonb; `ratingCharacterKey` set to
  `null` means "active character". `statsScope` (Phase 5.1, `"session"` by default and for old
  configs, no migration) picks whose stats the overlay shows.
- **creator_overlay_preset** (migration `0010`, [creator-presets.md](creator-presets.md)): saved
  overlay appearance per account (`user_id` FK ON DELETE CASCADE, name and config-size CHECKs).
- **mock_cfn_player / mock_cfn_character / mock_cfn_match**: the fake CFN, used only by the mock
  provider.

Migrations `0002` (additive, with a hand-written deterministic backfill) and `0003` (NOT NULL
constraints, dropping the global rating columns):

- Old sessions are marked `legacy`, with **no invented baselines**.
- Each match's `character_key` is derived from its stored name with the same slug rule as
  `toCharacterKey()`.
- The v1 "rating after" becomes `rating_after_*`: MR if present, otherwise LP.

**Plans and entitlements** (migration `0008`, [docs/entitlements.md](entitlements.md)):
`account_plan` (base plan; **no row = free**) and `entitlement_grant` (time-bound override).
Entitlements are derived in code by one server resolver (`src/server/entitlements/service.ts`),
never stored and never trusted from the client. In Phase 2 both plans behave identically.

## 4. Match ingestion and exactly-once effect

```
FETCH (provider) → NORMALIZE (provider) → VALIDATE (zod) → DEDUPLICATE + PERSIST
→ UPDATE SESSION (session_id assigned on insert) → PUBLISH (pg_notify on commit)
```

- Each match is inserted with `ON CONFLICT (player_id, external_match_id) DO NOTHING RETURNING`.
  Only rows that are actually inserted can be assigned to a session.
- **Membership is decided by identity first, time second** (`isMatchInSession`, decided once at
  insert time):
  1. Matches known when the session started are ingested with `session_id = NULL` before the
     session row exists, so they can never count.
  2. A _new_ ID counts only if all of these hold:
     - the mode passes the filter;
     - `played_at >= started_at − SESSION_START_GRACE_SECONDS` (default **90 s**, absorbing
       coarse or offset CFN timestamps);
     - it is **not strictly older** than the newest baseline match (older means pre-session
       history that showed up late);
     - `played_at <= ended_at`.
  3. The target session must still be **active under its row lock** (`SELECT … FOR UPDATE`).
     Callers resolve the active session before ingesting, so it may end while they wait for the
     lock. A match that arrives after the end, even one played before `ended_at`, is stored as
     history (`session_id = NULL`). An ended session's stats and frozen final ratings never
     change.
- Re-processing the same response 10× changes nothing, and out-of-order arrival doesn't matter.

## 5. Session Engine (`src/domain/session`)

These are pure functions with no IO, React or DB, and they are fully unit tested.

- `computeSessionStats(matches)`: **global** W/L/D, win rate, streaks and form across all
  characters.
- `computeCharacterProgress({ baselines, matches, current })`: per character, the session stats,
  initial and current rating, and the delta.
  - **Stats (Phase 5.1):** `computeSessionStats` over **only that character's matches** (the same
    function as the global stats, never a second algorithm). So W/L/D, win rate, current and best
    streaks and recent form follow the global rules (dedupe, chronological order, draws break
    streaks and are excluded from win rate), and another character's matches never break this
    character's streak. A character with no games has all zeros and empty form.
  - **Initial:** the start baseline, else `ratingBefore` of the character's first match, else
    **unknown**.
  - **Current:** `ratingAfter` of the latest match, else a profile snapshot **not older than that
    match**, else the baseline if the character wasn't played.
  - **Delta:** `current − initial` only for the **same character, system (LP/MR) and phase**;
    otherwise `null`. Never `current − 0`, never MR − LP.
- `resolveActiveCharacter`: the character of the latest counted (Ranked) match, else the
  favorite, else the first rated character, else `null`. This is presentation only.
- `isMatchInSession`: see §4.

Ended sessions use their frozen `final_*` values, never later profile values. Draws don't count
toward win rate and reset both streaks.

## 6. Tracking lifecycle

```
session ACTIVE  → player is "due" (next_poll_at) → worker polls it
session ENDED   → no longer claimed → zero requests to CFN
```

**End session** does one final fetch and ingest inside the closing transaction, so a match finished
after the last poll still counts. If CFN is down, the session ends with the last known data.

Tracking depends **only** on the session being active, not on OBS being open. The streamer can
close OBS mid-session and come back to correct stats. Each poll fetches recent matches. The profile
(MR/LP/rank) is fetched only when new matches were found, during a 90 s window after a new match
(CFN can lag), or every `TRACKER_PROFILE_REFRESH_MS`.

### 6a. Session lifecycle: idle auto-end

An active session ends **by itself** after real inactivity. Users forgot to end sessions, which
left them active for hours or days. In production, all ended sessions were closed > 180 min after
their last match, while gaps between matches have p95 4.8 min.

The policy is pure, in `src/domain/session/lifecycle.ts`. `TrackerRuntime.maintenance()` runs it
through `server/sessions/lifecycle.ts`, on the existing maintenance cadence (60 s, and the first
tick after start-up). It is server-authoritative: it never depends on the dashboard, OBS or the
Companion being the authority.

Two separate concepts:

- **Session activity.** Matches **assigned to the session**, i.e. those that passed its filter
  (any filter, nothing hardcoded).
  - `lastActivityAt = max(started_at, latest played_at)`, using `played_at` (clamped to now), not
    `ingested_at`. A recovered replay page is ingested "now" but was not played now.
  - A non-qualifying match (e.g. casual during a ranked session) is history and does not move it.
- **Player presence.** Buckler's online status as observed by the Companion (§ docs/companion.md).
  - Presence can hold or accelerate the timer.
  - It never creates matches, changes stats or moves `lastActivityAt`.

**Observation run** = the current **continuous** run of successful match observations: `{ since,
observedAt, observations }`. Two observations at most 5 min apart continue the run. A larger gap
(browser closed, Buckler pause, server asleep) starts a new one. The latest observation alone
proves nothing about the gap before it.

| Mode                 | Source                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Companion            | `companion_snapshot.profile.observation` (JSONB), advanced at the server's time **only** by a sync that says it fetched the battlelog (`battlelogObserved: true`). A profile-only cycle (play.json) or an old Companion (field absent) proves nothing about new matches and leaves it untouched: an old Companion therefore gets the 12 h ceiling only |
| Direct Capcom / mock | The tracking runtime's **in-memory** run of its own successful polls. `last_success_at` is only the latest success; persisting continuity would need a schema change. In-memory is conservative: a restart or another replica's polls only shorten a run                                                                                               |

Without a run (Companion closed, nothing proven), SST cannot claim "nobody played".

**Rules** (first that applies wins):

| Rule             | Ends when                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Absolute ceiling | `now − lastActivityAt ≥ 12 h`, regardless of presence or observation                                                                  |
| Playing presence | **Holds** (no idle close) while a **fresh** Practice (any filter) or a fresh Ranked Match (when the filter counts ranked) is observed |
| Offline          | Fresh Offline observed **continuously ≥ 15 min** with **≥ 3 observations**, the whole run after the last session match                |
| Normal idle      | `observation.observedAt − anchor ≥ 45 min`, where `anchor = max(lastActivityAt, last Practice/Ranked observation, observation.since)` |

- **Menu** neither holds nor accelerates.
- **Unknown codes and stale presence** fall back to normal idle plus the ceiling.
- **Why the anchor:** leaving a 2 h Practice block for the Menu on the way to Ranked must not close
  the session at once.
- **Stale Practice/Ranked never holds.** It only anchors the 45 min, and never the 12 h ceiling.
- **Why `observation.since`:** the 45 min must be **observed continuously**.
  - Example: a Companion observed until 20:05, was gone for 2 h, and came back in Menu at 22:05.
    The 2 h gap does not count, because the player may have been in Training.
  - It starts a new run, and the session closes at 22:50 at the earliest.

**Freshness and continuity.** Presence has no timestamp of its own:

- `presenceObservedAt` = the server time the sync was accepted.
- An observation is fresh for `COMPANION_SNAPSHOT_MAX_AGE_MS` (5 min, the same window that makes a
  Companion snapshot usable). The same 5 min is the observation-run gap.
  - It is 10 active battlelog cycles, ≥ 2 idle cycles, and 15 tracker polls.
  - It equals the tracker's maximum backoff, and is shorter than the 10 min Buckler backoff.
  - So any real outage breaks continuity.
- The presence track folds observations into one run, stored in the Companion snapshot JSON (no
  table).
  - A run continues only for the same state with consecutive observations ≤ that window apart.
  - A different state, or a gap in observation, starts a new run.
  - So "15 min Offline" is proven by observations, never inferred from one snapshot.

**One finalization path.** Auto-end calls `endSessionInternal(..., { kind: "idle" })`, the same
function as the "End session" button:

1. Final fetch with `allSettled`: a provider failure never keeps a session open, and the session
   ends with the last known data.
2. Lock the active row and check it is the session that was evaluated.
3. Ingest the final batch and apply the final profile.
4. **Re-evaluate the policy under the lock.** A match from the final fetch, or one ingested while
   auto-end waited for the lock, aborts the close.
5. Freeze the per-character `final_*` values.
6. `status = ended`, `ended_at = now()`, polling off, publish.

Further properties:

- **Concurrency.** Manual vs auto, two workers, or a restart are all serialized by the session row
  lock plus the `status = 'active'` guard, so a session is ended once. Late matches after the end
  stay history (§4.3).
- **Zero-match sessions** end normally and are kept with their baselines.
- **No automatic reopen.** A later match is history until the user starts a new session.
- **No `ended_reason` column.** Each close is logged as
  `session.auto_ended { sessionId, policy, idleMinutes, presenceState, presenceAgeSeconds }`.
- **Overrides for tests/operations only** (not user settings): `SESSION_IDLE_TIMEOUT_MINUTES`,
  `SESSION_OFFLINE_CLOSE_MINUTES`, `SESSION_ABSOLUTE_CEILING_HOURS`.

**Candidate query.** Active sessions come from the partial index `game_session_one_active_uq`.
The latest session match is an index-only backward scan of `match_session_idx`, and the snapshot a
primary-key lookup. The match table is never scanned. Sessions with activity in the last 15 min are
skipped. The sweep is bounded and **rotates**:

- each maintenance run reads at most 4 pages of 25 in (activity, id) keyset order and processes
  them sequentially (one connection at a time);
- the runtime keeps the position for the next run, and a short page wraps around;
- so sessions the policy keeps (fresh Practice, not observed…) can never starve later ones out of a
  fixed first batch.

**For Analytics (Phase 6):**

- a sequence is consecutive qualifying matches inside one session, with no extra time cutoff;
- gameplay duration is the first → last session match, not `started_at → ended_at` (an
  auto-ended session carries an inactivity tail);
- zero-match sessions are excluded from session-performance aggregates;
- older sessions with multi-hour gaps may later be split virtually with the same 45 min timeout.

### 6b. Analytics foundation (Phase 6.0b)

`/dashboard/analytics?range=7d|30d|90d|all&mode=ranked|all[&character=<own key>]` is descriptive
analytics over the
matches **SST has recorded**. That is not the player's complete SF6 history: SST only sees matches
while it observes them. The page says so.

- **Trusted inputs only:** `result`, `played_at`, own character, `mode`, `session_id` and (6.1)
  the opponent CHARACTER.
  - Not used: ratings, opponent rank, opponent names. Per-match MR is unreliable and LP → MR
    session baselines are not segmented yet (Phase 6.3).
- **Pipeline:**
  1. `server/analytics/service.ts` enforces **ownership itself**. Its only export is
     `getPlayerAnalyticsForUser(db, userId, { range, mode, character })`, which resolves that user's
     own player; the player-id loaders are private. There is no API route. The page reads only
     `range`, `mode` and `character` from the URL. Then two queries, run sequentially:
     - the player's own recorded characters (filter options): `GROUP BY character_key`;
     - one narrow projection of 9 columns (no `opponent_name`), played_at descending.
  2. `domain/analytics/{record,aggregate,matchups,sessions,review}.ts` aggregate them (pure, unit
     tested).
  3. The page only formats.
  - No analytics tables, views, jobs or migrations. Index: `match_player_played_idx (player_id,
played_at)`, backward scan plus incremental sort; the mode is a filter on those rows.
- **Range:** a rolling window of N × 24 h ending now, an absolute instant with no calendar or
  timezone semantics. The default is 90 days.
- **Mode:** `ranked` by default, or `all`. SST only identifies Ranked with certainty; other modes
  are stored as `unknown`, and `all` says how many such matches it includes.
- **Metrics:**
  - matches, W / L / D (draws kept apart);
  - win rate = W / (W + L), or "—" when nothing is decided;
  - recent form over the last 5 / 10 / 20 (available sample made explicit when shorter);
  - per own character: record, win rate, usage share, "most played" only for a single top
    character, never "best";
  - sessions with matches and the average matches per session, counted by `match.session_id`
    only. History outside sessions still counts overall.
- **Sample bands** (`domain/analytics/samples.ts`, decided matches): 0 none · 1–4 very small ·
  5–9 small · 10–29 developing · 30+ larger. They are communication bands, not statistical
  guarantees.
- **Later phases:** rating trends (6.3, blocked on segmented baselines). Review priorities (6.4A)
  are below.

#### Matchups (Phase 6.1)

- **Own-character filter** (`?character=<key>`):
  - the key is syntax-checked from the URL, then accepted only if it is one of the player's own
    recorded characters (any range or mode); anything else falls back to all;
  - range + mode + character define the **dataset**. Summary, recent form, sessions and
    matchups all use it.
  - The per-character table stays a cross-character overview (navigator) with the selection
    marked, and the page says so.
- **Matchup** = own character × opponent character, grouped by keys and named after the most
  recent row. Mirror matches count. The opponent table aggregates across the dataset's own
  characters: with a character selected it is that character's matchups, without one it is a
  descriptive total.
- **Missing opponent data:** `match.opponent_character_key` is nullable (the normalizer leaves it
  null for an invalid Capcom id).
  - Such rows are never assigned to a made-up character.
  - They are excluded from matchup tables and reported as a count. They still count in the
    overall record.
- **Highlights:** "strongest / weakest **recorded** performance" are shown only for pairs with
  ≥ `MATCHUP_CALLOUT_MIN_DECIDED` = **10 decided** matches.
  - This is a product threshold, not significance.
  - Ties: larger decided sample, then more matches, then key order.
  - A single eligible pair is shown as strongest only.
  - No pair at the threshold: a neutral message.
  - The wording never claims a "counter", "advantage" or game balance.
- **No matchup matrix:** with many characters a full own × opponent grid is mostly empty and
  unreadable. The character filter plus the opponent table show the same pairs legibly.

#### Session performance (Phase 6.2)

Pure TypeScript over the same 9-column rows (`domain/analytics/sessions.ts`). There is no extra
query and no `game_session` join.

- **Dataset and membership:**
  - the sequences use the page's dataset (range + mode + character) restricted to matches with a
    `session_id`;
  - membership is `match.session_id`, never timestamps, and `game_session.filter` is not consulted;
  - `session_id = NULL` (history outside sessions) is excluded here but still counts in the summary
    and matchups;
  - active sessions are ordinary input.
- **Range boundary:** if the range starts mid-session, only the visible matches take part. Older
  matches are not fetched to rebuild the session.
- **Real session vs analytics segment:**
  - The **real session** is `match.session_id`, with the lifecycle's boundaries.
  - An **analytics segment** is a contiguous block of qualifying matches inside one real
    session. Consecutive qualifying matches **≥ 45 min apart** start a new segment, in **every**
    session, modern or old.
  - A segment boundary does **not** mean the real session ended. A session held open by fresh
    Practice or Ranked presence (§6a) can legitimately contain such a gap, and so can a
    character or mode filter.
  - Segments keep streaks, recovery, halves, duration and match position from bridging long
    stretches without qualifying matches. They also keep old pre-auto-end sessions with very
    long gaps from distorting the aggregates.
  - `SESSION_ANALYTICS_GAP_MS` = `SESSION_IDLE_TIMEOUT_MS`, with the same `>=` comparison as the
    idle rule: exactly 45:00 splits.
  - Gaps are measured between QUALIFYING matches: other characters or modes never bridge them.
  - Nothing is written: real sessions and memberships are unchanged.
- **Order:** played_at ASC, ties by external id.
- **Duration:** a segment's first → last qualifying match.
  - One match = 0.
  - Never `started_at → ended_at`, which can include an idle tail.
  - Shown as the median, plus the average.
  - **Pace** = Σ matches ÷ Σ hours over segments with ≥ 2 matches and duration > 0; otherwise
    unavailable.
- **Streaks:** the longest win and loss runs inside a segment. They never cross a session or a
  split, and a draw breaks both.
- **Win in the next match after a loss:** for each loss that is not the last match of its segment,
  only the immediately next match counts (win = yes; loss or draw = no). The rate is null without
  such a loss.
- **Halves:** segments with ≥ 4 matches, split by count (first = ceil(N / 2), so it takes the
  middle match), aggregated across segments. No trend claim.
- **Match position:** positions 1–10, sample = segments that reached each position.
- **Wording:** neutral. No tilt, fatigue or momentum, and no best/worst session.

#### Review priorities (Phase 6.4A)

`#review` ("Para revisar" / "To review"), right after the overview. It answers "where should I look
first when reviewing my play?" — never "what is technically wrong with my play?".

- **Deterministic, not AI.** `domain/analytics/review.ts` (pure, unit tested) turns the analytics
  of the SAME dataset into signals: no LLM, no external API, no embeddings, no probabilistic
  classification, no randomness, no clock. Same rows ⇒ same signals, ids and order. The domain
  returns facts (discriminated union + evidence); the UI and the i18n catalogs word them and attach
  PREDEFINED review questions.
- **Data:** the same 9-column rows, no new query. `computeAnalytics` builds the matchup section and
  the session segments once and passes them (with the halves) to `computeReviewSection`; `review.ts`
  imports `record` / `matchups` / `sessions`, never `aggregate` (no cycle).
- **Dataset:** range + mode + character, as every other section. No review-specific filters.
- **Gates** (product thresholds, NOT significance; every pp gate uses `>=` with a 1e-9 float
  tolerance, so exactly 10 pp qualifies and 9.9 never does):

  | Signal                     | Comparator                                                                                                                                           | Eligibility                                                           | Trigger                                                   | Link        |
  | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- | ----------- |
  | `matchup-underperformance` | the SAME own character's record in the dataset (all its matches, unknown opponents included) — never the cross-character account record              | pair ≥ 10 decided, character ≥ 30 decided                             | pair WR − character WR ≤ −10 pp                           | `#matchups` |
  | `recent-form-shift`        | latest 20 vs the 20 before them (non-overlapping, canonical newest-first order; never vs the whole range)                                            | ≥ 10 decided in each window (draws stay in the window, out of the WR) | \|Δ\| ≥ 10 pp, up or down                                 | `#recent`   |
  | `session-half-shift`       | Phase 6.2 halves as they are                                                                                                                         | ≥ 5 eligible segments, ≥ 20 decided per half                          | \|second − first\| ≥ 10 pp                                | `#sessions` |
  | `post-loss-transition`     | P(next = win \| loss) vs P(next = win \| win), inside ONE analytics segment (`segmentSessionMatches`: never across a real session or a ≥ 45 min gap) | ≥ 10 observations each                                                | post-loss − post-win ≤ −10 pp (no positive signal in v1)  | `#sessions` |
  | `high-exposure-opponent`   | descriptive (frequency only)                                                                                                                         | ≥ 20 matches and ≥ 10 % of matches with a known opponent              | the single top opponent (more matches, higher share, key) | `#matchups` |
  - A draw as the current match is in neither transition group; a draw as the next match is a
    non-win; a segment's last match has no next match. The post-loss side equals the existing
    "win in the next match after a loss" counts.
  - `session_id = NULL` takes no part in transition / halves signals, but does in recent form
    (which needs no session membership). Rows without an opponent character never form a matchup
    or an exposure signal (no "Unknown" opponent).

- **Selection (no score):** rank by 1. direction — negative comparative, then positive
  comparative, then the neutral exposure signal; 2. larger |Δ pp|; 3. larger evidence sample (the
  smaller side of the comparison; matches for exposure); 4. stable id
  (`matchup:<own>:<opponent>`, `recent:20v20`, `session-halves`, `post-loss`,
  `exposure:<opponent>`). Walk the ranking keeping at most 2 per type until 3 are selected.
  `totalEligible` counts every qualifying signal, so the UI can say more existed.
- **UI:** at most 3 cards with comparator, sample and signed pp; direction by arrow + sign +
  words, never colour alone (restrained loss / win accents; exposure is cyan). Questions sit in a
  collapsed native `<details>` per card; a section-level note says they guide replay review and SST
  does not observe those situations. No signal ⇒ a neutral "not enough sample" state (never "no
  weaknesses").
- **Never claimed:** causes, tilt, fatigue, mental state, adaptation, "bad matchup" / counters,
  improvement or decline trends, significance or confidence. There is no replay telemetry (neutral,
  anti-air, Drive / DI / Parry / Burnout, corner, wake-up, throw tech, punish counters, combos,
  Super) and no rating data (LP / MR / rank): 6.3 stays blocked on segmented baselines.

#### Review report: summary + PDF (Phase 6.4B)

The review priorities (6.4A) can be exported as a branded **SST review report**. The PDF is the
primary format; there is also a plain-text summary for Discord / WhatsApp / e-mail / notes (never
Markdown). Both answer "where to look first", never "what went wrong". There is no AI and no
causal claim.

- **One model, two renderers.** `domain/analytics/review-report.ts` (pure) projects what the page
  already computed into a `ReviewReport`:
  - `context`: range, mode, character, its display name, `from`, `generatedAt`;
  - `snapshot`: the overall record and sessions, copied from the summary;
  - `priorities`: **exactly** `summary.review.signals`, the same objects in the same order;
  - `omittedPriorities` = totalEligible − selected.

  It never re-ranks or recomputes evidence, and it has no ratings and no opponent player names.
  `components/analytics/review-text.ts` words it from the i18n catalogs (`Analytics.review.*`,
  `Analytics.reviewReport.*`) for the web cards, the plain text and the PDF.
  `components/analytics/review-content.ts` holds the shared question-key metadata
  (`REVIEW_QUESTION_KEYS`), so the cards, the summary and the PDF use the same predefined questions.

- **Route:** `GET /dashboard/analytics/review.pdf?range=…&mode=…[&character=…]`.
  1. Better Auth session (401 without).
  2. Locale: account preference, then the `NEXT_LOCALE` cookie, then `es`. Never Accept-Language.
  3. `parseAnalyticsSearchParams`: the same lenient fallbacks as the page. Any other parameter is
     ignored.
  4. `getPlayerAnalyticsForUser(userId)`: the same ownership and the same 3 selects / 9-column
     projection as the page. There is no report query.
  5. `buildReviewReport`, then `renderReviewPdf`.

  No selected signal ⇒ **409** with a short translated text, never an empty PDF; the page does not
  offer the export either. No player ⇒ 404. The route only implements GET: there is no body, and
  no client-sent signals or metrics are read.

- **Response:** `application/pdf`, `Content-Disposition: attachment;
filename="sst-review-<character | all-characters>-<mode>-<range>-<YYYY-MM-DD>.pdf"` (UTC date,
  only `[a-z0-9-]`), `Cache-Control: private, no-store`. Generated on demand and streamed once:
  no DB row, no object storage, no history, no links.
- **Renderer:** `@react-pdf/renderer` 4.9.0, in-process on the server (`src/server/analytics/report/`).
  No Chromium, Playwright, Puppeteer or browser print: SST runs on Render Free.
  - **Compatibility spike (Node 22.22, Next 16 `next start`):** `renderToBuffer`, `Text` / `View` /
    `Svg` / `G` / `Path` and local TTF registration all worked.
  - **Measured:** about 0.3–0.5 s per report including the per-render font reload (~0.5 s end to end through `next start`); reports are 80–110 KB; over 60 consecutive renders the heap stays flat after warm-up (~50 MB after GC; no leak).
- **Fonts:** official static TTFs committed in `src/server/analytics/report/fonts/`, with the OFL
  licenses and their provenance (README).
  - Barlow Condensed 600/700/800 for display, Barlow 400/600 for body, JetBrains Mono 500 for
    metadata. Arrows and diamonds use mono, the only family with those glyphs.
  - **Not `next/font` output:** its hashed WOFF2 subsets crash fontkit on `Ó` / `Ñ` / `é` / `ú`.
  - Hyphenation is disabled (words break only at spaces).
  - **Per-render font reset, renders serialised per process.** react-pdf keeps one fontkit object
    per font across documents. A document rendered after another one lost glyphs ("A.K.I." became
    "K I"). `resetReportFontData()` makes each render reload the TTFs; a regression test compares
    ToUnicode maps.
  - **One page number per page.** Only one dynamic page-number text per page renders reliably, as
    a direct child of the page.
- **Design:** A4 portrait, dark and digital-first, using the dashboard palette, Barlow and the
  brand geometry (`ReportBrandMark` / `ReportBrandLockup` draw `LETTERS` / `ACCENTS` /
  `SLANT_TRANSFORM` / `VIEWBOX` / `LOCKUP_LAYOUT` as vectors). Components:
  - page furniture: a magenta → cyan top line, a restrained vector glow, notched panels, a fixed
    header (monogram + "SST // …") and footer;
  - cover: dataset identity, context, a snapshot telemetry panel with a decided-only W / L bar,
    and a priority overview;
  - priority blocks (`wrap={false}`): number "01 / 03", headline value, arrow + signed pp + words,
    comparison bars, evidence, a neutral "why this appears", and the replay-focus checklist;
  - closing blocks: a worksheet (each priority's own questions), a notes area and the methodology /
    gates.
- **Pagination (intentional, `report-layout.ts`):**

  | Signals | Pages                                                                  |
  | ------- | ---------------------------------------------------------------------- |
  | 1       | cover · priority · worksheet + notes + methodology                     |
  | 2       | cover · two priorities · worksheet + notes + methodology               |
  | 3       | cover · two priorities · priority 03 + worksheet · notes + methodology |

  So 3 or 4 pages, with a hard maximum of 5.

- **Web:** a compact "Prepare review" area under the review cards (only with signals), containing:
  - a native `<details>` preview of the server-built plain text;
  - `ReviewExportActions` (client), which only copies and announces it in a polite live region;
  - a plain link to the PDF route with the page's filters.
- **Never:** ratings (6.3 stays blocked), replay telemetry, causes / tilt / fatigue, generative AI,
  stored reports, or editable PDF fields.

#### Replay selection (Phase 6.4C)

A review priority says **what** recorded pattern deserves review. Replay selection lists
**which** concrete recorded matches belong to that evidence, so they can be found in the game. It
never says why a match was won or lost: SST does not observe replay content.

- **Pure and deterministic:** `domain/analytics/review-replays.ts`. Its inputs are the selected
  `summary.review.signals` and the SAME dataset (range + mode + character), newest first, plus the
  row-aware session segments.
  - Order: `played_at` DESC, ties by external id DESC.
  - No score, no ratings, no opponent player identity (opponent CHARACTER only).
  - Signals are never changed or re-ranked.
- **Rules ("decided" = win or loss):**

  | Signal         | Candidates                                                                                                                                                                |
  | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Matchup        | the 3 newest decided matches of that own × opponent pair (wins **and** losses)                                                                                            |
  | Recent shift   | up to 2 decided matches from the signal's exact latest-20 window and up to 2 from the previous-20 window. Windows are sliced first; a draw is skipped, never back-filled. |
  | Session halves | the most recent segment with ≥ 4 matches that has a decided match in both halves (first half = ceil(N / 2)); its newest decided match in each half                        |
  | Post-loss      | the 2 most recent pairs of a loss and the IMMEDIATELY next match of the same segment (any result; never across a session or a ≥ 45 min split)                             |
  | Exposure       | the 3 newest matches against that opponent character, any result                                                                                                          |

  `session_id = NULL` takes part in matchup, recent and exposure selections, not in halves or
  post-loss. An empty selection just hides the disclosure.

- **One segmentation:** `segmentSessionMatchRows()` keeps the rows. `segmentSessionMatches()` is
  its aggregate projection, so the Phase 6.2 semantics are unchanged; a legacy-oracle equivalence
  test covers that. `computeAnalyticsDetailed()` segments once for session analytics, review and
  replay selection.
- **Server-side, no extra query:** `PlayerAnalytics.reviewReplays` is aligned with the selected
  signals and computed in memory from the rows already loaded. The 3 selects are unchanged; there
  is no migration and no API.
- **UI only:** each review card has a collapsed «Replays para revisar (N)» disclosure showing the
  result, characters, time, the **Replay ID** and a copy button (copies exactly the id).
  - At section level: a «¿Cómo abro un Replay ID?» help (in SF6: CFN → Replays → Search → Keyword
    Search) and the disclaimer that SST does not analyze the replay or determine the cause.
  - There is no Buckler deep link and no third-party site.
- **Export boundary:** replay ids are **not** in ReviewReport, the plain-text summary or the PDF
  (shareable artifacts with a different privacy surface); tests enforce it.

## 7. Realtime

- Worker/web → `pg_notify('sf6_events', {kind, playerId, overlayId?})` after commit.
- Each web instance holds one `LISTEN` connection. The hub debounces events per player, builds the
  player's live snapshot **once**, and pushes it to every SSE subscriber of that player.
- The overlay page server-renders the current state (refresh → still `14-7`, never `0-0`), then
  opens `EventSource('/api/overlay/<token>/stream')`.
- Every SSE `state` event is the full state. On reconnect the server first sends the current
  snapshot, so a lost event fixes itself. A client watchdog reconnects if no ping arrives for 45 s.
  If SSE keeps failing, the client falls back to polling `/state` every 10 s.
- When the `LISTEN` connection reconnects, all subscribers are re-synced (events may have been
  missed).
- Presence: each SSE connection writes a heartbeat row in `overlay_connection`. The dashboard shows
  "Overlay connections: N".

## 8. Overlays

- `/overlay/<token>` is public with no login. Its root layout is transparent and separate from the
  dashboard. Responses send `Cache-Control: no-store`, `noindex` and `Referrer-Policy: no-referrer`.
- The config is stored server-side. Saving in the builder fires an `overlay` event, and OBS updates
  live without changing the URL.
- The renderer `OverlayView` is pure: `(config, state) → JSX`. It is shared by OBS and the
  dashboard preview. It scales from its own measured box (ResizeObserver plus `em` units), so any
  OBS size works.
- **OBS CEF compatibility:** overlay CSS is hand-written. It uses no Tailwind, `oklch`,
  `color-mix`, container queries or `:has()`, and colors are hex/rgba computed in JS. OBS ≥ 31 is
  recommended.
- **Creator Beta customization** (Phase 4, [creator-overlays.md](creator-overlays.md)) adds typed,
  bounded options (secondary accent, number font/size, element visibility) in `config.creator`.
  Every renderer uses the **effective** config, resolved with the overlay **owner's**
  entitlements on each payload or push. The stored config is never mutated by plan changes, and
  non-entitled owners render exactly as before.
- **Themes** live in one typed registry (`src/domain/overlay/themes.ts`): id, tier
  (`free`/`creator`), supported canvases, a deterministic **Free fallback** and `rankAware`.
  Free themes (`minimal`, `competitive`, `fighter`) support every canvas and stay Free. Creator
  themes (Phase 4.5: `rank-card`, `broadcast`, `prestige`) render only when the owner has
  `overlays.premiumThemes`; otherwise `getEffectiveOverlayConfig()` swaps in the registered
  fallback and drops the theme variants. That function is the **single stored → effective path**
  used by the builder preview, the dashboard, the OBS page, `/state` and every SSE push.
- **Master display tier** (`domain/sf6/master-tier.ts`): for active sessions and the idle state,
  `toLiveSessionState` shows a valid MR's documented tier (Master / High / Grand / Ultimate
  Master). It never infers Legend from MR. Persisted raw ranks are never rewritten, and ended
  sessions keep their frozen labels ([capcom-provider.md](capcom-provider.md)).
- **Rank-aware styling** reads only what SST already stores (the rank label and the MR/LP system
  per character). `src/domain/sf6/rank-prestige.ts` maps it to a generic `{ family, level, color }`.
  Themes consume the level and the fixed palette color through classes and `--ov-tier`, and the
  emblem is SST-native CSS (no official artwork). Unknown ranks never invent a tier.
- **Stats scope** (Phase 5.1, Free): `resolveOverlayStats(session, config)` in
  `src/domain/overlay/state.ts` is the **single projection** of what an overlay shows.
  - `"session"`: the global counters, exactly as before.
  - `"character"`: the counters of the character whose rating is shown (`pickRatingCharacter`:
    the pinned `ratingCharacterKey`, else the active character), copied from the engine output.
    If that character isn't available, neutral zeros are shown, never the global numbers.
  - `OverlayView` applies it once, before choosing a theme, so all six themes get the same
    numbers and none recomputes anything. The live payload still carries the global stats plus
    every character's stats. The scope is part of the motion summary, so switching scope never
    plays a match effect.
- **Integrated SST branding** (Phase 5.3C): the same block and controller.
  - Each theme designates a secondary slot (`RecentForm brandSlot`), and the mark is an absolute
    layer over that slot's own box.
  - No side row and no re-measure, so fit-to-box is identical to branding off.
- **SST Brand Flag** (Phase 5.3B, [creator-overlays.md](creator-overlays.md)): an optional tab
  with the official SST mark attached to the panel's side, gated by `overlays.brandFlag`.
  - `[panel][slot]` share a row. Fit-to-box measures the panel plus the reserved slot, so the
    pair always fits the canvas, and the tab animates inside its slot (transform/opacity) without
    re-measuring.
  - Its own `setTimeout` schedule is independent of the live data, rotation and motion.
- **Presentation modes** (Phase 5.3A) generalize rotation to **views**: a session view or a
  character view, a discriminated `PresentationView`. `resolvePresentation()`
  (`domain/overlay/presentation.ts`) is the single projection from the current view to the
  config the themes render (statistics scope, rating character, view label in the title). It is
  never saved; no theme has view logic and no global rating is invented.
- **Creator character rotation** (Phase 5.2, [creator-overlays.md](creator-overlays.md)) is
  presentation state in the browser only. `useCharacterRotation` picks a session character
  (games > 0) and OverlayView renders it through a presentation config, never saved. Nothing is
  persisted and there are no server timers. It is gated by `overlays.characterRotation` in the
  effective config. Match detection for priority and motion uses only authoritative counters
  (same session, `totalGames` grew, `activeCharacterKey`).
- **Fit-to-box** shrinks the root font-size until the content fits. A convergence guard stops it
  from ping-ponging at very small canvases, where borders and glyphs snap to whole pixels (after
  a few adjustments in one frame, only shrinking is allowed).
- **Creator presets** (`creator_overlay_preset`, [creator-presets.md](creator-presets.md)) store
  appearance only and are applied through the normal save rules.
- **Custom CSS is deferred.** See §10 for how to add it safely. Creator customization, Creator
  themes and presets deliberately contain none.

### Overlay kinds (Phase 5.4A — foundation)

An overlay row is one **product**, chosen at creation: `OverlayKind` = `"session"` (Session Stats,
every overlay so far) | `"rank-progress"` (**reserved** for 5.4B: not implemented, not creatable,
nothing renders or edits it). The kind lives in `overlay.config` (`domain/overlay/kind.ts`); there
is **no migration**, no new column and no config version bump.

- **Legacy compatibility:** stored configs without `kind` ARE Session overlays.
  - `parseOverlayConfig()` (still the single parser) dispatches by kind: none / `"session"` → the
    Session parser, unchanged.
  - Any other value, including the not-yet-implemented `"rank-progress"`, falls back to the safe
    Session default, exactly like any other unusable config. No Creator block survives, so nothing
    can bypass entitlement gating.
  - Reading never rewrites a row. New overlays and every save write `kind: "session"`.
- **Immutable kind:** `OverlayView.storedKind` is read from the RAW stored JSON (not the lenient
  parse) and is authoritative for edits.
  - A save needs an editable stored kind (`checkOverlayKindEdit`), and the editor schema only
    accepts `kind: "session"` (missing = session for older clients).
  - The save merge pins the stored kind, so a forged request cannot convert an overlay. To get
    another kind, create another overlay.
- **Same transport:** the same `/overlay/<token>`, `/state`, SSE stream and `{ config, live }`
  payload for every kind (the config just carries its `kind`). No new endpoint, channel or query.
- **Dispatch:**
  - **Renderer:** `OverlayView` → `SessionOverlayView`, the previous component moved unchanged,
    with its fit-to-box logic still Session-specific.
  - **Builder:** `OverlayBuilder` → `SessionOverlayBuilder`.
  - **Effective config:** `getEffectiveOverlayConfig` switches on kind, and the Session Creator
    rules (premium-theme fallback, canvas normalization, motion / rotation / brand-flag gating,
    variant stripping) apply only to Session configs.
  - **Dashboard cards:** they read `overlayReadout(config)` instead of assuming Session fields.
  - **Creation:** `createOverlayAction` takes a kind and accepts only `CREATABLE_OVERLAY_KINDS`
    (Session today, so no picker is shown).
- **Presets are Session presets.** New presets store the kind they were saved from, and legacy
  presets (no kind) read as `"session"`. A preset applies only to an overlay of the same stored
  kind (`incompatible_kind` otherwise), and the builder only lists presets of its kind.
- **Evidence of no visible change:** a local matrix rendered 576 legacy configs through
  parse → effective config → `OverlayView` on `main` and on this branch:
  - 6 themes × 3 canvases;
  - plain, character scope, Creator motion / rotation / modes / brand flag, and integrated
    branding;
  - entitled and Free owners;
  - single- and multi-character state;
  - viewport and box sizing.

  The HTML was byte-identical.

- **Rollback:** reverting to pre-5.4A code is safe today, since old code ignores `kind`. Once 5.4B
  ships Rank Progress rows, old code would read them as Session configs. Remove or convert those
  rows before rolling back, before anyone edits them with old code.

### Rank Progress overlay (Phase 5.4B)

`"rank-progress"` is now a real, creatable overlay kind: an **independent, optional** OBS product
("where am I now, and how far am I from my next rank goal?"). It is not a Session theme, not a
Session stat, not Analytics and not a rating trend: current-state presentation of ONE character.
A streamer may use Session Stats, Rank Progress or both (separate Browser Sources).

- **Config:** its own minimal schema (`domain/overlay/rank-progress.ts`), stored in `overlay.config`
  like every kind — **no migration**, no column, no table. `OverlayConfig` is now a discriminated
  union (`SessionOverlayConfig | RankProgressOverlayConfig`). Fields: `locale`, `characterKey`
  (null = active character), `goal` (`"auto"` | `"master"`), `style` (`"broadcast"` |
  `"compact"`), three display toggles, font, colors, background, border, `animations`. No Session
  field (stat toggles, scope, themes, Creator block) exists on it.
- **Parser:** `parseOverlayConfig()` stays the single public parser: no kind / `"session"` →
  Session; `"rank-progress"` → the Rank Progress parser (an unusable row is the Rank Progress
  default, never another kind); unknown → the safe Session default (never read as Rank Progress).
  The editor schema is the union; a body never validates as the other kind.
- **Domain (pure, `domain/sf6/rank-progress.ts`):** the ONLY owner of LP thresholds and progress
  math; the renderer formats a ready projection (`resolveRankProgressView`).
  - **LP ladder (fixed):** Rookie 0/200/400/600/800 · Iron 1000/1400/1800/2200/2600 · Bronze
    3000/3400/3800/4200/4600 · Silver 5000/5800/6600/7400/8200 · Gold 9000/9800/10600/11400/12200 ·
    Platinum 13000/14200/15400/16600/17800 · Diamond 19000/20200/21400/22600/23800 · Master 25000.
    Labels are derived from the value, never parsed from a display string.
  - **Next division:** bar from the division start to the next division start
    (Diamond 3 · 21,950 LP → 650 to Diamond 4, 45.8 %).
  - **Road to Master:** bar from the current MAJOR rank's start (its division 1) to 25,000 LP —
    progress through the current rank's climb, not lifetime LP from zero.
  - **LP ≥ 25,000:** goal reached (Master), no bar beyond it.
  - **MR (fixed Master tiers, `master-tier.ts`):** Master → 1600, High Master 1600 → 1700, Grand
    Master 1700 → 1800. Below 1600 the bar starts at a 1500 **presentation floor** (the MR a player
    enters Master with); below 1500 it starts at the current value (0 %), so it never implies
    "below Master" — 1500 is not a rank cutoff and the remaining MR stays exact.
  - **Ultimate Master (≥ 1800):** terminal ("Legend · Top 500 required"); no progress or "MR to
    Legend". **Legend is never inferred from MR** (no 2196-style threshold): it needs an
    authoritative top-500 position, which `PlayerLiveState` does not carry, so no Legend state is
    rendered in 5.4B (5.4C).
  - **Goal normalization:** the goal a character can use depends on its CURRENT system, which can
    change (auto character, LP → MR). An MR character always measures the next Master tier; a
    stored `"master"` goal is normalized at render time and never rewritten.
  - **Clamping:** progress ∈ [0, 1] (NaN ⇒ 0); the bar is a `scaleX()` of it — never a CSS width.
- **Character selection:** `pickRatingCharacter()` — the Session overlay's own rule (pinned key if
  known, else the active character). No second algorithm. Current value = `current.value`
  (authoritative, never `initial + delta`).
- **Session delta (optional):** the character's own engine `delta`, shown only when
  `baselineKnown` and non-null. Unknown is hidden (never "+0"); a KNOWN zero shows "±0".
- **No session needed:** a player who has never started a session still has a roster. Before
  5.4B the idle live state built it with `computeCharacterProgress` (keys from matches / baselines
  only), so it was always `characters: []` even though onboarding (`upsertPlayerForUser`) and the
  Companion (`updatePlayerProfile`) had persisted `player_character_rating` — a real production
  bug since 4ee1f6d. The idle state now uses the engine's additive `computeIdleRoster` over the
  rows `loadSessionContext` already reads (no extra query): every persisted character, current
  rating as stored, zero stats, unknown start (`initial`/`delta` null, `baselineKnown` false).
  `status` stays `"none"` and no session is created. The only Session-overlay difference is in that
  state: the active character's already-known rating now shows instead of "—".
- **Renderer / builder:** `OverlayView` → `RankProgressOverlayView` (same root contract and
  fit-to-box as Session; `components/overlay/rank-progress.tsx` + OBS-safe `rank-progress.css`);
  `OverlayBuilder` → `RankProgressOverlayBuilder` (Content · Display · Appearance, preview with
  live data or LP / MR / Ultimate samples, OBS output). Canvases: Broadcast 640×140, Compact
  400×140. Progress bar: `role="progressbar"` with real LP/MR `aria-valuemin/max/now`; terminal
  and empty states render no progressbar. Animation: bar transition + the existing number tick,
  off with `animations: false` or `prefers-reduced-motion`.
- **Free:** no entitlement, no Creator rules (`getEffectiveOverlayConfig` returns it as stored),
  no premium styles or motion. **Presets are not supported:** Session presets never list in, nor
  apply to, a Rank Progress overlay (`incompatible_kind`); no Rank Progress preset schema.
- **Transport unchanged:** same `/overlay/<token>`, `/state`, SSE stream, `{ config, live }`; no new
  endpoint, channel, polling, Companion request or leaderboard fetch. Both kinds count toward the
  same overlay limit.
- **Rollback:** reverting to 5.4A is safe: 5.4A reads stored `"rank-progress"` rows as the Session
  default for rendering and refuses to edit them (`overlayKindUnsupported`), never rewriting them;
  re-applying 5.4B restores them intact. Before reverting past 5.4A, delete or convert Rank
  Progress rows (see above).

### Dynamic Legend (Phase 5.4C)

Completes Rank Progress for the Master League. Core question: "am I Legend, and if not, how far is
my MR from the CURRENT Legend cutoff?" Legend is never an MR threshold.

- **Legend = authoritative leaderboard position 1…500** (`masterTierFromMr(mr, {
leaderboardPosition })`). Ties share a position and skip the next ones (observed 2026-10-19:
  eight rows at #497 / 2196 MR, then #505 / 2195 MR; there is no #500), so neither a row index, "the
  500th row" nor `position === 500` is ever used.
- **Own position (per character):** `play.json` `league_info.master_rating_ranking`, normalized in
  `@sf6/capcom-core` as `leaderboardPosition` (MR only, positive integer, else null). Persisted in
  `player_character_rating.master_rating_ranking` in the SAME upsert / `observed_at` guard as the MR:
  never new MR + old position; a later profile without it clears it. Not in session baselines.
  The live state exposes it only when the character's current rating IS that observation (same
  MR) and never for an ended session, so `resolveDisplayRank` can show "Legend" for current data
  while frozen history is never relabelled.
- **Legend cutoff (global, contextual):** derived ONLY in the Companion from
  `ranking/master.json?page=N&season_type=1` (current phase) with the existing `_next/data`
  machinery. Pure, tie-safe boundary (`capcom-core/legend.ts`): proven only when a transition from
  ≤ 500 to > 500 is observed inside one page or across two consecutive pages; cutoff = minimum MR
  of the Legend rows at that boundary. Bounded search: start on the page that should hold #500
  (20 rows/page observed; corrected once from the real page size), step ±1, at most 5 pages,
  otherwise unavailable — never guessed. `master_league` is diagnostic only. Competition-ranking
  check at the boundary: when the last Legend tie group's start is observed, the jump to the next
  position must equal the group size (493×4 → 497, 497×8 → 505); otherwise rows are missing
  (truncated page) and nothing is trusted. A group missing at the very start of the observed
  window is not detectable from positions alone.
- **Cadence:** only for a profile with an MR ≥ 1800 character that is not already Legend, at most
  every 15 min (attempts included), never on the 30 s battlelog beat, never coupled to a session.
- **Transport / storage:** additive optional `legend` object in the sync (four numbers; strict).
  Stored on the owner's `sf6_player` (`legend_cutoff_mr`, `legend_cutoff_observed_at`,
  `legend_last_position`, `legend_first_non_legend_position`, `legend_first_non_legend_mr`) at
  SERVER acceptance time; an earlier acceptance never overwrites a later one. Per player on
  purpose (no singleton, scheduler, worker or cross-account dependency); each relevant Companion
  refreshes its own copy infrequently. No history table.
- **Freshness** (one module, `capcom-core/legend.ts`): fresh while age ≤ 30 min (inclusive), stale
  after. Decided in the domain projection with an injected clock. The renderer's clock runs on
  the SERVER timeline (`generatedAt` + time elapsed since the snapshot arrived, so the OBS
  machine's clock never matters) and is re-evaluated exactly at the edges of the cutoff's fresh
  window (`legendCutoffFreshWindow`): a source left open with no new snapshot drops a stale cutoff
  the moment it expires (pre-merge fix: a minute-rounded tick lagged up to ~2 min). Elapsed time is
  monotonic (`performance.now()`) and a timer that fires before its edge re-arms (5.4C QA fix: a
  wall clock adjusted backwards by ≥ 1 ms during the wait — NTP / VM time sync — left a stale
  cutoff on screen until the next snapshot). Stale /
  missing ⇒ the 5.4B Ultimate Master terminal ("Legend · Top 500 required"), never a numeric
  cutoff. Authoritative Legend never depends on the cutoff.
- **Rank Progress states (MR):** below 1800 unchanged. ≥ 1800 and not Legend: `legend-chase` (bar
  1800 → cutoff, "N MR to current cutoff", never "to Legend") when MR < fresh cutoff;
  `legend-boundary` (no bar, "Current Legend cutoff X MR · Top 500 required") when MR ≥ fresh
  cutoff — reaching the number never makes anyone Legend; `ultimate-master` without a fresh
  cutoff. Authoritative position ≤ 500 ⇒ terminal `legend` (#position, no bar). LP unchanged.
- **Failure isolation:** a ranking failure never fails the Companion sync (profile and matches
  are still sent). A ranking login refusal (401 / 403 app page) right after `play.json` succeeded
  with the same session is ranking-specific: ranking-only backoff of 1 h, Buckler keeps working.
  A WAF block (403 without `__NEXT_DATA__`) or 429 is a site / IP-level signal: the usual 10 min
  Buckler pause (after this cycle's data is reported) plus the 1 h ranking backoff, so even a
  persistent ranking-only refusal costs at most one pause per hour. Other failures (5xx, invalid,
  404 after the buildId retry): the 15 min attempt throttle (persisted before the tracker call,
  so restarts and tracker outages never cause extra lookups).
- **Ordering caveat (pre-existing, not specific to 5.4C):** profile and cutoff writes are ordered
  by server ACCEPTANCE time, as the MR always was; a request delayed in flight by seconds from a
  second paired browser can overwrite data observed seconds later. The position always moves
  with its own MR, and client timestamps never affect ordering or freshness.
- **Query impact:** none. `buildPlayerLiveState` already reads the player row (`findPlayerById`)
  and the character rows (`listPlayerCharacters`); the new columns ride on them. No new route,
  channel or polling; pool unchanged (`max: 5`).
- **Privacy:** SST stores the tracked user's own per-character position and a derived cutoff
  reference. It never stores or receives leaderboard rows, other players' names / CFNs / clubs,
  or raw ranking pages.
- **Migration** `0011_legend_reference`: additive nullable columns only, no backfill.
- **Rollout** (production migrations are explicit, never run by the Render build):
  1. `DATABASE_URL=<admin url> pnpm db:migrate` (0011; table-level grants of `sf6_app` already
     cover new columns); 2. deploy web (+ worker) from `main`; 3. verify a 0.3.0 Companion still
     syncs (`companion_sync` logs, `legend: "absent"`) and Session / Rank Progress overlays render;
  2. bump the Companion to 0.4.0 and run the release workflow; 5. set
     `COMPANION_LATEST_VERSION=0.4.0`; 6. with an Ultimate Master account, confirm
     `legend: "reported"` in the logs, `sf6_player.legend_cutoff_*` set and the OBS chase.
- **Rollback:** code can be reverted with the columns in place (old code ignores them; old
  Companions keep syncing). Companions ≥ the Legend release must not talk to an older server
  (strict sync root rejects `legend`): roll the Companion back first, or keep the server.

## 9. Security

- Zod validation on every input: server actions, provider output, overlay config and env.
- Authorization: every mutation resolves the player from the authenticated user. An overlay or
  session id from the client is always checked with `… AND player.user_id = $user` (IDOR).
- CSRF: server actions and better-auth enforce Origin checks; there are no cookie-authenticated GET
  mutations.
- Rate limits (in-memory per instance): CFN lookup, overlay state/stream per IP, and dev tools.
  better-auth limits auth endpoints.
- Secrets stay server-side only (no `NEXT_PUBLIC_` secrets). Logs redact keys that look like
  `token|secret|password|cookie|authorization`.
- Dev endpoints (mock matches, outage simulation) exist only when `NODE_ENV !== "production"`
  **and** `ENABLE_DEV_TOOLS=true` **and** `SF6_PROVIDER=mock`.

### Privacy: data kept from CFN

The player's CFN id, display name, main character, rank, LP and MR. For each match: id, timestamp,
mode, result, both characters, the player's control type and rating before/after, and the
opponent's display name and rank. Opponent CFN ids and raw payloads are **not** stored. Analytics
and the review report never expose opponent names (opponent character only).

## 9a. Visual system (dashboard + overlays)

- **Dashboard tokens** live in `src/app/(app)/globals.css` (`@theme`).
  - Navy surfaces (`bg`, `surface-0…3`), lines, text (`text`, `muted`, `faint`) and accents:
    `cyan` for selection/focus, `magenta`/`accent` for the primary action, `heading`, `blue`,
    `violet`.
  - Status colors `win`, `loss`, `warn`; motion `--ease-snap`; breakpoint `hud` (1200px).
- **Component classes:**
  - `.hud-panel`: notched panel with a clipped frame.
  - `.hud-heading`: section header with a rule.
  - `.hud-label`, `.hud-tag` (parallelogram), `.btn-*` (notched buttons with a wipe on hover).
  - `.hud-tab`: underline tabs.
  - `.hud-row`: selectable row with a cyan edge and a wipe.
  - `.live-dot`, `.ratio-bar`, and `.num-change-*` (number-update feedback).
- **Fonts:** Barlow Condensed for display and numerals, Barlow for body (OFL, via `next/font`).
- **Overlays** have their own CEF-safe CSS (`components/overlay/overlay.css`). They are composed as
  continuous HUD graphics, not per-stat boxes: Minimal (lower-third), Competitive (scoreboard) and
  Street (diagonal blocks, cyan/magenta, halftone).
- **Not color alone:** up/down is always an arrow glyph plus a sign; results always carry a
  letter (W/L, V/D).

- **next-intl without i18n routing.** `src/i18n/request.ts` resolves the locale per request:
  account (`auth_user.locale`) → `NEXT_LOCALE` cookie → `es`.
- Each overlay stores its own `config.locale`.
  - `OverlayView` wraps itself in a `NextIntlClientProvider` for that locale, using the small
    overlay catalogs, so OBS and the dashboard previews render in the overlay's language.
  - A language change is an ordinary config save: `overlay` event → SSE → full state. Language is
    presentation-only. It never touches the Session Engine, tracker, ingestion or tokens, and
    integration tests assert exactly that.
- Formatters in `src/domain/format.ts` take a locale and use `Intl`.

(not implemented)

- **Custom CSS:** store it in `overlay.config.customCss`. Sanitize it server-side: reject `<`,
  `@import`, `url(` except `data:` fonts, `expression(` and `behavior`. Scope it under
  `.sf6-overlay`, render it via a `<style>` text node and add a CSP `style-src` for overlay routes.
  It stays low-risk because the overlay page holds no secrets and is not same-session with the
  dashboard cookies.
- **Stats:** per-character, matchup and MR-graph stats are new pure functions over
  `SessionMatch[]` (characters, opponents and `ratingAfter` are already stored).
- **Integrations** (Twitch, StreamElements, Discord): subscribe to the same `sf6_events` bus.
- **Pause:** add `paused` status and a `session_pause` table of intervals, then extend
  `isMatchInSession`.

## 11. Verified behaviour (manual E2E, production build)

- Full flow: signup, CFN lookup (unknown id rejected), session start, overlay, mock match, overlay
  update without reload, refresh keeps the score, end session, recap.
- Two workers running at once: each player is polled once per interval, and the lease hands over
  between workers.
- Web server killed mid-stream: the overlay keeps the last state, reconnects, and resyncs matches
  played during the downtime.
- Every theme, with all fields enabled, fits sizes from 300×300 to 1920×300 without overflow.

## 12. Deployment modes

The tracking scheduler is one class, `TrackerRuntime` (`src/server/tracking/worker-runtime.ts`):
tick → claim leases → poll → ingest, error backoff, periodic maintenance, idempotent `stop()`
(stop claiming, wait for in-flight polls, `releaseAllLeases`). It never closes the DB pool and
never calls `process.exit`; its host process does. `TRACKER_RUNTIME_MODE` picks the host. It is
explicit and never derived from `NODE_ENV`.

### A. Embedded (`TRACKER_RUNTIME_MODE=embedded`) — closed beta / low traffic

One web service runs Next.js **and** the scheduler (e.g. a single Render Free web service).

- **Start:** `src/instrumentation.ts` `register()` (Next runs it once per server instance, never
  during `next build`). It returns unless `NEXT_RUNTIME=nodejs`, not `phase-production-build`,
  and the mode is `embedded`; then it dynamically imports `embedded-boot.ts`. Importing any
  module starts nothing, and SSR never starts it.
- **One per process:** `startEmbeddedTracker` keeps the runtime in a
  `globalThis[Symbol.for("sf6.tracker.runtime")]` singleton (dev HMR / duplicate module copies
  reuse it). DB leases remain the cross-process guarantee. The standalone worker **refuses to
  start** in this mode (exit 1), so a misconfigured extra worker cannot double up. Locally use
  `pnpm dev:web` alone in embedded mode; `pnpm dev` (both) is for the default standalone mode.
- **Shutdown:** one `process.once` SIGTERM/SIGINT listener (registered inside the singleton
  guard) calls `runtime.stop()`. Next keeps its own handler: it closes the HTTP server, then
  `process.exit(143)`. That exit can come before our lease release finishes (measured: when the
  server is idle it does). Nothing is corrupted (ingestion is transactional, and Postgres rolls
  back an interrupted transaction), and the leases expire after `TRACKER_LEASE_MS` (60 s). Then
  the next instance takes the players over.
- **Sleeping host:** Render Free spins a web service down after 15 min without **inbound**
  traffic, and an open SSE stream does not count. **While it sleeps nothing is processed.** On
  wake-up (cold start, ~1 min behind Render's loading page), polling resumes and the tracker
  catches up from the companion's latest snapshot. Inbound traffic during a session comes from:
  - the companion extension: `/api/companion/state` every ~30 s plus syncs, while its browser is
    open;
  - the dashboard **session heartbeat**: `POST /api/session/heartbeat` every 4.5 min, only while
    a session is active.

  This is legitimate traffic from a user who is actively using the service.

- **Heartbeat contract:**
  - Same-origin only (403 otherwise) and authenticated (401).
  - Rate limited per user: 6/min through the shared limiter (429).
  - 204 if the account has an ACTIVE session, 409 `{"error":"no_active_session"}` otherwise.
  - Read-only: one indexed select scoped by the account's user id. No session, match or stats
    writes and no provider/Capcom calls. The only write is the user's rate-limit bucket row,
    upserted and purged.
  - The client (`src/lib/session-heartbeat.ts`) keeps a single interval per dashboard. It stops on
    session end, unmount or 409, and fails silently.
- **OBS overlay:** no heartbeat on purpose. It would be an unauthenticated public keepalive (token
  in the URL), and the companion and dashboard already cover an active session. When SSE drops,
  the overlay keeps its last state, reconnects or falls back to polling, and resyncs.
- **Cold start UX:** no extra work. Render serves its own loading page; SSE clients reconnect, and
  the companion retries on its next alarm.

### B. Split (default, `standalone`) — production scaling

- Web service: `pnpm run start`.
- Background worker: `pnpm run start:worker` (`dist/worker.mjs`), one or more replicas.

The web never runs the scheduler. Scale web and workers independently, with no sleep and graceful
worker shutdown (`closeDb` + exit after lease release). **Recommended once beyond a small closed
beta.**

### Moving between modes

Both modes coordinate through the same DB leases, so a switch is safe in either order: an
overlap polls nothing twice (`FOR UPDATE SKIP LOCKED`, idempotent ingestion), and a gap lasts at
most one lease expiry. To go from A to B, deploy the worker with `TRACKER_RUNTIME_MODE=standalone`
(or unset) and change the web to standalone too. No migration is needed.
