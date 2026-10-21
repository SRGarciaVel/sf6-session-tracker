# Phase 5.6A — Two design directions

Both directions keep SST's name, monogram, palette roots and the overlay-first priority. They are
**different structures**, not recolourings. Both implement the same three moments and the same
honest-data rules:

- the win rate is unknown (—) with 0 decided games;
- the MR delta is always the **session** delta from the engine;
- a pending post-match MR keeps the last confirmed value and says so (⏳ MR pendiente);
- a missing final MR is explained, never invented;
- per-match MR is tagged **CONCEPTO** because SST does not store it (see `audit.md`).

Prototypes: `prototypes/broadcast-control/` (A) and `prototypes/fight-session/` (B), with shared
engine, i18n and controls in `prototypes/shared/`. See [README](README.md).

---

## A — Broadcast Control

> "Everything is under control. I'm ready to go live."

SST becomes a live-production control surface. **Concept:** a _program tally_ and _channels_.

- **Tally strip** under the nav, always visible. It shows the program state as a lamp plus a
  word: LISTO / NO LISTO / EN DIRECTO 46 min / SESIÓN CERRADA. Next to it are the character
  line (Ryu · MASTER · 1571 MR) and the sync health.
- **Monitor** (left):
  - **PREPARE:** a spec table of what will be tracked (Ranked · Ryu MR from 1571 · 2 overlays),
    a full-width **GO key** («Iniciar sesión de juego», state «ARMADO» / «NO LISTO») and a
    single-line previous-session summary.
  - **LIVE:** four channel readouts (V / D / % / MR with its session delta and pending state),
    the W/L ratio bar and a timestamped **event log** (match, result, opponent, MR status).
  - **RECAP:** the «Informe de sesión» shows five readouts (games, W, L, %, session delta) and
    the actions directly below them. It also shows the MR journey (**concept**), the result
    strip and the log.
- **Rack** (right): **Señales** shows Companion, Buckler, Perfil and Personaje as LED rows,
  with «4/4 señales correctas». **Salidas** lists the overlays as output rows (mini preview,
  OBS state, Copy URL, Configure).
- **Mobile:** the tally is condensed to state and MR. The GO key and the End action live in a
  sticky bottom bar, and the end confirmation happens inside the bar.

### Design system A

| Aspect      | Spec                                                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typography  | Barlow Condensed 700/800 for readouts and labels (uppercase, +0.12–0.16em). Barlow 400/600 for body. **JetBrains Mono 500** for times, codes and the program/sync line (new role for an existing repo font).                                                  |
| Type scale  | Readouts 64/54/44 px (desktop/laptop/mobile). GO key 26 px. Panel titles 15 px. Labels 12–13 px. Body 15 px. Mono 12 px.                                                                                                                                      |
| Colour      | Graphite surfaces `#07090e / #0d1017 / #121722`, rules `#1d2431 / #2b3445`. Text `#e8ebf2`, muted `#8e96aa`, faint `#7d859a` (≥ 5:1). Colour is **state only**: magenta = on air, green = ready / win, red = loss, amber = warning, cyan = focus / selection. |
| Surfaces    | Flat panels with 1 px rules and 10 px **registration ticks** on two corners (replaces notches). No gradients except the on-air tally wash.                                                                                                                    |
| Spacing     | 4-pt scale: 4, 8, 12, 16, 24, 32. Dense but aligned to a single grid.                                                                                                                                                                                         |
| Iconography | Square LEDs (8 px), glyph + text (● ⚠ ○ ■ ⏳ ▲ ▼). No icon font.                                                                                                                                                                                              |
| Status      | Lamp plus word on the tally. LED plus word in Señales. Amber alert boxes with a fix link.                                                                                                                                                                     |
| Buttons     | GO key (76 px, physical press offset). Primary small `#d6127a` (white ≥ 4.9:1). Secondary graphite. Danger-ghost for End, danger-solid for the confirm. Square corners.                                                                                       |
| Motion      | 120 ms for press/hover, 220 ms for state. The new log row flashes cyan (900 ms fade). Readouts count over 550 ms (easeOutCubic). The on-air lamp blinks briefly every 2.4 s, the only ambient motion.                                                         |
| Easing      | `cubic-bezier(0.2, 0.7, 0.2, 1)` for everything. No overshoot.                                                                                                                                                                                                |
| Breakpoints | 1320 (laptop scale-down), 980 (single column), 640 (mobile bar).                                                                                                                                                                                              |
| Focus       | 2 px cyan outline with a 2 px offset (no clip-path in A).                                                                                                                                                                                                     |
| Microcopy   | Operational and short: «Listo», «Armado», «Señales», «Salidas», «Registro». Times in mono.                                                                                                                                                                    |

