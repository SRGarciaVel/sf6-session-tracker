# Phase 5.6B–D: implementation roadmap (proposal, not started)

This roadmap assumes the recommended **B-led hybrid** (see `comparison.md`). If the owner picks
pure A or pure B, the PR boundaries stay the same and only the visual layer changes.

Every PR must:

- be small and reviewable;
- keep `pnpm check` and `pnpm build` green;
- keep the session engine and its semantics unchanged;
- put copy in ES and EN;
- use the tokens in `globals.css`;
- keep overlay CSS OBS-safe.

## Phase 5.6B — Prepare & Live

| PR  | Scope                                                                                                                                                                                                                         | Depends on | Notes                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **Session state split.** Render Prepare / Live distinctly inside the dashboard; the ended session collapses to a «Tu última sesión» summary card; the start CTA stays in the first viewport; mobile gets a sticky action bar. | —          | Fixes H1 and H2. Uses `useLiveDashboard`, `assessCompanion`, `startSessionAction`. No backend change.                                                                                                          |
| B2  | **Live actions.** Remove «Iniciar nueva sesión» from the live footer (End → Prepare instead); Esc cancels the confirm; focus management after start and end.                                                                  | B1         | Fixes H3. Needs a product decision: should «start new while live» stay behind a secondary menu?                                                                                                                |
| B3  | **Status strip.** Replace `StatusBar` and the permanent tracking banner with a single strip (lamp + word + sync age + overlays-in-OBS count); show a one-time start confirmation.                                             | B1         | Fixes M3 and M6. Reuses tracker and companion signals already in the live state.                                                                                                                               |
| B4  | **Versus scoreboard + last match.** The new hierarchy for W/L/%, the MR line with a ⏳ pending tag (Phase 5.5 `heldRating`), the «Última partida» line, a live region for new matches and a round strip.                      | B1         | Fixes M2. The rating count reuses `RatingValue`. Last-match data comes from session matches already on the client (verify the payload has opponent and time; otherwise add them to the live state, read-only). |
| B5  | **Overlay dock.** Compact overlay cards (preview, OBS state, Copy, Configure); the URL appears on demand; mobile order puts the dock before history.                                                                          | B1         | Fixes H4. Reuses `OverlaysPanel` summaries, `CopyButton` and `OverlayView`.                                                                                                                                    |
| B6  | **Readiness chips.** The single readiness rendering («4/4 señales»), with the fix link next to the disabled CTA.                                                                                                              | B1         | Fixes M7. Same `assessCompanion` output.                                                                                                                                                                       |

## Phase 5.6C — Session Recap

| PR  | Scope                                                                                                                                                                             | Depends on                       | Notes                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **Results screen.** A hero with games, W, L, % and the **session MR delta per character**; an explicit «MR final no disponible» with its reason; the actions beside the headline. | 5.6B visual primitives           | Fixes M5. Data: `summarizeSessionRow` and `CharacterBreakdown`, both already there.                                                                                    |
| C2  | **Empty and edge recaps.** Zero-game sessions, auto-ended (idle) sessions with honest copy, legacy rating model.                                                                  | C1                               | Copy only; no new data.                                                                                                                                                |
| C3  | **Rating observation log (data).** A new append-only table of profile observations (character, system, value, observed_at, session_id), written by the existing snapshot path.    | Owner approval, migration review | **Needs a migration.** It is the only way to show per-match MR or an MR journey. It must respect: per character, no subtraction across systems/phases, unknown ⇒ null. |
| C4  | **MR journey.** Chart and per-match MR in the recap and log, with gaps (never interpolated).                                                                                      | C3                               | Deferred until C3 ships and has data.                                                                                                                                  |
| C5  | _(Future concept)_ Share card.                                                                                                                                                    | C1                               | Out of scope until the owner asks for it; label as future.                                                                                                             |

## Phase 5.6D — Polish & validation

- **Cross-device QA:** 1440×900, 1280×720 and 390×844 (plus 1920×1080 for streamers), ES and EN.
  Extend the existing Playwright E2E with visual snapshots of the three moments.
- **Accessibility:**
  - raise `--color-faint` on panels to ≥ 4.5:1 (C1);
  - add a live region for match registration;
  - check the keyboard order with the dock;
  - add a reduced-motion test.
- **Motion and performance:** all arrivals ≤ 380 ms, nothing looping, no layout shift when a match
  arrives (reserve space for «Última partida»).
- **Consistency:** apply one corner rule (C2), drop the recap italic (C3), unify the result chips.
- **Beta-streamer sessions:** real participants, the tasks from `comparison.md`, consent, no
  recording of private data. They replace this phase's heuristic scores with observed ones.

## Build order

1. **First:** B1 → B2 → B3 (state clarity and safety; no new data).
2. **Then:** B4, B5, B6 (in parallel once B1 is in), then C1 and C2.
3. **Needs additional data:** C3 → C4 (migration and approval).
4. **Defer:** C5 (share card), any new achievements or historic "records" (no data, against the
   brief).

## Expected code changes (when approved)

- **Components:**
  - `src/app/(app)/dashboard/_components/SessionPanel.tsx` is split into `PrepareStage`,
    `LiveScoreboard` and `SessionActions`;
  - `PlayerHeader` is reduced to a character line;
  - `StatusBar` is replaced by `SessionStatusStrip`.
- **Pages:**
  - `src/app/(app)/dashboard/page.tsx`: new layout order (stage, dock, history, console modules);
  - `src/app/(app)/dashboard/sessions/[id]/page.tsx`: results screen.
- **Readiness:** `Readiness.tsx` gets chip rendering, with the same `CompanionReadiness` input.
- **Overlays:** `OverlaysPanel.tsx` gains a compact dock variant; the console keeps the full
  version.
- **Styling and copy:**
  - `src/app/(app)/globals.css`: slanted CTA, chip and round classes, the faint contrast fix and
    the status-strip classes;
  - `src/i18n/messages/{es,en}.json`: new keys for the moments, strip, chips and recap reasons.
- **Untouched:** session engine, ingestion, Companion, overlay renderer and public overlay APIs,
  auth, routing semantics, migrations (until C3), Render/Supabase.
