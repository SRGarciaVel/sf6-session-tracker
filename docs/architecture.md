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
- **Fit-to-box** shrinks the root font-size until the content fits. A convergence guard stops it
  from ping-ponging at very small canvases, where borders and glyphs snap to whole pixels (after
  a few adjustments in one frame, only shrinking is allowed).
- **Creator presets** (`creator_overlay_preset`, [creator-presets.md](creator-presets.md)) store
  appearance only and are applied through the normal save rules.
- **Custom CSS is deferred.** See §10 for how to add it safely. Creator customization, Creator
  themes and presets deliberately contain none.

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
mode, result, both characters and the opponent's display name. Opponent CFN ids and raw payloads
are **not** stored.

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
