# Overlay builder

`/dashboard/overlays/[id]` is a focused visual editor. Phase 4.9 reorganised it without adding
capabilities: the same options, themes, entitlements and server actions.

## Layout

```
┌ header (sticky ≥ lg) ─ ← Panel · Configurar overlay [name] ── state · Descartar · Guardar ┐
├ editor (tabs) ─────────────────────┬ preview (sticky ≥ lg) ─────────────────────────────┤
│ Apariencia · Contenido · Estilo ·  │ [Lienzo ▾] [− Ajustar +] [Alfa|Oscuro|Claro]        │
│ Creator                            │  REAL overlay (effective config)                    │
│                                    │  sample data / sample rank                          │
│                                    ├ OBS Browser Source ──────────────────────────────────┤
│                                    │  URL · Copiar URL (✓ Copiado) · Abrir overlay ↗      │
│                                    │  ▸ Más acciones (regenerate URL, delete overlay)     │
└────────────────────────────────────┴──────────────────────────────────────────────────────┘
```

- **≥ 1024 px:** two columns (editor 26 rem, preview fills the rest). Only the builder header
  and the preview column stick. The page itself scrolls normally.
- **< 1024 px:** one column. The preview and OBS block come **first**, the editor below,
  nothing sticky. While there are unsaved changes, a small bottom bar shows the state and
  **Save**. There's no horizontal overflow at 390 px.

## Information architecture

| Tab            | Contents                                                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apariencia** | theme picker, then the selected Creator theme's **variants** right below it (contextual)                                                                                                                                                                   |
| **Contenido**  | visible stats (Session: W, L, win rate, games, streak, best, recent form · Rating & rank: MR/LP, change, rank) with show all / hide all; title + visibility; **session statistics** (shown stats + displayed character); overlay language                  |
| **Estilo**     | text font; core colours (text, labels, accent); results (win, loss); background (colour + opacity); border (toggle, colour, width, radius); size & layout (scale, spacing, alignment, animations); "reset the theme's style"                               |
| **Creator**    | one Creator Beta badge, one entitlement/renewal notice, **presets** first, then advanced styling: number typography (font, size) · accent (secondary colour) · visibility (labels, units, character name, decorations) · Movement · **Character rotation** |

**Movement** (Phase 5.0, Creator tab) holds:

- the "Use Creator motion" switch;
- motion style, intensity, result emphasis, accent motion, and rank reaction.

Rank reaction is disabled with a note on themes without the emblem. The group is disabled without
`overlays.motionEffects`; stored values stay visible and are kept. The tab's single notice covers
it.

**Presentación automática** (Phase 5.3A; formerly "Rotación de personajes", Phase 5.2; Creator
tab, `overlays.characterRotation`). Phase 5.3A adds:

- **Modo de presentación:** Solo personajes · Sesión + personaje activo · Sesión + todos los
  personajes, each with a contextual hint.
- **Tipo de transición:** a select (Fundido · Deslizamiento · Barrido · Instantánea).
- **Dirección** (Izquierda · Derecha · Arriba · Abajo, "side the new view enters from"): only
  for Deslizamiento and Barrido.
- **Orden de personajes:** hidden in "Sesión + personaje activo", where it has no effect.
- **Secuencia:** the actual cycle ("Sesión → Ryu → Sesión → Chun-Li …"), from the same domain
  functions the overlay runs.
- **A note in mixed modes** on how views are identified (title label, custom title kept) and on
  the session view's rating.

Every option marks unsaved changes; saving clears them. The 5.2 controls below remain:

- **Rotación automática.** While it's off, only the switch and a one-line summary show
  (progressive disclosure).
- **When on:**
  - interval (5–30 s);
  - transition (Fundido · Deslizamiento · Instantánea);
  - order (más recientes · más jugados · alfabético);
  - "Priorizar personaje de la última partida", plus its duration (10–60 s). The duration is
    disabled with an explanation when priority is off.
- **Personajes incluidos:** the characters that would rotate now, from the live state, else the
  sample, which is labelled. 0-game characters never appear; with none, an explicit empty state
  shows.
- **Pinned character:** when one is pinned, a note explains that rotation replaces it temporarily
  and that turning rotation off brings it back. Contenido's character selector shows the same
  hint while rotation is effective.
- **Free:** the group is visible but disabled, with "Creator Beta requerido". A stored rotation
  is covered by the tab's single notice and kept (server merge).
