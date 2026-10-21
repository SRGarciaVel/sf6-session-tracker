# Phase 5.6A — Comparison and recommendation

**Type of evaluation:** this is an **expert heuristic assessment** of the current UI, from the
audit screenshots and code, and of both prototypes, from their QA run. No participants were
involved and nothing below is a measured usability result. Action counts are counted on the
desktop 1440×900 layout unless stated otherwise.

## Representative tasks

| #   | Task                                  | Current SST                                                                                                                                                                             | A · Broadcast Control                                                                                          | B · Fight Session                                                                                  |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Find and start a game session         | 1 click. After a previous session the CTA sits under the fixed bar at 1440×900, below the fold at 1280×720 and about 1,150 px down on mobile, so a scroll is needed (H1).               | 1 click. The GO key is in the first viewport at all three sizes; on mobile it is in a sticky bar.              | 1 click. The slanted CTA is in the first viewport; on mobile it is in a sticky bar.                |
| 2   | Is the Companion ready?               | Checklist inside the session panel (below the fold after a session); the Companion module is further down; «Enlace en vivo · En línea» refers to the SSE link, which is ambiguous (M3). | The tally lamp («LISTO») plus «4/4 señales correctas» are always visible.                                      | Four readiness chips in the hero; the headline changes to «Conecta el Companion».                  |
| 3   | Current session win rate              | Immediate (hero).                                                                                                                                                                       | Immediate (readout).                                                                                           | Immediate (centre of the versus).                                                                  |
| 4   | Has the latest match synced?          | A new chip and the history row; no opponent or time; a pending MR is not labelled (M2).                                                                                                 | A log row with time, result, opponent and MR status; the new row flashes; «MR pendiente».                      | «Última partida» stamp with the «Nueva» badge, opponent, time and MR status; the round pops.       |
| 5   | Open an existing overlay              | 1 click («Abrir vista previa» in the console); on mobile about 1,600 px of scroll.                                                                                                      | 1 click from the rack (desktop); below the monitor on mobile.                                                  | 1 click from the dock under the stage (desktop and mobile).                                        |
| 6   | Configure an overlay                  | 1 click («Configurar») into the builder.                                                                                                                                                | 1 click (stubbed in the prototype).                                                                            | 1 click (stubbed in the prototype).                                                                |
| 7   | End a game session                    | 2 clicks (inline confirm). The magenta «Iniciar nueva sesión» next to it also ends the session (H3). No Esc.                                                                            | 2 clicks, inline. Focus moves to «Seguir jugando», Esc cancels. No restart button while live.                  | Same as A.                                                                                         |
| 8   | Understand the completed session      | Separate page: W/L/%/games and best streak in the hero; the MR delta is small in the character row.                                                                                     | Report: 5 readouts with the session delta and an explained «MR final no disponible»; actions right under them. | Results screen: 5 large cells with the delta or an explained unknown; actions beside the headline. |
| 9   | Recover from a disconnected Companion | Disabled CTA plus a checklist message; the install help is in another module far below (M7).                                                                                            | Alert next to the GO key with «Ver cómo conectarlo»; the tally shows «NO LISTO»; signals show ○.               | Fix box next to the CTA with the help link; chips show ○; the headline changes.                    |

The prototypes' flows were exercised by clicking the real controls:

- offline blocks the start, and reconnecting unblocks it;
- start → 3 matches (pending → confirmed) → 66,7 %;
- end, with Esc cancelling;
- recap → prepare another, with focus on the CTA;
- the overlays view.

Results are in `screenshots/evidence/prototype-qa-report.json`.

## Matrix

Scores run from 1 to 5 and are expert judgement.

| Criterion                                | Current |  A  |  B  | Notes                                                                                                                                                                                             |
| ---------------------------------------- | :-----: | :-: | :-: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task clarity (prepare/live/recap)        |    2    |  5  |  4  | A names the state in words at all times; B relies on the stage headline.                                                                                                                          |
| Actions to the key tasks                 |    3    |  5  |  5  | Same click counts. A and B remove the scroll (H1) and the destructive primary (H3).                                                                                                               |
| Visual hierarchy                         |    3    |  4  |  5  | B's versus makes W/L/% the unmistakable focus; A gives four readouts equal weight.                                                                                                                |
| Legibility at a glance (between matches) |    3    |  4  |  5  | B's 150 px numerals read from a distance (streamer setup).                                                                                                                                        |
| Information density                      |    3    |  5  |  3  | A shows log and signals together; B needs a scroll for overlays on 1280×720.                                                                                                                      |
| Accessibility                            |    3    |  4  |  4  | Both: QA found 0 target/overflow/clipping issues; token contrast computed ≥ 4.5:1 for text; live regions, Esc and reduced motion verified. B needed the inside-focus fix for clip-path (applied). |
| Responsive behaviour                     |    3    |  4  |  4  | Both use a sticky mobile action bar and confirm in place.                                                                                                                                         |
| Recognisable as SST without the logo     |    3    |  2  |  5  | A's graphite control surface could be any ops tool; B's 24° cut, versus and round markers are SST's own.                                                                                          |
| Emotional quality (prepare / recap)      |    2    |  3  |  5  | B gives the start and the end a moment without blocking.                                                                                                                                          |
| Fit with overlay-first product           |    3    |  5  |  4  | A's «Salidas» rack is permanently visible; B's dock is below the stage.                                                                                                                           |

## Recommendation

**Build on B (Fight Session), adopting three elements from A.** The owner's main problem is
identity ("distinctive, memorable, not generic"). B is the only direction that looks like SST
without the logo, and its hierarchy is the better fit for a streamer glancing between matches.
Its weak points are density and status vocabulary, and those are exactly where A is strongest.

**Hybrid refinements:**

1. **A's status strip** (lamp + word + sync) replaces today's bottom `StatusBar` and the
   permanent tracking banner. It keeps B's colour discipline (magenta = live) and adds A's words
   (LISTO / EN DIRECTO / NO LISTO).
2. **A's event log as the "Registro" tab** under B's «Última partida» on desktop ≥ 1200 px, so
   the session can be audited at a glance without leaving the dashboard. Rows carry time, result
   and opponent. MR per row only once the data exists.
3. **A's «Señales» wording** for readiness («4/4 señales correctas»), rendered as B's chips.

**Also keep from B:**

- one motif (the 24° cut);
- one stage per screen;
- the slanted CTA;
- the versus scoreboard;
- the round strip;
- the results screen.

**Drop:**

- the giant outlined character name on laptop heights below 800 px;
- B's 60 px W/L cut on mobile (use the 26 px cut).

## Risks if implemented

- **B's numerals on 1280×720.** The scoreboard plus the MR line push the overlay dock below the
  fold. Mitigation: a compact scoreboard variant ≤ 760 px tall and a dock summary («2 overlays ·
  1 en OBS») in the status strip.
- **Motion budget.** Keep every arrival ≤ 380 ms and nothing looping; prove it with a
  reduced-motion test in CI.
- **Data honesty.** The MR journey and per-match MR **must stay out** until the observation log
  exists. Showing interpolated values would break the project's rating rules.
