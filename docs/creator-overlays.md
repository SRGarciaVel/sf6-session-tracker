# Creator Beta — advanced overlay customization

RFC 0001 **Phase 4** ([§11.3](rfc/0001-sst-open-core-multigame.md#113-first-creator-value-advanced-overlay-customization-direction-not-a-contract)):
the first capability exclusive to Creator Beta.

**No existing Free overlay capability was moved behind Creator Beta.**

## What stays Free (every option that existed before Phase 4)

| Area                     | Options                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Themes                   | `minimal`, `competitive`, `fighter` (Street)                                                                  |
| Canvas presets           | compact 600×120, standard 800×180, detailed 900×240                                                           |
| Stats shown (10 toggles) | wins, losses, win rate, rating, rating delta, rank, win streak, best streak, total games, recent form         |
| Text                     | title on/off, custom title (≤ 24), overlay language, rating character (active or pinned)                      |
| Typography               | 8 bundled fonts (Barlow Condensed, Barlow, Chakra Petch, Rajdhani, Oswald, Bebas Neue, Inter, JetBrains Mono) |
| Colors                   | text, muted, accent, win, loss, background (+ opacity), border                                                |
| Frame                    | border on/off, width 0–8, radius 0–40                                                                         |
| Layout                   | scale 0.5–2×, spacing (tight/normal/relaxed), alignment, animations                                           |
| Limits                   | up to 10 overlays (unchanged for every plan)                                                                  |

## Creator options (new; `config.creator`)

| Option               | Values                                                 | Effect                                                                                                                          |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `secondaryAccent`    | `#rrggbb` or `null` (= theme look)                     | partner color of the accent sweeps (Minimal underline, Competitive top strip) and the Street theme's second slash and underline |
| `numberFont`         | one of the 8 bundled fonts, or `null` (= same as text) | font of the numbers only; labels keep the base font                                                                             |
| `numberScale`        | 0.85–1.25                                              | size of the numbers relative to the labels. The renderer's fit-to-box keeps every canvas from overflowing                       |
| `show.labels`        | boolean                                                | stat labels (the title has its own Free toggle; Minimal has no labels)                                                          |
| `show.units`         | boolean                                                | W/L/MR/LP units                                                                                                                 |
| `show.characterName` | boolean                                                | character name next to the rating                                                                                               |
| `show.decorations`   | boolean                                                | decorative bars and strokes                                                                                                     |

These don't duplicate any Free option. Stat visibility is the Free `fields` toggles; these switches
are visual elements. The schema is strict:

- hex colors only;
- an enum of bundled fonts;
- a bounded number;
- unknown keys rejected.

There's no custom CSS, no `style`, no URLs, no fonts by URL and no HTML. Values reach the
renderer only as validated CSS custom properties and `.ov-c-*` classes (CEF/OBS-safe).

## Stored vs effective config

```
stored config (overlay.config JSON)          ── never mutated by plan changes
        │  getEffectiveOverlayConfig(stored, ownerEntitlements)   (pure, domain/overlay/creator.ts)
        ▼
effective config  ── dashboard preview, overlay builder preview, OBS page, /state, SSE
```

- **Entitled** (`overlays.advancedCustomization`): the `creator` block applies.
- **Not entitled:** the block is ignored and the theme's own look renders. A test proves this
  render is **identical** to the same theme without customization, for all three themes; the OBS
  screenshots are byte-identical. The stored block is kept for when access returns.
- **No migration:** `creator` is optional in the existing JSON config. Old configs read exactly as
  before, and a malformed stored block is dropped on read without affecting the overlay.

## Server-side enforcement

- **Save** (`saveOverlayAction` → `prepareOverlayConfigForSave`):
  - the base options come from the request;
  - the `creator` block comes from the request **only if the owner is entitled**; otherwise the
    stored block is kept untouched.
  - So a Free account can edit language, theme or title after a downgrade **without losing** its
    Creator style, and a crafted request can't add or change Creator values.
  - The editor's locked controls are only a convenience.
- **Public render** (`resolveEffectiveOverlayConfig`): `overlay.player_id → sf6_player.user_id →
getEntitlements(owner)`.
  - Never the viewer, and never "it was valid when saved".
  - Resolved on every payload build: the OBS page, `/state`, and every SSE push (live and overlay
    events), plus a check every ~5 min for quiet overlays.
  - An expired grant (`entitlement_grant.expires_at`) falls back on the next push with no cron
    and no write.
- **Nothing extra in the public payload:** a Free owner's stored block isn't sent, and plans or
  entitlements are never included.

## Downgrade and renewal

1. Creator saves a style.
2. Creator Beta expires: OBS falls back to Free on the next push. The editor shows "Your Creator
   customization is saved. Renew Creator access to use it again." with the controls read-only.
3. Free edits base settings and saves: the Creator block stays stored (integration-tested).
4. Renewed (new Creator Key or an operator grant): the same style renders again unchanged.

"Reset Creator customization" (entitled only) deletes the block on purpose.

## Threat model

| Threat                             | Mitigation                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Free client posting Creator values | merged server-side with the owner's entitlements; stored block kept; tested                                                     |
| Expired Creator still rendering    | entitlements resolved per payload/push; periodic SSE re-check; tested with an expired grant                                     |
| Viewer influencing entitlements    | the public path has no viewer identity; resolution uses the overlay's owner only                                                |
| Malformed values / CSS injection   | strict zod schema (hex, enum, bounded number, no extra keys); renderer emits fixed classes and validated custom properties only |
| Oversized config                   | bounded fields; strict object; the existing body/size validation of the save action                                             |
| Cross-user editing                 | unchanged ownership check (`getOwnedOverlay`, IDOR tests)                                                                       |
| Downgrade data loss                | stored config never mutated by plan changes; Free saves keep the block                                                          |
| Stale entitlements                 | no cross-request cache; at most one SSE push or ~5 min                                                                          |

## Open-core boundary

| Core (public, MIT)                                           | Creator module candidate                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Overlay model, the 3 themes, renderer, base validation       | `domain/overlay/creator.ts` (schema, effective rule, save merge) |
| The optional `creator` slot in the config schema             | `components/overlay/creator-style.ts` + the `.ov-c-*` CSS block  |
| `getEffectiveOverlayConfig()` contract and the Free fallback | `CreatorCustomizationSection.tsx` (builder UI)                   |
| Entitlement resolver and `overlays.advancedCustomization`    | future premium presets and themes                                |

**The split is real but not worth doing yet.** The Creator code is ~4 small files behind 3 seams:

- the config slot;
- the effective-config function;
- the builder section.

Moving it to a private package now would add build and CI cost for code whose value is UX polish,
not secrecy. **Recommendation:** create the private `sst-creator` module when the first asset with
real commercial value that should not be public exists, such as a premium theme catalog or
designed presets. At that point, move:

- `creator.ts`, `creator-style.ts` and the `.ov-c-*` CSS;
- `CreatorCustomizationSection.tsx`;
- the new premium assets.

Core keeps the slot, the contract and the fallback.

## Known issues (not changed here)

- **Overlay limit race:** the 10-overlay check is count → check → create, so two concurrent
  creations at 9 could both pass. This predates Phase 4 and is tracked as a follow-up
  (transaction or advisory lock).
- **Overlay builder at ~390 px:** the builder's form column is wider than the viewport. This
  predates Phase 4; the page measures the same with the Creator section removed.
