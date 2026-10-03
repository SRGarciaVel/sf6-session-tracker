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
pnpm test        # unit + integration (integration needs TEST_DATABASE_URL)
pnpm test:e2e    # Playwright, against the dev stack (needs `pnpm db:seed`; starts `pnpm dev` if not running)
```

- `src/domain/**`: the Session Engine.
  - Global W/L, win rate, duplicates, out-of-order matches, membership (IDs, grace, baseline).
  - **Per-character progress:** LP and MR deltas, Diamond together with Master, never LP − MR,
    never one character minus another, characters outside the baseline (with and without
    `ratingBefore`), phase mismatch, current-rating priority, active character.
- `src/server/**`: resilient provider, the **contract checker** (ERROR/WARNING/PASS), rate
  limiting, tokens, log redaction.
- `src/components/overlay/**`: overlay ES/EN rendering, active or pinned character, no fabricated
  delta.
- `tests/integration/**` (Postgres):
  - The tracking pipeline, leases, outages, IDOR, i18n.
  - **Per-character flows:** baselines for every character at start, A.K.I. → Kimberly, overlay
    pinning, frozen finals and history, legacy sessions, guarded snapshots.
- `e2e/multi-character.spec.ts`: A.K.I. win, then switch to Kimberly and win.
  - Global 2W, separate deltas, and the overlay follows Kimberly.
  - Refreshing the overlay keeps the state.

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
nothing else. **Ratings belong to characters**:

```ts
type NormalizedPlayerProfile = {
  cfnUserId: string;
  displayName: string;
  favoriteCharacterKey?: string | null;
  characters: Array<{
    characterKey: string; // stable slug: "aki", "kimberly", "m-bison" (not the localized name)
    characterName: string;
    rank: string | null; // "Diamond 2", "Master"
    rankTier: string | null; // "diamond-2", "master"
    ratingSystem: "lp" | "mr" | null; // DECLARED by the provider; never guessed from the label
    leaguePoints: number | null;
    masterRate: number | null;
    phase?: number | null;
  }>;
};

type NormalizedSF6Match = {
  externalMatchId: string; // stable unique id (replay/battle id), never a timestamp
  playedAt: Date; // absolute instant (UTC)
  mode: "ranked" | "casual" | "battle_hub" | "custom_room" | "unknown";
  result: "win" | "loss" | "draw"; // from the tracked player's perspective
  characterKey: string; // REQUIRED
  characterName: string;
  opponent: {
    name: string | null;
    characterKey?: string | null;
    characterName?: string | null;
    rank?: string | null;
  };
  ratingBefore?: { system: "lp" | "mr"; value: number; rank?; rankTier?; phase? } | null;
  ratingAfter?: { system: "lp" | "mr"; value: number; rank?; rankTier?; phase? } | null;
};
```

`getSF6DataProvider()` wraps the selected provider in `ResilientProvider`, which adds a timeout,
single-flight, a short profile cache and Zod validation (invalid matches are dropped and logged).
From there the data flows **FETCH → NORMALIZE → VALIDATE → DEDUPLICATE → PERSIST → UPDATE SESSION
→ PUBLISH**.

## How to replace `MockSF6DataProvider`

1. Implement the two methods in **`src/server/sf6/providers/capcom.ts`**. Its header lists exactly
   which CFN fields map to which contract fields.
2. Keep credentials in server env vars and never log them. Set `SF6_PROVIDER=capcom`.
3. Run **`pnpm provider:check <cfnId>`** (for example `1733837998`). It calls the provider _raw_
   (without the wrapper that silently drops bad entries) and prints:
   - PROFILE, CHARACTERS (key, name, rank, tier, system, LP, MR, phase), and MATCHES (id, time,
     mode, result, character, opponent, rating before and after);
   - findings classified as **ERROR / WARNING / PASS**:
     - **ERROR:** contract violations, missing `characterKey`, `cfnUserId` mismatch.
     - **WARNING:** duplicate keys or IDs, incoherent MR+LP, future timestamps, `unknown` mode,
       match characters missing from the profile, unordered pages, no `ratingAfter`.
   - The exit code is 1 only when there are errors.
4. Compare the output against CFN using the checklist in `docs/audit/2026-10-03-technical-audit.md`
   §2.4.

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

## Internationalization (es / en)

Built with **next-intl**. The locale is not part of the URL, so overlay URLs never change.

- **Languages:** Spanish (`es`, the default) and English (`en`).
- **Catalogs:**
  - `src/i18n/messages/{es,en}.json` holds the dashboard, auth and onboarding strings.
  - `src/i18n/messages/overlay.{es,en}.json` holds the OBS overlay strings. They are kept tiny so
    every language ships with the overlay client.
  - Missing keys fall back to English. A test enforces identical key sets.
- **User language:** chosen with the ES | EN selector in the navbar and auth pages.
  - It is stored in a 1-year `NEXT_LOCALE` cookie and, when signed in, in `auth_user.locale`.
  - Resolution order: account → cookie → `es`.
  - There is no browser-language detection, so an explicit choice is never overridden.
- **Overlay language:** `overlay.config.locale` is independent from the dashboard language.
  - New overlays inherit the user's language.
  - Changing it in the builder updates the open Browser Source live through the existing realtime
    channel. Token, session, stats and tracker are untouched.
- **Formatting:** numbers, percentages, dates and relative times use `Intl` with the active locale
  (`66,7 %` · `18.430` in Spanish; `66.7%` · `18,430` in English).
- **Not translated:** official terms (Street Fighter 6, CFN, MR, LP, Ranked, OBS) and rank names
  as reported by CFN.
- **Adding a string:** add the key to both catalogs and use `useTranslations` (client) or
  `getTranslations` (server).

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
