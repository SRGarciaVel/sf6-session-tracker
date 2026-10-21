# Phase 5.6A — Audit of the current SST experience

- **Baseline:** `main` at `3f74f3f53dd2117f2d9e600d95212e38d0939ebb` (PR #63, Phase 5.5 smooth
  rating transitions, merged 2026-10-20). Recent merges in scope: #57–#63 (replay selection,
  overlay kinds, Rank Progress, dynamic Legend, Companion 0.4.0 prep, Legend QA, transitions).
- **Method:** source review of the dashboard, recap, Companion and overlay code, **plus a visual
  audit of the real UI**. A local production build (`pnpm build && pnpm start`, companion mode)
  ran against the local Postgres (`localhost:5433`, guarded), with a fictitious `@test.local`
  account fed through the real Companion sync endpoint. The flow covered sign-up, onboarding,
  prepare, start, 10 matches (one with a pending rating), the Companion going quiet, end, recap
  and the error page. Screenshots were taken at 1440×900, 1280×720 and 390×844
  ([`audit/capture-current.mts`](audit/capture-current.mts)). The account was deleted afterwards.
- **Not done:** no real users, no analytics, no production data. Findings are an **expert
  heuristic review**, not measured usability results.

Evidence: `screenshots/evidence/current--*.jpg`. The full set (80 PNG) is regenerable and
git-ignored.

> Full-page screenshots show the sticky header and status bar half-way down the page. That is a
> capture artifact (fixed elements in a full-page capture), not a layout bug.

## What already works (keep it)

1. **The HUD language is coherent and already SST's own.** It has notched panels, Barlow
   Condensed numerals, the magenta primary action, cyan focus and parallelogram tags. Status
   never depends on colour alone: there is always a glyph and a sign (V/D letters, ▲/▼).
2. **Honest data.**
   - Win rate comes from the engine.
   - Per-character MR (`1532 → 1571 +39`).
   - Phase 5.5 keeps the last confirmed MR while a post-match rating is pending (`07-live-rating-pending`).
   - The readiness checklist explains _why_ a session cannot start.
3. **Start/end semantics are safe.**
   - Start is one click.
   - End is an inline two-step confirm, with no modal (`confirm-end`).
   - The recap confirms the save («Sesión finalizada y guardada») and offers both next actions.
4. **Overlay console.** Each overlay shows a live preview, its canvas size, language and theme, and
   «Copiar URL para OBS». The OBS how-to sits right next to it. The builder (`12-overlay-builder`)
   is strong: a live preview, sample data and a «Reproducir actualización» button.
5. **i18n parity.** ES and EN render without clipping (`11-live-session-en`). There is no
   horizontal overflow at any audited viewport (`current-ui-notes.json`).
6. **Focus.** Notched buttons draw focus _inside_ the clip-path (`globals.css`, `.btn:focus-visible`).

## Findings

### Critical usability issues

None found. Every audited task can be completed.

### High-priority friction

| #   | Current behaviour                                                                                                                                                                                                                                                                                                                                           | Why it is a problem                                                                                                                                   | Evidence                                                            | Recommendation                                                                                                                                 | Benefit                     | Complexity |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------- |
| H1  | **After a session ends, the start CTA leaves the first viewport.** The «Sesión actual» panel keeps showing the _ended_ session (big 4V/2D, «FINALIZADA»), the history chips and the checklist. «Iniciar sesión de juego» drops to y≈855 at 1440×900, under the fixed status bar, and fully below the fold at 1280×720. On mobile it is about 1,150 px down. | Starting a session is the product's key moment and the most frequent returning task, and it needs a scroll.                                           | `current--04-prepare-after-session--desktop-fold`, `…--laptop-fold` | Make PREPARE its own state. The previous session collapses to a one-line summary; the CTA stays in the first viewport and is sticky on mobile. | Faster start; clearer state | M          |
| H2  | **PREPARE, LIVE and RECAP share one panel.** An ended session reads «Sesión actual · Finalizada», with live-sized numbers and a live-style layout.                                                                                                                                                                                                          | It is hard to tell at a glance whether SST is tracking. The recap lives on another page, but the dashboard still shows an ended session as "current". | `current--04…`, `current--14-recap…`                                | Give each moment its own layout and copy (Prepare / Live / Recap).                                                                             | State clarity               | M          |
| H3  | **During LIVE, the primary (magenta) button is «Iniciar nueva sesión».** It sits next to «Finalizar sesión» and silently ends the current session; only a tooltip says so.                                                                                                                                                                                  | The most prominent action while playing is a destructive one. A mis-click restarts the session counters.                                              | `current--08-live-session--desktop`                                 | During LIVE the only session action is End (two-step). «Start new» becomes End → Prepare.                                                      | Fewer accidents             | S          |
| H4  | **Overlays are buried on mobile.** On 390 px the console stacks after the player header, the session and the history: the first overlay preview sits around y≈1,600. Each overlay repeats the URL field, Copy and Preview.                                                                                                                                  | Overlays are the primary product. Reaching «Copiar URL» on a phone takes a long scroll.                                                               | `current--08-live-session--mobile`                                  | Add a compact overlay dock (name, OBS state, Copy, Configure). Show the URL only on demand.                                                    | Overlay-first navigation    | M          |

