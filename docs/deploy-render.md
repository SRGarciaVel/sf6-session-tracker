# Deploying on Render

Two supported shapes (details and trade-offs: [architecture.md §12](architecture.md#12-deployment-modes)).
Security requirements (DB role, TLS, Supabase lockdown, secrets) are in
[security-audit.md §7](security-audit.md#7-requisitos-de-producción-vercel--render--supabase).

## A. Closed beta: one Free web service (embedded tracker)

| Setting       | Value                                              |
| ------------- | -------------------------------------------------- |
| Service type  | Web Service (Node 22)                              |
| Build command | `pnpm install --frozen-lockfile && pnpm run build` |
| Start command | `pnpm run start`                                   |
| Health check  | `/api/health`                                      |

Environment:

```
NODE_ENV=production
TRACKER_RUNTIME_MODE=embedded
SF6_PROVIDER=companion
RATE_LIMIT_STORE=postgres
DATABASE_URL=<runtime role, direct/session connection, sslmode=require>
APP_URL=https://sf6-session-tracker-web.onrender.com
BETTER_AUTH_SECRET=<openssl rand -base64 32>
TRUST_PROXY=true
```

Do **not** also create a Background Worker in this mode (it refuses to start with
`TRACKER_RUNTIME_MODE=embedded`).

What to expect:

- **For a closed beta / low traffic only.** One process serves HTTP, SSE and the tracker.
- **Cold starts happen.** After 15 min without inbound HTTP traffic Render spins the service
  down. The next visit waits about 1 min on Render's loading page.
- **Nothing is processed while the service sleeps.** Tracking resumes on wake-up from the
  companion's latest data.
- **During an active session the clients send legitimate periodic traffic:**
  - the companion extension (state check every ~30 s while its browser is open);
  - the dashboard heartbeat (`POST /api/session/heartbeat` every 4.5 min, only while a session is
    active).

  An open overlay alone (SSE) does not keep the service awake.

- **Free instance hours:** while the companion's browser is open the service stays awake. One
  service fits Render Free's monthly 750 h.
- **Restarts and deploys:** leases not released before Next exits expire after
  `TRACKER_LEASE_MS` (60 s), then tracking continues.

## B. Production scaling: split web + worker

| Service           | Start command           | `TRACKER_RUNTIME_MODE`  |
| ----------------- | ----------------------- | ----------------------- |
| Web Service       | `pnpm run start`        | `standalone` (or unset) |
| Background Worker | `pnpm run start:worker` | `standalone` (or unset) |

Both use the same build command and the rest of the env above. Workers can run several replicas.
Recommended beyond the closed beta: no sleep, independent scaling, and the worker's shutdown
always releases its leases.

**Switching A → B** needs no migration: deploy the worker, then set the web to standalone. Leases
make any overlap or gap safe (§12 of the architecture doc).
