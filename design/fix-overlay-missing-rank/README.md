# Fix: missing rank in the overlay for completed sessions

**Base:** `main` at `0d21b97`. **Branch:** `fix/overlay-missing-rank`.

## Symptom

A Master player's overlay showed the correct MR and session delta but «—» for rank. In the
reported case (anonymized):

| Field                | Value                                      |
| -------------------- | ------------------------------------------ |
| Character            | A.K.I.                                     |
| MR                   | 1866 → 1903 (+37)                          |
| Latest session       | **ended**                                  |
| Stored ranks         | null (profile, session start, session end) |
| Leaderboard position | 7465                                       |

The streamer being live on Twitch does not matter: the overlay shows the latest SST session,
which had ended.

## Root cause (two layers)

1. **Ingestion stores no label above base Master** (`packages/sf6-capcom-core/src/league.ts`).
   `mapLeagueInfo` stores the rank «Master» only for `master_league = 36`. Capcom's higher Master
   leagues (37+) have no captured, evidence-backed label, so the snapshot stores `rank: null` on
   purpose (no evidence, no label). Session finalization copies that point into
   `final_rank = null` (`finalColumns`, `src/server/sessions/service.ts`).
2. **Ended sessions did not derive** (`src/domain/overlay/state.ts`).
   - Active sessions and the idle profile call `resolveDisplayRank` with `derive: true`, so a valid
     MR shows its tier from the shared thresholds. That is why the bug never shows while a session
     is live.
   - Ended sessions use `derive: false` («frozen labels») and returned the stored rank as is:
     `null`.
   - The overlay (`ratingParts`: `current.rank ?? initial.rank ?? "—"`) therefore showed «—».

The renderer was correct; the projection for completed sessions was not.

## Fix: presentation fallback, only for a missing label

`resolveDisplayRank(point, { derive: false, fillMissing: true })` is used for ended sessions.
Precedence:

1. A stored label is always kept. It is the authoritative history, for example a frozen «Master».
2. If the label is missing on an MR point, the point shows the tier of its **own MR**, through the
   same `masterTierFromMr` and `MASTER_MR_THRESHOLDS` (no second mapping). Each point uses its own
   value: the start point uses the starting MR, the final point the final MR.
3. Otherwise the existing fallback applies: `null`, which the overlay shows as «—». This covers no
   rating at all, MR 0 («no MR yet»), and LP without an evidence-backed label.

Active and idle presentation are unchanged (`derive: true`, including the Legend rule). MR,
deltas and every other metric are untouched. `toLiveSessionState` is the only projection: the
fix reaches the public overlay (`public.ts`, `hub.ts`), the dashboard and the recap the same way.

### Legend

Legend is never inferred.

- An ended session still gets **no** leaderboard position: the existing invariant «an ENDED
  session is never relabelled from a current position» is kept. Today's position does not say
  what the player was when the session ended.
- The ended fallback is MR-only and therefore never Legend. A top-500 position of the same MR does
  not change that (tested).
- In current presentation, Legend still needs an authoritative 1…500 position of the same
  observation (unchanged).

## Historical data

- No migration, backfill or write. Stored rows stay as they are: the browser check reads them
  after rendering and they are still `ended`, both ranks `null`, MR 1866 / 1903.
- A stored label is never rewritten (tested for an ended session with a frozen «Master» at
  1903 MR).
- **Limitation:**
  - The fallback uses today's thresholds. If they change, an old session **without** a stored
    label is shown with the new mapping. Labelled sessions never are.
  - A player who was Legend during an old ended session without a stored label is shown as
    Ultimate Master, because SST has no Legend evidence for that moment.

## Persisting a derived final rank: not included

I inspected session finalization. `final_rank` / `final_rank_tier` hold the same raw,
evidence-based value as the profile snapshot and `initial_rank`. Writing a derived tier there would:

- freeze today's thresholds into history;
- mix «Capcom/evidence label» with «SST display tier» in one column;
- contradict the documented rule that tiers are derived on read (`master-tier.ts`).

The read-time fallback covers new sessions too, so no write-path change is needed.

## Tests

**Unit and render:**

- `src/domain/overlay/missing-rank.test.ts` (25), using the anonymized engine fixture in
  `src/domain/overlay/missing-rank.fixture.ts`:
  - the ended case shows Ultimate Master, with MR and delta unchanged;
  - each point is labelled from its own MR;
  - active sessions are unchanged, and Legend applies only with a same-observation position;
  - invalid positions (`null`, 0, −1, 501, 7465, 1.5, NaN, ∞) never give Legend, active or ended;
  - an ended session never becomes Legend;
  - stored labels are kept (both points, and a mixed case);
  - no rating, MR 0 and LP keep the fallback;
  - direct `resolveDisplayRank` cases.
- `src/components/overlay/missing-rank-render.test.tsx` (19): the real `OverlayView` in all six
  themes, including Broadcast:
  - Ultimate Master, 1903 and +37;
  - ended and active render the same rank and metrics;
  - Broadcast keeps a stored label;
  - no rating still renders «—».
- Updated on purpose: `master-tier-live.test.ts` «a frozen 1605 with no stored rank stays
  unlabelled» becomes «shows its own MR tier». That is the behaviour this fix changes.
- **Regression proof:** with the fix stashed, 26 of the 44 new tests fail on `main`.

**Browser check** (`e2e/missing-rank.e2e.mts`): local production build, local Postgres, one
`@test.local` account. The real Companion sync with `master_league` 37 gives null stored ranks,
then a session 1866 → 1903 is ended. **7/7 checks:** Broadcast and Competitive show Ultimate
Master, with 1903 MR, ▲+37 and 3W/1L/75 % unchanged; the stored rows are untouched.

- `screenshots/before-after.png`: before is «—», after is «ULTIMATE MASTER».
- Broadcast gets wider with the label, exactly as it already does during an active session.