### Medium-priority opportunities

| #   | Finding                                                                                                                                                                                                                                      | Evidence                                             | Recommendation                                                                                                               | Complexity |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- |
| M1  | **«0 %» with 0 games** on the first-ever prepare screen, plus «Mejor racha 0V». With nothing decided the summary's win rate is 0, and `formatWinRate` renders it as «0 %».                                                                   | `current--03-prepare-first-time`                     | Show «—» like the overlays do, or hide the stats before the first session.                                                   | S          |
| M2  | **No last-match feedback.** When a match arrives, only a new chip and the history row change. Opponent and time live on the details page, and a pending post-match MR is not labelled: the held value is shown as if confirmed.              | `current--07-live-rating-pending`                    | Add a «Última partida» line, a one-shot highlight for the new match and a quiet «MR pendiente» tag while the rating is held. | S–M        |
| M3  | **Two "live" vocabularies.** The status bar shows «ENLACE EN VIVO · En línea» (the SSE link) and «SEGUIMIENTO» (tracking). The checklist shows Companion and Buckler. Streamers can read «En línea» as Companion status.                     | `current--08…` bottom bar                            | Use one status strip that names the Companion and the sync time. Keep SSE health implicit unless it fails.                   | S          |
| M4  | **The player header competes with the session.** The 48 px name, the ghost watermark and a second rank/MR readout duplicate the session panel's MR.                                                                                          | `current--04…`                                       | Move the identity into a compact character line, so the session owns the hierarchy.                                          | S          |
| M5  | **The recap under-uses its moment.** The hero shows W/L/%/games and best streak. The MR change appears only in the per-character row at small size. There is no "rating unavailable" message: an unknown delta shows «—» without saying why. | `current--14-recap-just-ended`                       | Put the session MR delta in the hero, give an explicit reason when it is unknown, and keep both next actions.                | S–M        |
| M6  | **The tracking banner never goes away.** «Tracking activo — Ya puedes jugar…» stays for the whole session and repeats the status bar.                                                                                                        | `current--08…`                                       | Show the confirmation once on start, then fold it into the status strip.                                                     | S          |
| M7  | **Recovery path is split.** When the Companion is offline, the message sits in the checklist, but «Ver instalación» lives in the Companion module far below.                                                                                 | `current--05-prepare-companion-disconnected--mobile` | Put the fix link next to the disabled CTA.                                                                                   | S          |

### Cosmetic / consistency

- **C1.** `--color-faint` (#6b76a3) on surface panels (#0c1021) measures **4.27:1**, below AA (4.5:1)
  for small text. Examples: «Última sincronización», hints. On the page background it measures 4.55:1.
- **C2.** Panel corner treatments vary between the session panel, the console and the recap
  (notch sizes 18 px and 20 px, plus gradient tops), with no rule behind them.
- **C3.** The recap headline uses italic display («SESIÓN COMPLETADA»), but nothing else in the
  app does.
- **C4.** History rows truncate the MR column on mobile; only the delta is kept.

### Accessibility review (current)

- **Strengths:**
  - visible focus everywhere;
  - `aria-label` on the ratio bar and the recent results;
  - `role="status"` on the recap confirmation;
  - status shown as a glyph plus text;
  - the language switcher is reachable.
- **Gaps** (from code and screenshots):
  - C1 contrast.
  - The W/L/% numbers are not in a live region. `role="status"` exists on the tracking banner
    and the status bar (sync and tracker status), so a newly registered match is not announced.
  - Esc does not cancel the end-session confirm (there is no key handler).
  - In companion mode the start button lives inside the checklist, which unmounts on start, so
    keyboard focus falls back to the page.
- **Keyboard:** reachable, but the order is long because each overlay contributes four stops
  (URL field, Copy, Preview, Configure). `current-ui-notes.json` records an observed order. The
  capture began mid-page, so it is a partial order, not a full audit.

### Data constraint discovered (important for both directions)

There is **no per-match MR history**:

- matches ingested from the battlelog carry `ratingAfter: null` (`parse.ts`);
- `player_character_rating` keeps only the latest observation;
- `session_character_baseline` keeps the initial and final values.

So an "MR journey" chart, or "MR after each match" in a list, **cannot be built from today's data**.
The prototypes show it only behind a visible **CONCEPTO** tag. Building it needs a new,
append-only observation log (see `implementation-plan.md`).
