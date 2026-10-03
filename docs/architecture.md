# SF6 Session Tracker — Architecture

Practical reference for how the system is put together and why. Keep it short; update it when a
decision changes.

## 1. Shape of the system

```
 Capcom / CFN  (your extractor)
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

Two deployables share one codebase: **web** (`next start`) and **worker** (`node dist/worker.mjs`).
There's no Redis, queue or microservice. Postgres provides the leases (row locks) and the event bus
(`LISTEN/NOTIFY`).

## 2. Key decisions

| #   | Decision                                  | Why                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Drizzle ORM** (not Prisma)              | SQL-first and typed, with no query-engine binary. It runs the same in Next and in the worker. Partial unique indexes and `ON CONFLICT DO NOTHING` are first-class. Migrations are plain SQL in `drizzle/`.                                                                                                                                  |
| 2   | **SSE** (not WebSocket)                   | Traffic is server→client only. SSE runs over plain HTTP, `EventSource` auto-reconnects, and it works in OBS CEF without libraries. Every SSE message carries the **full authoritative state**, never a delta.                                                                                                                               |
| 3   | **Polling** in a worker, adaptive         | 20 s ± jitter while a session is active, exponential backoff on errors (30 → 60 → 120 → 300 s cap), and `Retry-After` is honoured. All values come from env (`src/server/env.ts`). The pure policy lives in `src/domain/tracking/polling.ts`.                                                                                               |
| 4   | **Caching**                               | `ResilientProvider` wraps every provider with a timeout, single-flight (concurrent identical calls share one upstream request) and a short TTL cache for **profile lookups only**. Match lists are never cached because they are the freshness-critical data. Overlays and dashboards read Postgres, so N overlays never fan out to Capcom. |
| 5   | **better-auth** (email + password)        | Maintained, built for Drizzle and Next, sessions stored in DB, httpOnly cookies, origin checks and rate limiting built in. Social logins (Twitch/Discord) can be added as providers later.                                                                                                                                                  |
| 6   | **Hosting: Railway** (or Fly.io / Render) | Needs (a) long-lived SSE connections, (b) a process that runs without an HTTP request, and (c) one persistent `LISTEN` connection. Pure Vercel fits none of those well: functions have max durations and a `setInterval` dies with the instance. Deploy a `web` service, a `worker` service and managed Postgres.                           |
| 7   | **Background worker**                     | `src/worker/index.ts`: a 1 s scheduler tick claims _due_ players, polls them with bounded concurrency and schedules the next poll in the DB. Shuts down gracefully on SIGTERM (stops claiming, finishes in-flight work, releases leases).                                                                                                   |
| 8   | **No duplicate trackers**                 | Each player row holds a **lease**: `lease_owner` and `lease_expires_at`. Players are claimed with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`. If a worker dies, the lease expires and another worker continues. Even if two workers overlap, ingestion is idempotent (see §4), so stats stay correct.                         |
| 9   | **Persistent sessions**                   | The session baseline is written to Postgres when the session starts. Stats are **derived** from the session's matches by the pure Session Engine, so restarts of OBS, browsers, web or worker cannot lose or reset anything.                                                                                                                |
| 10  | **Overlay tokens**                        | 192-bit random `base64url` (32 chars) in `overlays.public_token`. It is unrelated to internal ids, so it can't be enumerated. The format is validated before any DB hit, endpoints are rate-limited per IP, and the token can be rotated from the dashboard.                                                                                |

## 3. Data model (`src/server/db/schema.ts`)

```
auth_user ─1:1─ sf6_player ─1:N─ game_session ─1:N─ match
                    │                 (baseline)      (unique player_id+external_match_id)
                    ├─1:N─ match  (pre-session matches have session_id = NULL)
                    └─1:N─ overlay ─1:N─ overlay_connection (presence, for "connections: 2")
```

- **sf6_player**: CFN id and the latest profile snapshot (`rank`, `league_points`, `master_rate`).
  It also stores tracker state: `next_poll_at`, `consecutive_failures`, `last_success_at`,
  `last_error`, `lease_owner`, `lease_expires_at`, `profile_refresh_until`.
- **game_session**: `status` (`active` | `ended`), `started_at`, `ended_at`, the baseline
  (`baseline_match_id`, `baseline_played_at`, `initial_rank/lp/mr`), final values set when it ends,
  and `filter` (jsonb, default `{ modes: ["ranked"] }`). A **partial unique index** allows only one
  active session per player.
- **match**: a normalized match, linked to the session it was counted in. Unique on
  `(player_id, external_match_id)`. W/L, win rate and streaks are **not stored**; they are derived.
- **overlay**: `public_token` and `config` (jsonb, validated by Zod, versioned). An overlay belongs
  to a player and outlives sessions. Themes are code-defined presets (`src/domain/overlay`), so they
  have no table.
- **mock_cfn_player / mock_cfn_match**: fake CFN data, used only by `MockSF6DataProvider`.

## 4. Match ingestion and exactly-once effect

```
FETCH (provider) → NORMALIZE (provider) → VALIDATE (zod) → DEDUPLICATE + PERSIST
→ UPDATE SESSION (session_id assigned on insert) → PUBLISH (pg_notify on commit)
```

- Each match is inserted with `ON CONFLICT (player_id, external_match_id) DO NOTHING RETURNING`.
  Only rows that are actually inserted can be assigned to a session.
- Session membership is decided **once**, at insert time, by the pure `isMatchInSession()`. It
  checks the mode filter, `played_at >= started_at - grace`, `played_at <= ended_at`, and that the
  match is not the baseline match.
- When a session starts, the recent matches are ingested first with `session_id = NULL`. Matches
  played before the session therefore become "known" and can never be counted later.
- Re-processing the same response 10× changes nothing. Out-of-order arrival doesn't matter either,
  because stats are recomputed from matches sorted by `played_at`.

## 5. Session Engine (`src/domain/session`)

These are pure functions with no IO, React or DB, and they are fully unit tested.

- `applyMatchToSession(state, match)` is idempotent (dedupe by id) and order-independent (sorted
  insert, then recompute).
- `computeSessionStats(matches)` returns W/L/D, total, win rate (`wins/(wins+losses)*100`, `0` for 0
  games), current win/loss streak, best win streak and recent form.
- `isMatchInSession(baseline, match)` decides membership (see §4).
- `buildRatingView(initial, current)` returns LP and MR deltas. The primary system is `mr` when the
  player has a Master Rate, otherwise `lp`. A promotion during the session keeps the LP delta.

Draws do not count toward win rate, and they reset both streaks.

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
- **Custom CSS is deferred.** See §10 for how to add it safely.

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

## 9b. Internationalization

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
