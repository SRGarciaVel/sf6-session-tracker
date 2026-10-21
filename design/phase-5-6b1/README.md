# Phase 5.6B1 — Fight Session design foundation

This phase turns the approved Phase 5.6A direction into production React components:
**Fight Session (B)**, plus three operational elements from Broadcast Control (A). They live in
`src/components/fight-session/`. **Nothing in the app uses them yet.** The dashboard, recap,
routes, session actions, Companion, overlays and data are unchanged. Integration is Phase
5.6B2/B3.

## Sources of truth used

- `design/phase-5-6a/design-directions.md`: the B design system (24° cut, lean display, versus,
  rounds, CTA, inside focus) and the shared rules.
- `design/phase-5-6a/comparison.md`: the hybrid. A contributes:
  - the **status strip**;
  - the **Companion/sync vocabulary**;
  - the **activity log** and accessible overlay actions.
- `design/phase-5-6a/prototypes/fight-session/` and the B evidence screenshots, as the visual
  reference. Side-by-side comparisons are in `screenshots/evidence/compare--*.jpg`.
- `design/phase-5-6a/audit.md`. One data constraint applies: **there is no per-match MR**, so
  no component shows one.

## Components (`@/components/fight-session`)

| Component                                   | Role                                                                             | Notes                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `SessionStage`                              | The single hero surface per screen                                               | Ghost character name (type, not artwork) and the magenta slash, both `aria-hidden`.                                                        |
| `SessionStatusIndicator`                    | Lamp + word (+ duration)                                                         | `ready · blocked · live · degraded · ended`. Never colour alone.                                                                           |
| `StatusStrip` (from A)                      | Session state, Companion link, Buckler data, last sync, overlays and OBS sources | Only the session state is a live region; the ticking "x s ago" is never announced. It needs a client `now` and shows nothing before mount. |
| `FightScoreboard`                           | The versus: wins, win rate (+ meter, games, draws), losses                       | `large` or `compact`; `highlight` replays a short hit on the changed side. An sr-only summary sentence.                                    |
| `RatingSummary`                             | One character: start → now, session delta                                        | States: pending (held value plus ⏳ and an explanation), unavailable, unknown baseline. MR and LP.                                         |
| `CharacterLine`                             | Prepare identity: character, rank, latest rating                                 | No delta (no session yet).                                                                                                                 |
| `SessionResults`                            | Recap bar: games, W, L, %, session change                                        | The approved recap layout. A missing final rating is explained.                                                                            |
| `RoundStrip`                                | Numbered V/D/E markers                                                           | Optional visible title. The newest can be marked.                                                                                          |
| `LastMatch`                                 | Stamp, result vs opponent, character, time                                       | Announces once (polite) when `isNew`. Long names truncate.                                                                                 |
| `ActivityList` (from A)                     | Concise match log, newest first                                                  | `empty` and `waiting` states. No per-match rating.                                                                                         |
| `StartSessionButton`                        | The slanted CTA                                                                  | Enabled / pending (`aria-busy`, «Iniciando…») / disabled with `describedBy`.                                                               |
| `EndSessionControl`                         | Two-step inline end                                                              | Focus moves to «Seguir jugando», Esc cancels and focus returns. No modal.                                                                  |
| `SessionFeedback`                           | Error and slow-server feedback                                                   | Reuses `ErrorText`.                                                                                                                        |
| `SessionActionBar`                          | Keeps the primary action reachable                                               | Fixed to the bottom below 640 px, inline above.                                                                                            |
| `OverlayAccessCard`, `OverlayDock` (from A) | Preview slot, kind, canvas, OBS state, then Copy / Configure / Preview           | URLs are passed through untouched. `CopyButton` is reused. Accessible names include the overlay name. `LinkComponent` accepts `next/link`. |

The **adapters** (`adapters.ts`) map existing state to the props. They are pure and do no
domain math:

- **`scoreboardFromSession`** shows «—» instead of 0 % when nothing is decided.
- **`ratingFromCharacter(c, status)`** uses the Phase 5.5 hold only in an **active** session.
  The live state can still carry a `heldRating` for an ended session whose final rating was never
  observed. The adapter shows that as _unavailable_, not _pending_. This was found while building
  the showcase; the domain was not changed.
- **`sessionIndicatorStatus`** works from session status, Companion readiness and tracker
  state.
- **`companionStatus`** claims nothing outside companion mode.
- **`activityFromMatches`** maps stored match rows.

## Token / style decisions

- **No new token system.** Everything uses the existing `@theme` tokens (`--color-*`,
  `--font-display`, `--font-mono`, `--ease-snap`).