- **Dirty state:** every option marks unsaved changes, and saving clears them.

**Marca SST** (Phase 5.3B, Creator tab, `overlays.brandFlag`):

- **Mostrar logo SST:** while it's off, only the switch and a one-line explanation show.
- **When on:**
  - Estilo de aparición: Pestaña periódica · Insignia fija;
  - Posición: Izquierda · Derecha;
  - for the periodic tab only: Frecuencia (with the "time between appearances" definition),
    Tiempo visible and Animación. With overlay animations off, a note says the reveal is
    instant;
  - Logo (Monograma · Logo completo, both official) and Color (Del tema · Acento Creator);
  - a note that the overlay reserves the tab's space so it never leaves the canvas.
- **Free:** the group is disabled with "Creator Beta requerido". A stored flag is covered by the
  tab's single notice and kept.
- **Dirty state:** every option marks unsaved changes.

**Probar aparición** (preview, preview-only) appears when the effective config has a periodic
tab. Each click increments a local signal the **real** controller in the overlay consumes: one
reveal now, retract after the visible time, then the normal cycle. No API, save, session or SSE
is involved, and there's no second animation implementation.

**Probar presentación** (formerly "Probar rotación"; preview, Creator only, preview-only) uses the Phase 5.1 multi-character
sample: Chun-Li, Jamie and Ryu rotate; Cammy (0 games) doesn't.

- **Simulating a match:** in test mode, the Phase 5.0 Victoria | Derrota control gets a
  "Personaje" select and "Simular partida". Each click appends a match to the sample, which is
  re-run through the engine. Totals, the active character, the recent order and the rating all
  update, and priority plus Creator Motion behave as with a real match.
- **Exiting:** "Salir de la prueba" (or the sample-data switch) ends the test, and the rotation
  timers stop with it.
- **Isolation:** no API, DB, SSE, session or config write.
- **Without the test:** an entitled overlay with rotation enabled already rotates in the preview
  (effective config), so edits show immediately.

**Estadísticas de sesión** (Phase 5.1, Contenido tab, Free) holds:

- **Estadísticas mostradas:** _Sesión completa_ (default: every match of the session, all
  characters) or _Personaje mostrado_ (only the matches of the character whose rating is shown).
  A contextual hint under the select explains the current choice.
- **Personaje mostrado:** the existing character selector (active character, or a pinned one).
  With character scope its hint says the stats follow it too.

Both are content, saved like any edit (dirty, then saved). The visible-stat toggles are
unchanged and apply to whichever numbers are shown.

**Sample data** is a multi-character session built by the engine (`sample-session.ts`):
Chun-Li 2-1, Jamie 3-5, Ryu 9-8, Cammy unplayed, 14-14 in total. A preview-only **sample
character** select (shown with sample data) chooses the active character, so both scopes can be
checked, including a character with 0 games. It is never saved.

**Play update** (preview, below the toolbar, preview-only) offers Victoria | Derrota and
"▶ Reproducir actualización":

- **Data:** a local before → after pair (`preview-simulation.ts`: 11-5 → 12-5, +96 MR, streak
  3 → 4; or 11-5 → 11-6, −72 MR). It shows the "before" state for 450 ms, then the update lands.
- **Afterwards:** the final state stays. Playing again restarts from "before". "Salir de la
  simulación" (or the sample-data switch) returns to sample or live data.
- **Stats scope:** the simulated states have one character (Ryu), so session and character
  scope show the same numbers and both play the effect.
- **Isolation:** no API, session, config or SSE change. A status line announces the result.
  With reduced motion the values jump straight to the final state.

**Canvas** lives in the preview toolbar because it is the OBS Browser Source size. It is saved,
and the toolbar says so. Options a theme doesn't support are disabled (theme registry).
**Zoom** (fit, 50–150 %), **background**, **sample data**, **sample character** and **sample rank** are preview-only
state inside `PreviewPane`. They never enter the overlay config.

Tabs follow the WAI-ARIA pattern: `role="tablist"`, arrow keys, Home and End. Inactive panels
stay mounted but `hidden`, so edits and focus order are kept.

## Theme picker

- The six themes are grouped **Free** and **Creator Beta**. One badge goes on the group, not on
  each card.
- Cards are **real radio inputs** (one group), so arrow keys and Tab work natively and focus is
  visible.
- For Free accounts, Creator themes are visible but disabled, with one note and a link to
  redeem a key. A stored Creator theme after a downgrade shows "Your Creator theme “…” is saved…".
