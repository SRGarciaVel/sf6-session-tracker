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

| Tab            | Contents                                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apariencia** | theme picker, then the selected Creator theme's **variants** right below it (contextual)                                                                                                                                     |
| **Contenido**  | visible stats (Session: W, L, win rate, games, streak, best, recent form · Rating & rank: MR/LP, change, rank) with show all / hide all; title + visibility; overlay language; rating character                              |
| **Estilo**     | text font; core colours (text, labels, accent); results (win, loss); background (colour + opacity); border (toggle, colour, width, radius); size & layout (scale, spacing, alignment, animations); "reset the theme's style" |
| **Creator**    | one Creator Beta badge, one entitlement/renewal notice, **presets** first, then advanced styling: number typography (font, size) · accent (secondary colour) · visibility (labels, units, character name, decorations)       |

**Movement** (Phase 5.0, Creator tab) holds:

- the "Use Creator motion" switch;
- motion style, intensity, result emphasis, accent motion, and rank reaction.

Rank reaction is disabled with a note on themes without the emblem. The group is disabled without
`overlays.motionEffects`; stored values stay visible and are kept. The tab's single notice covers
it.

**Play update** (preview, below the toolbar, preview-only) offers Victoria | Derrota and
"▶ Reproducir actualización":

- **Data:** a local before → after pair (`preview-simulation.ts`: 11-5 → 12-5, +96 MR, streak
  3 → 4; or 11-5 → 11-6, −72 MR). It shows the "before" state for 450 ms, then the update lands.
- **Afterwards:** the final state stays. Playing again restarts from "before". "Salir de la
  simulación" (or the sample-data switch) returns to sample or live data.
- **Isolation:** no API, session, config or SSE change. A status line announces the result.
  With reduced motion the values jump straight to the final state.

**Canvas** lives in the preview toolbar because it is the OBS Browser Source size. It is saved,
and the toolbar says so. Options a theme doesn't support are disabled (theme registry).
**Zoom** (fit, 50–150 %), **background**, **sample data** and **sample rank** are preview-only
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
