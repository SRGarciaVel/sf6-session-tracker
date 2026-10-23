# M2B — Fight Session motion

Second stage of M2 (after M2A, PR #80). It adds event-driven motion to the Fight Session
dashboard and recap. Motion plays only for a real gameplay event: the session started, a match
arrived, a rating was confirmed, or the session ended. Fight Session is still gated by
`FIGHT_SESSION_UI_USERS`, and the classic UI and OBS overlays are untouched.

- **Main HEAD:** `8f9b497`, the merge of PR #80 (M2A).
- **Branch:** `feat/sst-fight-session-motion`.

## 1. Motion event audit

The live state arrives as a full snapshot over the one existing SSE stream
(`LiveDashboardProvider`). Match ids are database uuids (stable). Session ids are stable too.

| Transition                      | Before M2B (main)                                                                          | Reliable signal                                                                                            | M2B                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Initial PREPARE render          | static                                                                                     | none: a page load is not an event                                                                          | static (unchanged)                                                                 |
| PREPARE → LIVE                  | heading `fs-enter` only; its keyframes dropped the heading's −6° lean during the animation | `session.status` turns `active` in a server snapshot while this view is mounted                            | one stage reveal                                                                   |
| First / next match              | the newest marker, scoreboard side and stamp keyed on «the latest id changed»              | a new **match id** within the same session **and** a growing engine `totalGames`                           | the arrival cue                                                                    |
| Several matches in one snapshot | only the latest was marked; the side for the latest result only                            | as above (one snapshot is one event)                                                                       | every new id marked, both sides when both counts grew, one summarized announcement |
| Same result twice in a row      | no replay: the class was already present, and markers were keyed by index                  | `seq` of the arrival                                                                                       | accents remount, so they replay; never stacked                                     |
| Win vs loss                     | `fs-hit` with an overshoot curve                                                           | engine `wins` / `losses` grew                                                                              | win green / loss red hit + side flash, no overshoot                                |
| Rating confirmed                | no cue                                                                                     | a confirmed value (`pending=false`) replaces a different confirmed value for the same character and system | underline sweep                                                                    |
| Rating pending                  | text «MR pendiente · último confirmado»                                                    | `pending=true`                                                                                             | **never animated** (unchanged text)                                                |
| SSE reconnect                   | full snapshot resync                                                                       | same ids, same counts                                                                                      | no cue                                                                             |
| LIVE → RECAP                    | client navigation; heading not focused                                                     | `endSessionAction` ok → `/sessions/:id?ended=1`                                                            | restrained entrance + focus on the summary heading                                 |
| RECAP → PREPARE                 | client navigation                                                                          | link                                                                                                       | no extra motion (decision below)                                                   |
| Classic dashboard               | unchanged                                                                                  | —                                                                                                          | unchanged (no hooks, no classes)                                                   |

**What is not an event:**

- the array length changing;
- a reordered list;
- a duplicate snapshot, or one from a reconnect;
- an id entering the window without the engine count growing;
- a different session id: the view re-seeds silently;
- hydration, back/forward, a refresh, a return to the dashboard.

## 2. Implemented transitions (vocabulary)

| Cue                     | Where                                  | Motion                                                                                                                                                                                          | Duration (real, from `document.getAnimations()`)                                               |
| ----------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Stage reveal**        | LIVE stage right after Start           | magenta slash sweeps in (`scaleX`, rotation kept), heading enters from the left (`translate`, keeps the lean), wins side cuts in from the left and losses from the right, win-rate column fades | slash 400 ms; heading 280 ms; sides 280 ms + 60 ms; middle 280 ms + 120 ms. **Total ≤ 400 ms** |
| **Scoreboard accent**   | the side(s) whose count grew           | number hit `scale(1.18 → 1)` + side tint flash `opacity .22 → 0` (behind the text)                                                                                                              | 400 ms                                                                                         |
| **Match-row highlight** | new round marker(s)                    | drop-in `translate + scale`; batches cascade from the newest backwards (max 2 × 60 ms delay); static outline for 4 s                                                                            | 280 ms (+0/60/120 ms)                                                                          |
| **Result stamp**        | «Última partida»                       | stamp lands (`scale + rotate`)                                                                                                                                                                  | 280 ms                                                                                         |
| **Confirmed rating**    | value under «Personajes» / LIVE rating | cyan underline sweeps in, holds, fades                                                                                                                                                          | 900 ms (sweep ≈ 220 ms, then hold/fade; ends invisible)                                        |
| **Recap introduction**  | RECAP stage after ending               | stage settles upward `translateY(10px)`, opacity .4 → 1; «saved» line enters                                                                                                                    | 280 ms; 280 ms + 80 ms                                                                         |

All of them use the M2 tokens (`--motion-stage/panel`, `--motion-ease-out`; no
`--motion-ease-emphasis`, so no overshoot). They animate only `transform`/`translate`/`opacity`,
play once and never loop. There is no sound, blur, glow or scroll-jacking. Content never waits
for motion: the values are in the DOM from the first frame.

## 3. Trigger semantics

- **`detectArrival`** (`src/components/fight-session/motion.ts`, pure). It is UI-only and
  compares the engine summary as given; it never derives results.
  - A different session id re-seeds the view: no event.
  - `totalGames` did not grow: no event. Unseen ids are still recorded as seen.
  - Otherwise the event carries the unseen ids, newest last, capped to the number of added
    games. `win` / `loss` are true when the engine's counts grew. A payload without ids still
    accents the scoreboard side.
- **`useMatchArrival`** (dashboard). It seeds from the first render (render-time state
  adjustment, so there is no effect flash) and keeps the event for `FRESH_MATCH_MS` = 4 s (the
  «Nueva» badge). `seq` grows per arrival.
- **`useConfirmedRatingPulses`.** The counter grows only when a confirmed value replaces a
  different confirmed value. Pending, held and unknown values never count, and the outcome of a
  match is never used to guess a rating (PR #72's observation-time rule is untouched).
- **PREPARE → LIVE.** `FightSessionArea` flips `justStarted` only when it observes
  `status: active` after having rendered a non-active state. The server confirms first; no state
  is optimistic. A failed start never reaches LIVE.
- **LIVE → RECAP.** `justEnded` (`?ended=1`, which already existed) adds `fs-recap-in`.
  `FocusTarget` focuses `#fs-recap-title` (`tabIndex=-1`). Navigation is not delayed: the recap
  is server-rendered and motion starts after paint.

## 4. Cancellation and reconnect

- **Back-to-back arrivals.** The accent elements are keyed by `seq`: the new element replaces
  the old one, so its animation restarts. Accents never pile up (one flash per side at most).
- **Reconnect** (real `EventSource` closed + stream blocked, then reopened): «Reconectando…»
  shows, the new stream sends the same snapshot, and there is **no cue**. One stream at a time:
  2 requests for one outage, the failed retry and the reconnect.
- **Session switch** (ended elsewhere, new one started): re-seed, no cue.
- **Unmount** (navigation): timers are cleared, nothing persists. A remount is a fresh baseline.

## 5. Reduced motion

The global `prefers-reduced-motion` rule collapses durations to 1 ms. M2B also zeroes the
staggered delays (`.fs-stage-reveal *`, `.fs-recap-in *`, `.fs-round-new`), so nothing waits
hidden. Accents that end invisible (flash, underline) simply do not show. These stay static:

- the «Nueva» badge and the marker outline (4 s);
- the live-region announcement;
- the number itself.

Checked in Chromium (`reducedMotion: "reduce"`): 11 running animations, all ≤ 1 ms with 0 delay,
and every scoreboard side at opacity 1.

## 6–7. Evidence

`screenshots/evidence/m2b/`:

- **Frame strips** (`*--frames.jpg`): captured at 1/10 speed through the DevTools protocol,
  about 50 ms of animation per frame:
  - `start-reveal`;
  - `match-win`;
  - `match-batch` (cascade of 3 markers, both sides);
  - `rating-confirmed`;
  - `recap-in`.
- **Before/after stills:**
  - LIVE just started;
  - batch;
  - recap;
  - reduced motion;
  - 390 px;
  - classic.

  Plus `09-live-en--after.jpg`.

- **Data files:**
  - `timing.json`: the real `CSSAnimation` names, durations and delays for each event;
  - `checks.json`: 25/25;
  - `metrics.json` / `metrics-before.json`.

**Before:** on the main build, a batch of 3 marks only the newest match. The E2E's
`li.fs-round-new === 3` wait times out there; that is the bug M2B fixes.

## 8. Browser QA (`e2e/session-motion.e2e.mts`)

Local production build, local Postgres, `@test.local` accounts. All data goes through the real
Companion sync endpoint. **25/25 checks in one run:**

1. PREPARE initial render;
2. start;
3. failed start (expired auth: the real action refuses);
4. initial LIVE / refresh;
5. first match;
6. win then loss;
7. batch of 3;
8. SSE drop and reconnect;
9. back/forward;
10. refresh;
11. pending, then confirmed rating;
12. end;
13. failed end;
14. RECAP;
15. RECAP → PREPARE → start another;
16. reduced motion;
17. 360 / 390 px;
18. classic fallback (start, match and end on account B);
19. OBS source;

plus 200 % text at 360 and 390, and the EN batch announcement.

The full run is about 9 minutes, because Companion syncs are rate-limited to 1 per 6 s.

Note: the recap in the evidence says «MR final no disponible». That is correct engine
behaviour: the last match of that run, played during the CPU-throttled measurement, had no
rating observation before the session ended.

## 9. Accessibility

- **Focus:**
  - after Start, focus moves to the LIVE heading (existing behaviour);
  - after End, focus moves to the RECAP heading. It no longer falls back to `<body>`.
- **Announcements:**
  - one polite announcement per arrival;
  - a batch is summarized as «3 partidas registradas. La última: …» / «3 matches recorded.
    Latest: …»;
  - no announcement on load, reconnect or rating accent.
- **Decoration:** all cues are on `aria-hidden` decoration or on elements whose text already
  carries the information. Motion is never the only signal (numbers, letters, badge, text).
- **Visibility:** no content is hidden by animation beyond ≤ 400 ms.
- **Unchanged:** M2A focus rings and touch targets.

## 10. Mobile

The slash is already hidden below 40 rem. At 360 and 390 px there is no horizontal overflow,
including at 200 % text.

## 11. Performance

|                                                              | main                        | M2B                    |
| ------------------------------------------------------------ | --------------------------- | ---------------------- |
| CSS (all chunks, gzip)                                       | 25 712 B                    | 26 088 B (**+376 B**)  |
| JS (all chunks, gzip)                                        | 399 625 B                   | 400 480 B (**+855 B**) |
| LIVE CLS                                                     | 0.0052                      | 0.0052                 |
| Idle LIVE CPU, 30 s                                          | 136 ms                      | 141 ms (noise)         |
| Arrival at 4× CPU throttle: CPU / p95 frame / frames > 50 ms | 866 ms / 49.9 ms / 3        | 884 ms / 50 ms / 4     |
| SSE requests during the run                                  | 10                          | 10                     |
| Continuous animations in LIVE                                | `live-ring` (existing lamp) | the same, none added   |

There is no animation dependency and no polling. These are single runs, so I make no speed
claims; the differences are within run-to-run noise. The 4× numbers include the ingestion
re-render, not only the motion.

## 12. Tests

- `motion.test.ts` (10): hydration, single, duplicates, batch, out-of-order, reorder, count
  without growth, cap, payload without ids, session switch.
- `fight-dashboard.motion.test.tsx` (13): through the real provider and a fake `EventSource`:
  - load;
  - new match;
  - same result twice replays;
  - batch and stagger;
  - duplicate/reconnect;
  - reorder;
  - remount;
  - session switch;
  - pending vs confirmed rating;
  - rating on load;
  - reveal only when observed;
  - refresh;
  - failed start.
- `motion-contract.test.tsx` (11):
  - recap entrance and focus;
  - tokens without overshoot;
  - transform/opacity only;
  - accents end invisible;
  - the heading keeps its lean;
  - nothing loops;
  - reduced-motion delays;
  - OBS and classic isolation.

## 13–14. OBS and classic

- **OBS:** no file under `src/app/(overlay)` or `src/components/overlay` references the cues
  (unit test). In the browser, the overlay document loads no CSS rule and no element from them.
  Overlay URLs, tokens and the overlay's own MR/LP transition settings are untouched.
- **Classic:** only `FightSessionDashboard.tsx` imports the triggers. Start → match → end on the
  classic dashboard has no Fight Session stage or cue.

## RECAP → PREPARE

No new animation. «Preparar otra sesión» already carries M2A's directional nudge, and PREPARE
should put the Start button in front of the player at once. A return animation would only delay
it.

## 15. Remaining risks

- Reloading a `?ended=1` URL replays the 280 ms recap entrance, exactly like the existing
  «saved» banner on that URL. It is harmless, and is kept so the classic `?ended=1` semantics do
  not change.
- If a snapshot carried a new match id without the engine count growing, it would be treated as
  a correction (no cue). That is deliberate: no false «new match».
- The 900 ms rating underline is longer than the stage token: it is a hold-and-fade accent, not
  a transition (sweep ≈ 220 ms).
- `?ui=classic` and non-allowlisted users never load the hooks. Enabling Fight Session for more
  users is out of scope.
