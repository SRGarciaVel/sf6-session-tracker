# SF6 Session Tracker

Automatic **Street Fighter 6** session stats for OBS. The streamer enters their CFN User ID, starts
a session and adds one Browser Source URL. Wins, losses, win rate, MR/LP delta, rank and streaks
then update on stream after every ranked match, with no hotkeys and no manual counters.

```
Login → CFN User ID → Start session → Copy overlay URL → OBS Browser Source → play
```

- **Server-authoritative sessions.** The baseline is stored in Postgres. Refreshing OBS, switching
  scenes, closing OBS or restarting the PC never resets the score.
- **One tracker per player**, independent of OBS. Ten open overlays still mean one CFN request per
  poll.
- **Exactly-once effect.** A match counts once, even if it is fetched 100 times or arrives out of
  order.
- **Live updates over SSE.** The overlay changes without reloading, and every message is the full
  authoritative state.
- **Three overlay themes** (Minimal, Competitive, Fighter) and a visual builder with live preview.
  The OBS URL stays stable when the design changes.

Architecture and design decisions are in **[docs/architecture.md](docs/architecture.md)**.

---

## Requirements

- Node.js **22.12+** (`.nvmrc`)
- pnpm **12** (`corepack enable pnpm`)
- PostgreSQL **15+** (Docker Compose file included)
- OBS Studio **31+** recommended (any recent Chromium-based Browser Source works)

## Installation

```bash
corepack enable pnpm
pnpm install
cp .env.example .env          # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d          # Postgres on localhost:5433 (+ sf6_tracker_test DB)
pnpm db:migrate
pnpm db:seed                  # optional demo data
pnpm dev                      # web (http://localhost:3000) + tracking worker
```

Seeded demo login: `demo@sf6.local` / `demo-password-123`.

## Environment variables

All variables are validated at startup by `src/server/env.ts`. Defaults are in `.env.example`.

| Variable                                             | Default                 | Purpose                                                                                                |
| ---------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                       | —                       | Postgres connection string (**required**)                                                              |
| `TEST_DATABASE_URL`                                  | —                       | Database for integration tests. They are skipped if unset.                                             |
| `APP_URL`                                            | `http://localhost:3000` | Public base URL, used for overlay URLs and auth origin checks                                          |
| `BETTER_AUTH_SECRET`                                 | —                       | ≥ 32 random chars (**required**, keep secret)                                                          |
| `TRUST_PROXY`                                        | `false`                 | Trust `X-Forwarded-For` for rate limiting. **Set `true` on Railway/Fly/Render.**                       |
| `SF6_PROVIDER`                                       | `mock`                  | `mock` or `capcom` (your extractor)                                                                    |
| `PROVIDER_TIMEOUT_MS`                                | `10000`                 | Per-request timeout for the provider                                                                   |
| `PROVIDER_CACHE_TTL_MS`                              | `5000`                  | Profile lookup cache (match lists are never cached)                                                    |
| `ENABLE_DEV_TOOLS`                                   | `false`                 | Mock-match tools in the dashboard. Only active when `NODE_ENV≠production` **and** `SF6_PROVIDER=mock`. |
| `TRACKER_POLL_INTERVAL_MS`                           | `20000`                 | Poll interval during an active session                                                                 |
| `TRACKER_POLL_JITTER_MS`                             | `3000`                  | ± random jitter per poll                                                                               |
| `TRACKER_BACKOFF_BASE_MS` / `TRACKER_BACKOFF_MAX_MS` | `30000` / `300000`      | Exponential backoff on provider errors                                                                 |
| `TRACKER_PROFILE_REFRESH_MS`                         | `300000`                | Profile (MR/LP/rank) refresh when no new matches                                                       |
| `TRACKER_LEASE_MS`                                   | `60000`                 | Worker lease. A crashed worker's players are taken over after this.                                    |
| `WORKER_TICK_MS` / `WORKER_CONCURRENCY`              | `1000` / `10`           | Scheduler tick and max parallel polls per worker                                                       |
| `SESSION_START_GRACE_SECONDS`                        | `0`                     | Count matches finished up to N s before "Start session"                                                |
| `LOG_LEVEL`                                          | `info`                  | `debug` · `info` · `warn` · `error`                                                                    |

Secrets are only read on the server. Nothing is exposed through `NEXT_PUBLIC_*`.

## Database setup

```bash
docker compose up -d       # or point DATABASE_URL at any Postgres
pnpm db:migrate            # applies SQL migrations in ./drizzle
pnpm db:generate           # after editing src/server/db/schema.ts → new migration
pnpm db:studio             # browse data
```

Key constraints:

