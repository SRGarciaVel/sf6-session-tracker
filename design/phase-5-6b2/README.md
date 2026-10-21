# Phase 5.6B2 — Fight Session: Prepare & session control (gated)

This phase puts the first real Fight Session experience into the authenticated dashboard. It is
**off by default**: only accounts on the server allowlist `FIGHT_SESSION_UI_USERS` see it. See
[docs/fight-session-rollout.md](../../docs/fight-session-rollout.md) for how to enable it, how to
roll it back and why the gate is safe.

## What a tester sees

- **PREPARE:** when no session is active or the last one ended.
  - **Status strip:** session state, Companion link, Buckler data, last sync, overlays and OBS
    sources. A live-link warning appears only while the dashboard stream is down.
  - **Stage:** «Listo para jugar» or «No listo» from the real Companion readiness, plus the
    character line (character, rank, latest MR/LP).
  - **Start CTA:** one primary «Iniciar sesión de juego» button, wired to `startSessionAction`
    unchanged. While blocked it shows the exact next step and a link to the Companion panel.
  - **Tracking line:** what will be tracked.
  - **Last session:** the 5-cell results bar of the last session, with a link to its recap.
- **ACTIVE (intermediate):**
  - a Fight Session stage with «Sesión en juego», or «Sin datos recientes» while tracking is
    degraded;
  - the inline two-step «Finalizar sesión» (`endSessionAction` unchanged; Esc cancels);
  - the **classic statistics panel** in statistics-only mode, with no «Iniciar nueva sesión»
    button. The full LIVE scoreboard is B3.
- **After ending:** the same redirect as classic, to `/dashboard/sessions/<id>?ended=1`, whose
  «Preparar nueva sesión» link returns to PREPARE.
- **Overlays:** the classic overlay console, unchanged:
  - previews, Copy URL, preview and configure links;
  - creating overlays, with the same entitlement checks;
  - OBS guide, Companion pairing and Creator Beta.
- **Mobile:**
  - the start action sits in a fixed bottom bar, with reserved space and safe-area padding;
  - an «Ir a tus overlays» jump in the strip;
  - the console comes before the history.

## Verification

The E2E needs a local production build, the local Postgres and fictitious `@test.local`
accounts. The script refuses non-local hosts.

```bash
pnpm build
```

The server must be restarted between phases with a different `FIGHT_SESSION_UI_USERS`:

1. **setup:** start without the variable, then run:
   `E2E_STATE=/tmp/fs-e2e.json pnpm exec tsx design/phase-5-6b2/e2e/fight-dashboard.e2e.mts setup`
   (it prints account A's id).
2. **run:** restart with `FIGHT_SESSION_UI_USERS=<A id>`, then run the same command with the
   `run` phase. It reports 37 checks.
3. **rollback:** restart without the variable, then run the `rollback` phase.
4. **cleanup:** run the `cleanup` phase to delete both accounts.

The server command is:

```bash
CREATOR_KEY_PEPPER=$(openssl rand -hex 32) SF6_PROVIDER=companion APP_URL=http://localhost:3171 PORT=3171 pnpm start
```

Results are in `screenshots/evidence/e2e-run.json` and `e2e-rollback.json`, with curated
screenshots next to them. The B1 showcase vs B2 dashboard vs classic comparison is
`compare--b1-showcase-vs-b2-dashboard-vs-classic.jpg`.

## Deferred (needs data or later phases)

- **B3, LIVE scoreboard and activity:** `LastMatch` and `ActivityList` need opponent and time on
  the client. Today the live state carries only `recentResults`, so B3 has to add a read-only
  `recentMatches` projection.
- **5.6C, MR journey and per-match MR:** these need a stored observation log, which means a
  migration. They are not shown.
