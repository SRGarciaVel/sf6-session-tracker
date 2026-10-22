# Phase 5.6C — Fight Session RECAP (gated)

`/dashboard/sessions/[id]` shows the Fight Session recap to **allowlisted testers only**, through
the same server gate as the dashboard (`FIGHT_SESSION_UI_USERS`, see
[docs/fight-session-rollout.md](../../docs/fight-session-rollout.md)). Everyone else, and testers
using `?ui=classic`, get the unchanged classic recap. The ownership check (`getOwnedSession`)
runs before either view.

## Data sources (all authoritative, nothing computed in the view)

| Shown                          | Source                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ended / in progress            | `summarizeSessionRow(session).status` and `endedAt`. A session that is still active by URL shows «Sesión en curso», never «terminada».                                                                                                            |
| Start, end, duration           | `game_session.started_at` / `ended_at` (`formatDuration`)                                                                                                                                                                                         |
| Matches, W, L, win rate, draws | The engine summary of this session. The win rate shows «—» with nothing decided; draws are counted and explained.                                                                                                                                 |
| Session change (results bar)   | `ratingFromCharacter(latest character, "ended")`: frozen baseline → frozen final, the engine's session delta. If unknown: «MR/LP final no disponible».                                                                                            |
| Characters                     | One `RatingSummary` per character **played** in the session, latest first, each with its own system. Values are never combined. A 0-match session reports no rating change.                                                                       |
| Round strip and match list     | The session's persisted counted matches (`loadRecentMatches`, the same projection as LIVE), in the engine's order and dedupe, numbered by session position. The strip is bounded to the last 30; the list shows the latest 20 and folds the rest. |

Not shown, because it is not stored: per-match MR/LP, an MR chart, replays or round scores.
Legacy-model sessions say that rating changes are not available.

## Navigation

- **Prepare another session:** `/dashboard#session` (the Fight Session PREPARE stage).
- **Back to dashboard.**
- **Manage overlays:** `/dashboard#overlays`.
- **View classic recap:** `?ui=classic`.

The end-session flow still redirects to `?ended=1`, which adds «✓ Sesión finalizada y guardada»
(`role="status"`).

## Verification

- **E2E** (`e2e/recap.e2e.mts`, phases setup, run, rollback and cleanup, as in B2 and B3):
  - real HTTP, local Postgres, the real Companion sync, SSE and the server actions;
  - flow: PREPARE → START → END (0 matches) → recap; then PREPARE → START → LIVE → 3 matches
    with 2 characters (Ryu MR, Jamie LP) → END → recap → «Preparar otra sesión» → PREPARE;
  - old session by URL;
  - `?ui=classic`;
  - a non-owner gets not-found and no data leaks;
  - an ineligible owner cannot force the view with a query, cookie or header;
  - overlay tokens unchanged;
  - no SSE on the recap page;
  - 6 viewports and EN, 200 % text, reduced motion, keyboard.

  **Result:** 30/30, and the rollback passes.

- **Gallery** (`gallery.mts`): winning, losing, rating unavailable and empty recaps, rendered by
  the real component in the B1 showcase build. 40 checks: no collisions, no overflow, at
  6 viewports, ES/EN and 200 % text.
- **Unit:** 11 SSR tests of the recap. The `SessionResults` collision fix from PR #69 is covered
  by its tests and by the bounding-box checks above.

**Note:** a non-owner gets HTTP 200 with the not-found page. Because of `loading.tsx` the response
is already streaming when `notFound()` runs. This is existing Next.js behaviour, identical for the
classic recap.

## Not in this phase

- Sharing.
- Rating-observation history.
- Replay analysis: see [docs/research/sf6-scouter-feasibility.md](../../docs/research/sf6-scouter-feasibility.md).