- `match (player_id, external_match_id)` is unique and backs deduplication.
- A partial unique index on `game_session (player_id) WHERE status = 'active'` allows only one
  active session per player.

## Development

| Command                       | What it does                                                  |
| ----------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                    | Next.js dev server **and** tracking worker (auto-reload)      |
| `pnpm dev:web` / `dev:worker` | Run them separately                                           |
| `pnpm check`                  | typecheck + lint + tests                                      |
| `pnpm format`                 | Prettier                                                      |
| `pnpm build`                  | Production build: Next.js + worker bundle (`dist/worker.mjs`) |
| `pnpm provider:check <cfnId>` | Call the configured provider and validate its output          |

**Trying it without CFN.** With `SF6_PROVIDER=mock` and `ENABLE_DEV_TOOLS=true`, the dashboard
shows a **Dev tools** panel. It creates matches in a fake CFN: win, loss, casual (filtered), an
out-of-order late match, and a 60 s CFN outage. The worker detects them through the real pipeline,
and every open overlay updates without reloading. In mock mode any 6–12 digit CFN id exists, and
ids starting with `000` return "not found".

## Tests

```bash
pnpm test
```

- `src/domain/**`: Session Engine unit tests (0 matches, W/L, win rate, duplicates, out-of-order,
  baseline, MR/LP deltas, promotion, restart/new session), plus the polling policy and overlay
  config.
- `src/server/**`: the resilient provider (timeout, single-flight, validation), rate limiting,
  token format, log redaction.
- `tests/integration/**`: the full pipeline against Postgres (`TEST_DATABASE_URL`). It covers
  baseline exclusion, 10× re-ingestion, ranked filter, rating delta, CFN outage and backoff, worker
  lease exclusivity, end/restart sessions, the final fetch on end, and the one-active-session
  constraint.

## How `SF6DataProvider` works

```ts
// src/server/sf6/provider.ts
interface SF6DataProvider {
  readonly name: string;
  getPlayerProfile(
    cfnUserId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<NormalizedPlayerProfile>;
  getRecentMatches(
    cfnUserId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<NormalizedSF6Match[]>;
}
```

The provider is the **only** code that knows about Capcom. It fetches and normalizes data, and
nothing else: no stats, no sessions, no UI. Everything else consumes the normalized types in
`src/domain/sf6/types.ts`:

```ts
type NormalizedSF6Match = {
  externalMatchId: string; // stable unique id (replay/battle id), never a timestamp
  playedAt: Date;
  mode: "ranked" | "casual" | "battle_hub" | "custom_room" | "unknown";
  result: "win" | "loss" | "draw"; // from the tracked player's perspective
  playerCharacter: string | null;
  opponent: { name: string | null; character: string | null; rank?: string | null };
  ratingAfter?: { leaguePoints: number | null; masterRate: number | null } | null;
};
```

`getSF6DataProvider()` (`src/server/sf6/index.ts`) wraps the selected provider in
`ResilientProvider`. That adds a timeout, single-flight request dedupe, a short profile cache and
Zod validation of every returned object (invalid matches are dropped and logged). From there the
data flows **FETCH → NORMALIZE → VALIDATE → DEDUPLICATE → PERSIST → UPDATE SESSION → PUBLISH**
(`src/server/ingestion/ingest.ts`).

## How to replace `MockSF6DataProvider`

1. Implement the two methods in **`src/server/sf6/providers/capcom.ts`**. The file header lists
   the contract and the rules:
   - Resolve P1/P2 into the tracked player's perspective.
   - Use a stable, unique `externalMatchId`.
   - Map the battle type to `mode`.
   - Throw `SF6ProviderError` with code `not_found` (permanent), `rate_limited` (pass
     `retryAfterMs` if known), `unavailable` or `invalid_response`.
   - Pass `options.signal` to `fetch()`.
2. Put any credentials (cookies or tokens) in server env vars, read them in the provider, and
   never log them.
3. Set `SF6_PROVIDER=capcom`.
4. Verify it: `pnpm provider:check <yourCfnId>`. It prints the normalized profile and matches and
   warns about duplicate ids or future timestamps.
5. Run the app. Nothing else needs to change.

## How to configure OBS

1. In the dashboard, click **Copy OBS URL** (`https://your-domain/overlay/<token>`).
2. In OBS Studio, go to **Sources → + → Browser** and paste the URL.
3. Set the size from your preset: **Compact 600×120 · Standard 800×180 · Detailed 900×240**. Any
   other size works too, because the overlay scales and auto-fits.
4. Recommended: turn **off** "Shutdown source when not visible" and "Refresh browser when scene
   becomes active". This is optional: stats live on the server, so a refresh or scene change never
   resets them.

