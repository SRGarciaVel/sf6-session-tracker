# Fight Session dashboard: controlled rollout (Phase 5.6B2)

The Fight Session dashboard (Prepare + session controls, design/phase-5-6a + 5.6B1) is
**experimental and off by default**. Every account sees the classic dashboard unless the
server explicitly lists it.

## How it works

- **Allowlist:** `FIGHT_SESSION_UI_USERS` is a server environment variable holding `auth_user`
  ids, comma, space or newline separated. Empty or unset means nobody (the default).
- **Decision:** `src/server/features/fight-session.ts` (`decideDashboardUi`) decides on every
  dashboard request, on the server, for the authenticated user. No query parameter, cookie,
  local storage or header can add an account.
- **Opt-out:** the one honoured request input is a downgrade. `/dashboard?ui=classic` shows the
  classic dashboard to an allowlisted tester, for comparison or fallback.
- **Extra data for testers only:** for allowlisted accounts the dashboard state also carries
  `recentMatches`, a bounded, read-only list of the session's counted matches (5.6B3). The
  classic payload is unchanged.
- **What stays shared:** both dashboards use:
  - the same data;
  - the same live provider (one SSE stream);
  - the same `startSessionAction` / `endSessionAction`;
  - the same overlay console and Companion pairing panel.

  Only the presentation of the session area and the status line differ. Nothing is stored per
  UI mode.

Ids rather than emails: ids are opaque and not personal data. Never commit real ids; set them
only in the deployment environment.

## Enable it for a tester

1. Find the tester's `auth_user.id`, read-only:
   `select id from auth_user where email = '<their email>';`
2. Add it to `FIGHT_SESSION_UI_USERS` in the service's environment, comma-separated with any
   existing ids.
3. Restart the web service. The value is read at boot (`getEnv()` caches it).

## Roll back

- **One tester:** remove their id from `FIGHT_SESSION_UI_USERS` and restart. For a single
  visit, the tester can also use `/dashboard?ui=classic`.
- **Everyone:** clear `FIGHT_SESSION_UI_USERS` (or delete the variable) and restart.

Rollback needs:

- no code revert;
- no migration;
- no Companion update;
- no change to sessions, matches or ratings;
- no change to overlays: URLs and tokens are untouched.

## What the preview changes (and what it does not)

| Changes                                                                                                                                                           | Unchanged                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| PREPARE: Fight Session stage, readiness, single primary CTA, last-session summary                                                                                 | Session start/end server actions, validations, rate limits, errors |
| LIVE (5.6B3): versus scoreboard, per-character rating with labelled pending value, latest match, round strip, inline two-step End (no "start new session" button) | Session engine, ingestion, tracker, Companion, SSE                 |
| Status strip at the top replaces the classic fixed bottom status bar                                                                                              | Overlay console, previews, Copy URL, builder, entitlements         |
| Mobile: sticky start action; overlays console before the history; «Ir a tus overlays» jump                                                                        | Recap page `/dashboard/sessions/[id]`, history, analytics          |