- Only the selected theme's description is shown.
- Thumbnails are the real renderer at the 800×180 canvas scaled to 0.21. They're memoised on
  `(theme, locale)`, so editing never re-renders them.

## State, dirty and saving

- **One canonical editable config:** the stored shape, including any Creator block, premium
  theme or variants the owner can't currently use.
- **Dirty:** `isDirty()` compares canonical JSON (sorted keys, no `undefined` members) of
  `{name, config}` against the last saved snapshot. Key order or absent optional blocks never
  count as a change.
- **Save state** in the header (`role="status"`):
  - **Guardado ✓** — nothing to save;
  - **Cambios sin guardar** — the config or name differs from the last save;
  - **Guardando…** — a save is in flight;
  - **Error al guardar** — the server refused the save or was unreachable.

  On failure the reason is shown and **edits are kept**, so the user can retry.

- **Discard** restores the last saved snapshot.
- **Leaving with changes:**
  - the browser warns on reload or tab close (`beforeunload`, only while dirty);
  - the in-app "← Panel" link asks "Keep editing / Leave without saving".
- **Presets:** applying a preset saves it to the overlay server-side, and the returned config
  becomes the new saved snapshot.
- There's no autosave and no undo/redo.

## Stored vs effective (unchanged rules)

The preview renders `getEffectiveOverlayConfig(config, owner entitlements)`, exactly what OBS
renders. The editor always sends the **stored** config back, and the server
(`prepareOverlayConfigForSave`) keeps Creator values the owner can't use. So a Free save after a
downgrade never erases:

- a stored premium theme;
- its variants;
- the Creator block.

This is browser-verified: a Free title edit kept `theme: prestige`, the secondary accent and the
variants. Presets, themes and Creator styling are still enforced only on the server; the UI's
disabled controls are a convenience.

## OBS output

- The URL is read-only and selected on focus.
- **Copiar URL para OBS** uses `CopyButton`: Clipboard API with fallback, visible "✓ Copiado",
  and an `aria-live` announcement.
- **Abrir overlay ↗** opens a new tab (`rel="noopener noreferrer"`).
- A one-line OBS hint gives the canvas size.
- **Regenerate URL** and **delete overlay** sit in a collapsed "Más acciones" area with inline
  confirmation.

## Reset

| Control                                   | Effect                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ↺ next to a colour                        | back to the current theme's value (existing resolver: theme meta, then defaults)                                                      |
| Reset the theme's style (Style tab)       | `applyThemeDefaults` for the current theme, keeping the canvas. Stats and title are unchanged. Inline confirmation, local until saved |
| Reset Creator customization (Creator tab) | removes the Creator block, as before                                                                                                  |

## Tests

- `builder-state.test.ts`:
  - canonical dirty state (key order, `undefined`);
  - saved snapshot, then clean again;
  - Free-safety of base edits;
  - stat groups cover every field once;
  - colour reset resolver, Creator block creation, zoom steps.
- `creator-suite-ui.test.tsx` (server render):
  - the radio group covers every registered theme;
  - Free locking with one badge and one note;
  - the downgrade message;
  - presets selector and downgrade (delete only);
  - Creator panel: one notice, controls disabled for Free;
  - full builder: 4 tabs and panels, starts "saved", sticky preview only ≥ lg, preview first
    in source order, Free stored premium previews its fallback, OBS link attributes.
- **Browser QA** (production build, 1440 / 1280 / 1024 / 768 / 390, Free and Creator):
  - no overflow;
  - keyboard tabs;
  - preview stays sticky while the editor scrolls;
  - dirty, then saved, with the DB updated;
  - forced network failure: "failed", edit kept, DB unchanged;
  - copy feedback;
  - mobile save bar;
  - Free downgrade save keeps stored Creator data.

## Stats scope (Phase 5.1)