**Personality risk:** it can drift toward "generic ops dashboard". It stays SST through the
magenta GO key, the tally and the condensed numerals, but it is the less recognisable of the two
without the logo.

---

## B — Fight Session

> "This is my session. This is my progress."

SST becomes the stage of the player's session. **Concept:** the _stage_ and the _versus_.

- **Stage**: one hero panel per moment, the only place with personality.
  - A giant outlined character name (RYU) is drawn in type, not artwork.
  - A single magenta slash uses the monogram's **24° cut**, the only geometric motif. It repeats
    on chips, buttons and round markers.
- **PREPARE:**
  - The headline reads «LISTO PARA LA SESIÓN», or «CONECTA EL COMPANION» when blocked.
  - Below it come the character line and four slanted readiness chips.
  - The **slanted CTA** («Iniciar sesión de juego →», 84 px) has one line underneath stating
    what will be tracked.
  - On the right, a «Tu última sesión» card shows the score 4–2 with %, delta and games.
- **LIVE:**
  - A **versus scoreboard**: the W block slanted in from the left, the L block from the right
    and the % with a meter in the middle.
  - Below it, the MR line (1571 → 1602 ▲ +31, ⏳ pending), a «Última partida» stamp (V/D), the
    opponent and time, and a **round strip** of numbered V/D markers.
  - Start shows a one-time banner and a single magenta sweep.
  - A new match _stamps_ in, the counter jumps and the round pops.
- **RECAP:**
  - «SESIÓN TERMINADA», with the actions at the same height.
  - A five-cell results bar (games, W, L, %, session delta or an explained «MR final no
    disponible»).
  - The MR journey (**concept**), the round strip, best streak and duration.
  - A collapsible match list.
- **Overlays dock** under the stage: cards with a preview, OBS state, Copy and Configure, plus
  «Gestionar overlays».
- **Mobile:** the stage stacks. The scoreboard keeps W | L side by side with % underneath. The
  CTA is sticky.

### Design system B