- New styles are **opt-in `fs-*` classes** added to `globals.css`. The diff is additive (0
  deletions), and a test asserts that no file in `src/app` uses `fs-*` or imports the
  foundation. Activating the redesign is therefore an explicit B2 change.
- **One motif:** the 24° cut (`.fs-cut`, `--fs-cut` per size). Display type leans −6°. Numerals
  are Barlow Condensed 800 with tabular figures.
- **Colour roles:**
  - magenta is the action, through `--color-accent`, so white text stays ≥ 4.9:1;
  - cyan is you, focus and the rating;
  - green and red mark results, always with a letter or glyph;
  - amber marks warnings;
  - the confirm button uses `#c8174e` (white ≥ 5.6:1).
- **Focus:** clipped controls draw focus **inside** the shape (cyan, or white on the CTA), the
  same principle as `.btn`.
- **Motion:** state feedback only (`fs-hit` 360 ms, `fs-pop` 300 ms, `fs-stamp-in` 300 ms) and
  nothing loops. The app's global reduced-motion rule flattens all of it; QA measured 0 running
  animations.
- **Breakpoint `40rem`:**
  - the versus recomposes to W | L with the win rate underneath;
  - the CTA goes full width;
  - the slash is hidden.

## Isolated showcase

The showcase has no Next.js route, no database and no network. It server-renders the real
components (the SSR path) and hydrates them in the browser with an esbuild bundle. The CSS is the
app's own `globals.css`, compiled by the app's Tailwind plugin. Fonts are the repo's OFL TTFs.
The data is fictional and produced by the **real session engine**.

```bash
pnpm exec tsx design/phase-5-6b1/showcase/build.mts
```

```bash
node design/phase-5-6b1/showcase/serve.mjs
```

Open <http://127.0.0.1:4174/> (ES) or <http://127.0.0.1:4174/en.html> (EN). It contains:

- Prepare, with the Companion connected and disconnected;
- Live, with a recent match registered;
- Live with the MR pending and the Companion quiet;
- an empty live session;
- Recap, the missing-rating recap and the zero-match recap;
- the LP system;
- control states and overlay cards, with an empty dock;
- an interactive lifecycle on local state: start → simulate matches → end (Esc cancels) →
  recap.

QA (Chromium) needs the server running:

```bash
pnpm exec tsx design/phase-5-6b1/showcase/qa.mts
```

```bash
bash design/phase-5-6b1/showcase/evidence.sh
```

`screenshots/full/` and `showcase/out/` are git-ignored. `screenshots/evidence/` is the committed
subset.

## Integration recommendations

### 5.6B2 — Prepare & Live on the dashboard

1. Inside `LiveDashboardProvider`, render Prepare or Live from
   `sessionIndicatorStatus({ session, readiness: useCompanionReadiness(), tracker })`. Treat
   `ended` as Prepare on the dashboard, with a «last session» summary (`SessionResults` compact
   or one line).
2. Keep **`startSessionAction` / `endSessionAction` exactly as they are**. Wire them to
   `StartSessionButton` and `EndSessionControl` through the existing `useTransition` / `useSlowFlag`
   / redirect logic from `SessionPanel`. Drop «Iniciar nueva sesión» from Live (audit H3).
3. `StatusStrip` replaces `StatusBar` and the permanent tracking banner. Feed it:
   - `companionStatus(readiness, signals.matchesObservedAt)`;
   - the existing `overlayConnections`;
   - `useNow` as the clock.
4. `RatingSummary` gets `ratingFromCharacter(pickRatingCharacter(withHeldRatings(live, now).session), status)`
   (the hold expiry stays in the domain helper).
5. `LastMatch` and `ActivityList` need opponent and time on the client. Today the live state
   carries only `recentResults`. Add a **read-only** `recentMatches` projection to the dashboard
   live state, which is an additive server change to review in B2. Until then use `RoundStrip`.
6. Place the `OverlayDock` with real `OverlayView` previews, built from the existing
   `overlaySummaries`. On mobile it goes before the history.

### 5.6B3 — Recap

- `/dashboard/sessions/[id]` uses `SessionStage` + `SessionResults` + `RoundStrip` +
  `ActivityList`, with `activityFromMatches(rows)` built from the rows the page already selects.
  Keep both next actions and the «guardada» confirmation.

### Known limitations

- The showcase previews stand in for `OverlayView` (B2 passes the real preview).
- `ActivityList` and `LastMatch` cannot be fed on the live dashboard until the read-only
  `recentMatches` projection exists (see B2.5).
- The mobile action bar overlays content by design. Pages using it must reserve bottom space
  (`pb-28 sm:pb-0`).
- The showcase's per-section screenshots on mobile also capture the fixed action bar of the
  interactive section, because element screenshots include fixed elements that overlap them.