| Question                    | Answer                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Which character?            | The one whose rating is shown: the pinned `ratingCharacterKey`, else the active character. Rating and stats always refer to the same one.   |
| Where are the numbers from? | The session engine: `computeSessionStats` over that character's matches. The renderer never counts anything.                                |
| Streaks                     | Per character. A loss with another character doesn't end this character's streak. Draws end it, as in the global stats.                     |
| Recent form                 | The last 10 results of that character only.                                                                                                 |
| Character with 0 games      | 0-0, 0 %, no streak, no form. Its rating (if known) is still shown.                                                                         |
| Character not available     | Neutral zeros and "—" for the rating. Never the global numbers.                                                                             |
| Old overlays                | No `statsScope` stored ⇒ `"session"`: unchanged. No migration.                                                                              |
| Plan                        | Free. Not an entitlement, and the effective config never drops it.                                                                          |
| Presets                     | Not stored in presets (content, like the rating character). Applying a preset keeps the overlay's scope.                                    |
| Creator Motion              | Changing scope, character, theme, locale, canvas or font plays nothing. Real matches still play, in either scope.                           |
| Phase 5.2 (rotation)        | Rotation will only change which character is projected. `resolveOverlayStats` already takes any character, so no new stats logic is needed. |

## Character rotation tests (Phase 5.2)

- `domain/overlay/rotation.test.ts` (pure): eligibility, the three orders and tie-breaks,
  next/wrap, roster add/remove, resume, the match signal, schema strict/lenient, stored vs
  effective, save merge, presets, stats coherence and the Motion detector in rotation mode.
- `components/overlay/rotation-controller.test.tsx` (happy-dom, fake timers):
  - timers: one at most, no restarts on repeated snapshots, cleanup on off/unmount, none with
    0–1 characters;
  - priority: start, restart, replace, disabled, resume;
  - session restart, stale → current snapshots (also during priority; `LiveOverlay` included);
  - coherence: stats, rating, rank and delta;
  - Creator Motion events;
  - instant with animations off or reduced motion;
  - all six themes;
  - a 150-step long run with constant DOM and one timer.
- `creator-suite-ui.test.tsx` / `builder-state.test.ts`: the group (Free disabled, Creator
  enabled, progressive disclosure, priority dependency, pinned note, empty state), "Probar
  rotación" for Creator only, the preview's no-server source check, and dirty state for every
  option.
- Integration (`creator-overlay-suite`, `multi-character`): the entitlement lifecycle (Free
  crafted request, enable, expiry, Free edit, renewal, revocation, presets) and rotation inputs
  from real ingestion (eligible characters, order, priority signal, global vs individual stats).

## Presentation modes tests (Phase 5.3A)

- `domain/overlay/rotation.test.ts` covers:
  - every mode's cycle, view building and identity;
  - session-only and session + one character (two views ⇒ a timer);
  - orders sorting only character views, wrap-around, roster add/remove;
  - active-character changes and fallback;
  - priority, resume, repeats and new sessions;
  - stale snapshots in every mode;
  - config defaults, leniency and strictness;
  - entitlements, downgrade, renewal and presets.
- `domain/overlay/presentation.test.ts` covers the projection:
  - the session view is global even with a "character" scope;
  - character views use their own stats;
  - the stored `statsScope` / `ratingCharacterKey` / title are never mutated;
  - no invented global rating (active character by name, else a placeholder);
  - view labels, and the custom title kept.
- `components/overlay/presentation-modes.test.tsx` (happy-dom, fake timers):
  - controller: one timer, cleanup, interval/mode/transition/direction changes, priority, resume,
    repeats, the **critical stale → current → real match** sequence, new and ended sessions;
  - Creator Motion across views;
  - reduced motion and animations off;
  - six themes with view identification, custom title, transitions × directions, fit-to-box;
  - a 160-step long run.
- Builder UI and dirty state, plus integration: views built from the **public** payload of a
  real ingested session, per-view stats, priority via `sessionIdentity`, and the
  mixed-mode entitlement lifecycle.

## SST Brand Flag tests (Phase 5.3B)

- `domain/overlay/brand-flag.test.ts`: defaults, strict writes, every option, lenient reads, old
  configs, timer semantics, entitlements (independent), forged Free saves, downgrade/renewal and
  presets.
- `components/overlay/brand-flag-runtime.test.tsx` (happy-dom, fake timers):
  - controller: hidden → reveal at one interval → visible time → repeat, one timer, cleanup,
    static badge, mode/interval changes, cosmetic changes not restarting, repeated snapshots and
    matches, preview reveal, reduced motion / animations off;
  - renderer: official geometry and lockup, positions, slot beside the panel, colour modes, all
    six themes, no flag ⇒ the old DOM;
  - independence: rotation off/characters/session-active/session-all, Creator Motion and
    priority, the real OBS public payload with repeated and stale snapshots, a 120-cycle long run.
- Builder UI, dirty state and the integration lifecycle (Free forged request, Creator, preset,
  expiry, Free edit, renewal).