| Aspect      | Spec                                                                                                                                                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typography  | Barlow Condensed **800** display with a −6° lean (not the mark's 24°: type stays readable). Numerals 150/124/92 px. Barlow body. JetBrains Mono only for round numbers.                                                                                                      |
| Type scale  | Display `clamp(44px, 6vw, 84px)`. Scoreboard 150 → 92 px. Recap numbers 76 → 52 px. MR now 54 px. Section labels 13 px (+0.18em).                                                                                                                                            |
| Colour      | The production tokens unchanged: ink `#05070f`, surfaces `#0c1021 / #111733`, lines `#1b2448 / #2d3863`, cyan, magenta, violet, win, loss, warn. Faint raised to `#7f8ab3` (≥ 5.5:1). Magenta = the action, cyan = you / focus, violet only in the stage glow.               |
| Surfaces    | One stage per screen (radial violet glow, 1 px line). Everything else is flat `#0c1021` cards. No glass, no blur.                                                                                                                                                            |
| Shapes      | The 24° cut as `clip-path` on CTAs, buttons, chips, stamps and rounds. The W/L blocks use a larger 60 px cut.                                                                                                                                                                |
| Spacing     | 6/8/12/16/22/28/40 px. More air than A.                                                                                                                                                                                                                                      |
| Iconography | Glyph + text. Results are always letters (V/D, W/L) with a round number.                                                                                                                                                                                                     |
| Status      | Readiness chips (glyph + label + state). Amber fix box next to the CTA. «Nueva» badge on the last match.                                                                                                                                                                     |
| Buttons     | Slanted magenta CTA (84 px; 60 px in the recap); slanted secondary (`rgba(238,241,251,.07)`); end-ghost in loss tint; confirm `#c8174e` (white ≥ 5.6:1).                                                                                                                     |
| Motion      | Start: banner `slam` (320 ms, overshoot) and a single stage sweep (650 ms). Match: stamp (300 ms), round pop (300 ms), counter hit (360 ms), counts (550 ms). End: headline slam (380 ms). Hover: a light wipe on the CTA (520 ms) and the arrow nudges 6 px. Nothing loops. |
| Easing      | `--ease-snap: cubic-bezier(0.2, 0.9, 0.2, 1.15)` for arrivals (the production token's spirit). `--ease` for exits.                                                                                                                                                           |
| Breakpoints | 1320, 1060 (stack), 640 (mobile).                                                                                                                                                                                                                                            |
| Focus       | Clip-path would cut outlines, so focus is drawn **inside**: a 3 px white (CTA) or cyan (buttons) inset plus an ink inset. This is the same principle as the production `.btn`.                                                                                               |
| Microcopy   | Personal, second person: «Listo para la sesión», «Tu última sesión», «Esperando tu primera partida». It does not praise or judge: the recap says «Sesión terminada» whether you won or lost.                                                                                 |

**Personality risk:** big numerals cost vertical space on 1280×720. The stage can feel "gamey"
if more motifs are added later. The rule is **one motif (the 24° cut), one stage per screen**.

---

## Shared rules (both)

- **Reduced motion:** with `prefers-reduced-motion`, every animation and transition collapses to
  1 ms. QA measured no running animation after a match in either prototype.
- **Contrast:** body and labels ≥ 4.5:1. Large CTA text on brand magenta ≥ 3:1 (large-text rule).
  Small text on magenta uses the darker accent.
- **Targets:** ≥ 24×24 px (WCAG 2.2). The QA check reports 0 violations; primary controls are
  ≥ 44 px.
- **No:** countdowns, confirmation modals to start, streak pressure, sounds, badges, "personal
  best" claims, or loops.
- **i18n:** every string is in ES and EN catalogs, numbers go through `Intl` (es-ES/en-US). EN
  screenshots are in the evidence set.

## Production components that can be reused

| Need               | Existing piece                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Readiness facts    | `domain/companion/readiness.ts` (`assessCompanion`, `nextStep`), `Readiness.tsx` (`StatusValue`, `CompanionStatusRows`, `StartChecklist`) |
| Live state & clock | `LiveDashboard.tsx` (`useLiveDashboard`, `useNow`), SSE invalidation as today                                                             |
| Numbers            | `domain/format.ts` (`formatWinRate`, `formatDelta`, `formatDuration`), `RatingValue` / `CountingNumber` (Phase 5.5) for counts            |
| Session actions    | `startSessionAction` / `endSessionAction` (unchanged semantics), recap redirect `?ended=1`                                                |
| Recap data         | `summarizeSessionRow`, `toLiveSessionState`, `CharacterBreakdown`                                                                         |
| Overlays           | `OverlaysPanel` summaries, `CopyButton`, `OverlayView` previews (real previews instead of the prototypes' minis)                          |
| Primitives         | `Button`/`buttonClass`, `Badge`, `Dot`, `LiveIndicator`, `.btn` focus-inside pattern, `hud-label`, `hud-tag`                              |

**Consolidate** (both directions need it):

- one status strip instead of `StatusBar` plus the tracking banner;
- one readiness rendering instead of separate checklist and Companion rows;
- one result-chip component used today in 3 places (`SessionPanel`, recap, history).

Do not build a new component library before a direction is approved.