The background is fully transparent. Design changes saved in the builder apply live without
touching OBS. **Regenerate URL** in the builder invalidates a leaked URL immediately.

## Deployment

The app needs **long-lived SSE connections**, a **persistent background worker** and **one
persistent `LISTEN` connection** per web instance. A platform with persistent processes fits that
best.

### Recommended: Railway (Fly.io and Render work the same way)

Create one project with three parts:

| Service    | Build command                       | Start command          | Notes                                                     |
| ---------- | ----------------------------------- | ---------------------- | --------------------------------------------------------- |
| PostgreSQL | managed plugin                      | —                      | provides `DATABASE_URL`                                   |
| `web`      | `pnpm install && pnpm build`        | `pnpm start`           | pre-deploy: `pnpm db:migrate` · healthcheck `/api/health` |
| `worker`   | `pnpm install && pnpm build:worker` | `node dist/worker.mjs` | no public port; 1+ replicas are safe (DB leases)          |

Set on both services: `DATABASE_URL`, `APP_URL=https://<your-domain>`, `BETTER_AUTH_SECRET`,
`TRUST_PROXY=true`, `SF6_PROVIDER=capcom`, `NODE_ENV=production`. Keep `ENABLE_DEV_TOOLS` unset.

On Fly.io, use one app with two process groups:
`[processes] web = "pnpm start"`, `worker = "node dist/worker.mjs"`.

### Why not plain Vercel?

Serverless functions have a maximum duration, so SSE overlays would be cut and reconnect
constantly. A `setInterval` tracker dies with the instance, and there is no persistent `LISTEN`.
You could host the web app on Vercel and the worker elsewhere, but you would then need a different
fan-out mechanism (e.g. Redis pub/sub) for realtime. That adds infrastructure without a real
benefit for this product.

### Scaling notes

- **Web** scales horizontally. Each instance holds one `LISTEN` connection and fans out to its own
  SSE clients.
- **Worker** scales horizontally. Players are distributed through `FOR UPDATE SKIP LOCKED` leases.
- Rate limits are in-memory per instance. If you need global limits, swap in a Postgres- or
  Redis-backed limiter; the call sites use a single `rateLimit()` function.

## Project structure

```
src/
  domain/            pure logic, no IO: Session Engine, rating rules, polling policy, overlay config
  server/
    sf6/             SF6DataProvider, ResilientProvider, mock + Capcom providers
    ingestion/       validate → dedupe → persist → assign session → publish
    sessions/        start/end session, live snapshots, history
    tracking/        lease claiming + poll cycle (used by the worker)
    realtime/        pg LISTEN/NOTIFY events, SSE hub, SSE helper
    overlays/        overlay CRUD, public token lookup, presence
    auth/ db/ security/ dashboard/ env.ts logger.ts
  worker/            persistent tracking worker entrypoint
  components/overlay OverlayView (pure renderer, 3 themes), LiveOverlay (OBS client), CEF-safe CSS
  app/(app)/         landing, auth, onboarding, dashboard, overlay builder, session recap
  app/(overlay)/     transparent root layout + /overlay/[token]
  app/api/           auth, overlay state + SSE stream, dashboard stream, health
scripts/             migrate, seed, provider-check
tests/integration/   pipeline tests against Postgres
```

## Security & privacy

- Zod validation on every input boundary: actions, env, provider output, overlay config and
  realtime events.
- Every mutation re-resolves the player from the authenticated user, and overlay/session ids are
  ownership-checked (IDOR).
- Server actions and better-auth enforce Origin checks (CSRF).
- Overlay tokens are 192-bit random values, format-checked before any DB hit, rate-limited per IP
  and rotatable. Overlay responses send `no-store`, `noindex` and `Referrer-Policy: no-referrer`.
- Public overlay payloads contain display data only: no CFN id and no internal ids.
- Logs are structured JSON. Keys matching token/secret/password/cookie/authorization are redacted.
- **Data stored from CFN:** CFN id, display name, main character, rank, LP and MR. For each match:
  id, time, mode, result, both characters and the opponent's display name. Opponent CFN ids and raw
  payloads are not stored.

## Roadmap (architecture already prepared)

Per-character and matchup stats, MR graph, session sharing cards, Twitch / StreamElements /
Discord integrations, tournament mode, public profiles, session pause, and custom CSS (see
`docs/architecture.md` §10 for the safe approach).

## Known limitations (MVP)

- Detection latency is the poll interval (~20 s by default), bounded by how often CFN can be
  queried.
- No email verification or password reset yet. better-auth supports both once an email provider
  is configured.
- One CFN player per account.

---

Not affiliated with or endorsed by Capcom. Street Fighter is a trademark of Capcom Co., Ltd.
