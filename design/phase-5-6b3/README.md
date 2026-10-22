# Phase 5.6B3 — Fight Session LIVE (gated)

The experimental Fight Session dashboard replaces its temporary classic statistics panel with
the approved LIVE view. The view is still **allowlist-only** (`FIGHT_SESSION_UI_USERS`; see
[docs/fight-session-rollout.md](../../docs/fight-session-rollout.md)). The classic dashboard is
unchanged and gets exactly the same payload as before.

## Where every LIVE value comes from

| Shown                            | Source (authoritative)                                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session state, duration          | `live.session.status` / `startedAt`, plus tracker state and Companion readiness (`sessionIndicatorStatus`). Duration needs the client clock.                                                                                                           |
| Companion / Buckler / last sync  | `assessCompanion(state.companion)`, `companion.matchesObservedAt`                                                                                                                                                                                      |
| OBS sources                      | `overlayConnections` (existing count)                                                                                                                                                                                                                  |
| V / D / win rate / games / draws | The engine's `summarizeSession` via `live.session` (`wins`, `losses`, `draws`, `totalGames`, `winRate`). The win rate shows «—» when nothing is decided.                                                                                               |
| Rating per character             | `live.session.characters[]`: the active character first (`pickRatingCharacter`), then the other characters played (max 2), each with its own system. Start = `initial` (when `baselineKnown`), now = `current`, change = the engine's session `delta`. |
| Pending rating                   | `heldRating` (Phase 5.5): the **last confirmed** value and its delta, labelled «{MR/LP} pendiente · último confirmado». It is used in an active session only, never in an ended one.                                                                   |
| Latest match, round strip        | **New read-only projection** `DashboardLiveState.recentMatches` (below). Older payloads without it fall back to `live.session.recentResults`, which carries the letters only; a «last match not available» note is shown.                              |

Not shown, because it is not stored: per-match MR/LP, the MR journey, ranking positions in LIVE.
The match time is Buckler's replay upload time (`played_at`), shown to the minute.

## The `recentMatches` projection

- **What it is:** `loadRecentMatches` (`src/server/dashboard/state.ts`) reads the counted matches of
  the shown session (`match.session_id`, scoped by `player_id`) with one indexed query
  (`match_session_idx`) and minimal columns.
- **Ordering and dedupe:** it applies the engine's dedupe and order
  (`recentSessionMatches` → `normalizeMatchList`). The list is **capped to the summary's
  `totalGames`**, so it never shows a match that the scoreboard does not count yet, and is
  **bounded** to the latest 10 (`RECENT_FORM_LENGTH`), each numbered by its position in the
  session.
- **Fields:** `id` (internal uuid), `n`, `result`, `characterName`, `opponentCharacter`,
  `opponentName` and `playedAt`. There are no external replay ids, ratings or raw Buckler data.
  The opponent name is the same one the authenticated recap page already shows.
- **Who gets it:** only Fight Session viewers. The page and `/api/me/stream` ask the same server
  gate. The classic payload has no extra field and needs no extra query. The public overlay
  payload is untouched.
- **Delivery:** the existing SSE. Each snapshot is a full state, so W/L, the last match and the
  strip always change together. Older snapshots are dropped (`generatedAt`).

## Jamie LP discrepancy (investigated)

**Cause:** after a match the engine reports `current = null` with `heldRating`, because the
battlelog has no post-match rating and the next profile arrives about 90 s later.

**What the B2 screen showed:**

- **Header:** the B2 `CharacterLine` displayed the held value (23 152 LP) as if it were the
  current one, with no label.
- **Classic panel:** it showed the engine's honest unknown («— LP»).

Both were the same character and the same system. This was expected data behaviour combined with
a **B2 presentation bug**: the held value had no label.

**Fix (B3):** a single `RatingSummary` shows the last confirmed value, marked «LP pendiente ·
último confirmado». It resolves when the next profile arrives; the E2E checks the transition.

**Regression test:** «Jamie case…» in `fight-dashboard.test.tsx`. It fails on `main`'s B2 code
and passes with the fix.

## Verification

- **E2E:** `design/phase-5-6b3/e2e/live.e2e.mts` runs the B2 E2E phases (`setup`, `run`,
  `rollback`, `cleanup`), extended with the LIVE flow:
  - LIVE with 0 matches;
  - a battlelog-only match, which gives a pending rating, the «Nueva» badge, scoreboard + last
    match + strip without a reload;
  - a second match;
  - the profile, which confirms the MR;
  - refresh, mobile and laptop.

  Real HTTP, local Postgres, the real SSE stream and the real Companion sync endpoint are used.
  Nothing is mocked.

- **Results:** `screenshots/evidence/e2e-run.json` (46/46) and `e2e-rollback.json`. The B1
  showcase vs B3 LIVE vs B2 intermediate comparison is
  `compare--b1-showcase-vs-b3-live-vs-b2-active.jpg`.

## Limitations

- The recap page is still the classic one (Phase 5.6C).
- Per-match MR/LP and the MR journey need a stored observation log, which needs a migration
  (5.6C).
- The hold label persists until the next profile arrives, and it is never hidden after 3 minutes.
  If the Companion stops sending profiles, the status strip shows it.
- While a post-match rating is pending, the Rank Progress overlay preview in the console shows
  «Sin datos de rango». That is the existing overlay behaviour, out of scope here.
