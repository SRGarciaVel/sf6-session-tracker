# Creator Beta — overlays

- RFC 0001 **Phase 4** ([§11.3](rfc/0001-sst-open-core-multigame.md#113-first-creator-value-advanced-overlay-customization-direction-not-a-contract)):
  advanced overlay customization.
- **Phase 4.5 — Creator Overlay Suite:**
  - premium themes;
  - rank-aware styling;
  - theme variants;
  - reusable presets ([creator-presets.md](creator-presets.md)).

**No existing Free overlay capability was moved behind Creator Beta.**

## What stays Free (every option that existed before Phase 4 and 4.5)

| Area                     | Options                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Themes                   | `minimal`, `competitive`, `fighter` (Street)                                                                                            |
| Canvas presets           | compact 600×120, standard 800×180, detailed 900×240                                                                                     |
| Stats shown (10 toggles) | wins, losses, win rate, rating, rating delta, rank, win streak, best streak, total games, recent form                                   |
| Text                     | title on/off, custom title (≤ 24), overlay language, rating character (active or pinned), stats scope (session or character, Phase 5.1) |
| Typography               | 8 bundled fonts (Barlow Condensed, Barlow, Chakra Petch, Rajdhani, Oswald, Bebas Neue, Inter, JetBrains Mono)                           |
| Colors                   | text, muted, accent, win, loss, background (+ opacity), border                                                                          |
| Frame                    | border on/off, width 0–8, radius 0–40                                                                                                   |
| Layout                   | scale 0.5–2×, spacing (tight/normal/relaxed), alignment, animations                                                                     |
| Limits                   | up to 10 overlays (unchanged for every plan)                                                                                            |

Phase 4.5 changes none of these. The three Free themes keep every canvas, and the builder only
adds a visual picker on top of them.

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

## Creator themes (Phase 4.5; `overlays.premiumThemes`)

The registry lives in `src/domain/overlay/themes.ts` (typed, no plugin framework). Each entry
declares:

- id and tier;
- supported canvases;
- a deterministic Free fallback;
- `rankAware`.

Labels, descriptions and previews live in the ES/EN catalogs and the builder thumbnails.
Variant schemas are in `variants.ts`, and renderers in `components/overlay/creator-themes.tsx`.

| Theme       | Canvases                    | Free fallback | Rank-aware | Composition                                                                                                                                           |
| ----------- | --------------------------- | ------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rank-card` | standard, detailed          | `competitive` | yes        | Rank-led card. Emblem column (tier color band and edge) next to a large MR/LP with delta, then a ruled stats row. Hierarchy: rank → rating → session. |
| `broadcast` | compact, standard, detailed | `minimal`     | no         | Flat TV lower third. Title tab (line or block accent) followed by labelled segments split by rules. Square edges, no skew or glow.                    |
| `prestige`  | standard, detailed          | `fighter`     | yes        | Symmetric, ornamental. Double frame with corner diamonds and a top rule, centered emblem and rank name, record and win rate on the flanks.            |

The three differ in composition, hierarchy, frame, spacing, density, typography defaults and
decoration. They aren't recolors of the Free themes. A Free `clean` theme was **not** added: it
would have inflated scope without a clear gap in the Free set.

**Canvases.** The builder only offers the canvases a theme declares. If a Creator theme is stored
on another canvas (crafted request, or a Free canvas edit after a downgrade), the effective config
uses the theme's first supported canvas. The result is always deterministic.

### Theme variants (`config.variants`, per theme, kept when switching themes)

| Theme       | Variant          | Values                   | Effect                                    |
| ----------- | ---------------- | ------------------------ | ----------------------------------------- |
| `rank-card` | `density`        | compact · normal         | padding and gaps                          |
|             | `badge`          | normal · large           | emblem size                               |
|             | `glow`           | off · subtle · strong    | emblem drop-shadow in the tier color      |
|             | `background`     | translucent · solid      | user background with or without opacity   |
| `broadcast` | `separators`     | subtle · strong          | segment rules                             |
|             | `accent`         | line · block             | title tab style                           |
|             | `density`        | compact · normal         | segment padding                           |
| `prestige`  | `glow`           | subtle · normal · strong | emblem and rank glow                      |
|             | `frame`          | subtle · normal          | frame color (neutral or tier)             |
|             | `animatedAccent` | boolean                  | CSS sheen on the top rule (see OBS below) |

Variants use enums and booleans only: `z.strictObject`, unknown keys and values rejected. A
broken stored entry falls back to that theme's defaults. They reach the renderer only as fixed
`ov-rc-*`, `ov-bc-*` and `ov-pr-*` classes.

### Rank-aware styling

- **Input:** only data SST already stores, i.e. the rank label Capcom returns for the shown
  character (e.g. `Diamond 1`, `Master`) and the system (`mr` exists only at Master). Ratings
  stay per character, and the rank is that character's rank.
- `src/domain/sf6/rank-prestige.ts` (the game module) maps it to a generic
  `{ family, level 0–6, color, division }`. The hierarchy follows SF6:
  - Rookie/Iron/Bronze → 1;
  - Silver/Gold → 2;
  - Platinum → 3;
  - Diamond → 4;
  - Master → 5;
  - High/Grand/Ultimate Master → 6, only if the label says so.
- Unknown labels never invent a tier: they fall back to the system, else `unranked`.
- The generic theme layer only sees `level` and a fixed `#rrggbb` color (`--ov-tier`, from a
  constant table), never SF6 strings. Nothing from Capcom or the user becomes CSS (tested with
  forged labels).
- **Privacy of the rank:** with the Free `rank` field off, the emblem is a neutral accent gem.
  Color and tier reveal nothing.
- **Emblem:** SST-native CSS. A faceted hexagonal gem shows the division. Pips mark lower tiers,
  a ring marks Master, and wings mark Master extensions.

### Visual references policy

The LoL/TFT overlays, LoL rank cards and the SF6 rank-pyramid images shared for this phase are
**inspiration only** (hierarchy, density, how prestige is signalled).

- No layout, artwork, icon, emblem, font or color set was copied, traced, scraped or downloaded.
- SST ships **no official Capcom or Riot assets**.
- Rank names appear only as the data Capcom returns for the player, like MR/LP.

### OBS / CEF safety

- Hand-written CSS: no Tailwind, `oklch()`, `color-mix()`, container queries or `:has()`.
- No remote fonts or images, WebGL or JS animation loops.
- The Prestige sheen:
  - is one CSS `transform` keyframe on a pseudo-element, optional via `animatedAccent`;
  - is off when overlay animations are off, and with `prefers-reduced-motion`.
- Fit-to-box now has a convergence guard. At very small Browser Sources (≈ under 280 px wide),
  pixel-snapped borders made Prestige ping-pong and crash; a regression check covers 140×32 to
  1920×1080 for all six themes.

## Creator motion & broadcast effects (Phase 5.0; `overlays.motionEffects`)

Motion makes the overlay react **once** to a meaningful data change, as broadcast polish rather
than effects spam. It's a new, independent entitlement (`overlays.motionEffects`: Free `false`,
Creator Beta `true`), not reused from `advancedCustomization`.

**Free keeps every animation it had.** Numbers still tick and glow on change under the Free
"Animate changes" switch. Creator motion is purely additive.

**Schema:** `config.creator.motion`, optional and strict (`domain/overlay/motion.ts`). There are
no durations, CSS or free-form values.

| Key              | Values                     | Default | Effect                                                                                                                               |
| ---------------- | -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `updateStyle`    | snappy · smooth · impact   | snappy  | pace and easing of the number tick and every one-shot effect (260 / 520 / 620 ms)                                                    |
| `intensity`      | subtle · normal · strong   | normal  | magnitude only: lift, scale (≤ 1.12), glow, sweep opacity                                                                            |
| `resultEmphasis` | boolean                    | true    | after a completed match the MR/LP delta lifts and glows once in the win/loss colour (the value, sign and arrow stay the information) |
| `accentMotion`   | static · pulse · sweep     | pulse   | pulse = the theme's accent element brightens once; sweep = one band crosses the panel                                                |
| `rankMotion`     | none · subtle · emphasized | subtle  | the SST rank emblem scales and glows once when rating/rank changed (themes with an emblem: Rank Card, Prestige)                      |

**When it plays.** `detectOverlayChange(prev, next)` compares data only: session id, displayed
character, games, wins, losses, rating, rank and streak.

| Case                                                                          | Event                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| First render, identical data (any re-render, resize, fit-to-box pass, locale) | none                                                                |
| Theme, colour, font, canvas or other config edits                             | none                                                                |
| New session, different displayed character, fewer games                       | none: shown, nothing plays                                          |
| Games grew                                                                    | a **match** event: win if wins grew, loss if losses grew, else draw |
| Rating/rank changed without a new match                                       | an update without result emphasis                                   |

Results come only from counters the backend already sends; nothing is inferred from colour or
MR alone. Events are derived during render (no effect loop), cleared after the effect by one
timer, and identified by a stable data key, so the same data never plays twice. SSE is unchanged
because consecutive states are enough.

**Per theme** (shared CSS rules, different targets):

| Theme       | Behaviour                                                                   |
| ----------- | --------------------------------------------------------------------------- |
| Minimal     | number ticks + accent bar pulse                                             |
| Competitive | HUD snap + tag pulse / panel sweep                                          |
| Street      | slash pulse, badge emphasis                                                 |
| Rank Card   | emblem reaction + rating emphasis + band pulse                              |
| Broadcast   | title-tab pulse or clean sweep                                              |
| Prestige    | emblem + top-rule pulse (its optional sheen loop is separate and unchanged) |

**Implementation (OBS-safe).**

- CSS one-shots animate `transform`, `opacity` and `filter` on small inner elements, never the
  measured fit-to-box root.
- The sweep is one absolutely positioned `aria-hidden` element per update, re-mounted per event.
- Persistent elements alternate between two identical keyframe names per update, so a new update
  restarts them.
- There are no loops, rAF, canvas or WebGL.
- Root `data-motion-*` / `data-update` attributes and fixed `--ovm-*` token variables drive
  everything.

**Reduced motion / animations off.** `motionProfile()` returns nothing, so no attributes and no
effects render, but data updates immediately. The CSS is additionally wrapped in
`prefers-reduced-motion: no-preference`.

**Stored vs effective.** This is the same pipeline as everything else.

- Without `motionEffects`, `getEffectiveOverlayConfig` drops `creator.motion` (customization and
  motion are gated independently).
- The save merge keeps the stored motion for Free saves (a crafted Free request can't add or
  change it) and takes it from the request only for entitled owners.
- Presets carry motion as part of the Creator block. Apply is refused without the entitlement.
- **Lifecycle:** expiry → OBS shows no motion on the next payload; a Free edit keeps the stored
  motion; renewal restores it. This is integration-tested against Postgres.

**Rollback.** Older code parses `creator` with a strict schema. An unknown `motion` key makes the
old parser drop the whole stored Creator block **on read** (no write happens until a save). Map
it out first if rolling back after users saved motion:

```sql
update overlay set config = config #- '{creator,motion}' where config->'creator' ? 'motion';
```

**Measured:** 60 consecutive simulated updates in one preview kept the DOM at 755 → 755 nodes and
the heap at 7.7 → 8.0 MB, with no leftover `data-update` or sweep element. Builder previews at
600×120, 800×180 and 900×240 showed no clipping.

## Stored vs effective config

```
stored config (overlay.config JSON)          ── never mutated by plan changes
        │  getEffectiveOverlayConfig(stored, ownerEntitlements)   (pure, domain/overlay/creator.ts)
        ▼
effective config  ── dashboard preview, overlay builder preview, OBS page, /state, SSE
```

- **Entitled** (`overlays.advancedCustomization`): the `creator` block applies.
- **Creator theme without `overlays.premiumThemes`:** the registered Free fallback renders, with no
  variants and nothing else changed. The renderer test proves the markup is **identical** to
  that Free theme with the same config. The stored theme and variants are kept.
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
  - **Themes (4.5):** without `premiumThemes`, a Creator theme in the request is accepted only if
    it is **already the stored theme** (the editor sending back what it loaded). A never-stored
    one, or a different Creator theme, keeps the stored theme. Variants keep their stored values.
    An explicit switch to a Free theme is a Free choice and is saved. Entitled saves normalize
    the canvas to one the theme supports.
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

**Phase 4.5 lifecycle** (integration-tested and verified in the browser and OBS):

1. A Creator saves `rank-card` with variants; OBS renders it.
2. Expiry: OBS renders `competitive` on the next push and the DB is untouched.
3. Free edits the title and saves: the stored `rank-card` and variants are kept.
4. Renewal: `rank-card` and its variants return with the new title.

A crafted Free save with a never-stored `prestige` doesn't install it. The builder marks the stored
Creator theme with "Your Creator theme “…” is saved. Renew Creator access to use it again — until
then the preview and OBS show {fallback}."

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
| Free posting a premium theme       | save merge keeps the stored theme unless it already was that theme; effective config falls back; tested                         |
| Fallback bypass                    | one function (`getEffectiveOverlayConfig`) for preview, dashboard, OBS, `/state`, SSE; renderers never see a non-entitled theme |
| Malformed / arbitrary variants     | strict per-theme enums; unknown keys rejected; stored junk → theme defaults; tested                                             |
| Forged rank style input            | rank → fixed palette table; labels rendered as escaped text only; tested with markup/CSS payloads                               |
| Preset IDOR / Free apply / expiry  | see [creator-presets.md](creator-presets.md); all integration-tested                                                            |
| Cross-user cache                   | shared plan definitions are deep-frozen; payloads built per request for the overlay's owner                                     |

## Open-core boundary

| Core (public, MIT)                                                    | Creator module candidate                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Overlay model, Free themes, renderer, fit-to-box, base validation     | `creator.ts` (schema, effective rule, save merge), `variants.ts`, `presets.ts`     |
| `creator`/`variants` slots and the theme registry contract (fallback) | `creator-themes.tsx` + Creator CSS blocks, `creator-style.ts`                      |
| `getEffectiveOverlayConfig()` contract and the Free fallback          | builder sections: Creator customization, variants, presets; theme picker badges    |
| Entitlement resolver and the `overlays.*` keys                        | `server/overlays/presets.ts` + `creator_overlay_preset` (table could stay in core) |
| `domain/sf6/rank-prestige.ts` (game data mapping)                     | —                                                                                  |

**Reassessment (Phase 4.5): a private SST Creator repo is still not justified yet, but it's closer.**

- Phase 4.5 adds the first assets with design value: three themes and presets. But the themes
  are ~430 lines of CSS and ~330 of TSX behind the same seams (registry entry, effective
  function, builder sections).
- The real moat is the hosted service and iteration speed, not secrecy of CSS that ships to every
  OBS browser anyway.
- A private repo now would add a build/CI split, version skew and a harder self-host story
  for little protection.

**Trigger to revisit:** when there is a **catalog** (≥ 6–8 Creator themes or designed preset
packs) or anything with a real per-asset production cost (commissioned art, licensed fonts).
At that point:

- move `creator-themes.tsx` and the Creator CSS blocks;
- move the variants and the builder sections;
- keep the registry contract, the fallback rule and `rank-prestige.ts` in core.

**This PR doesn't create that repository.**

## Rollback (Phase 4.5)

Reverting the code leaves `creator_overlay_preset` inert. A stored `variants` block is ignored by
the old schema, which strips unknown keys. But under the old 3-theme enum, an overlay whose
**stored theme is a Creator theme reads as the default config**, and an old-editor save would
persist that. Before rolling back after users have saved Creator themes, map them to their
fallbacks (admin connection):

```sql
update overlay
set config = jsonb_set(config, '{theme}', to_jsonb(case config->>'theme'
  when 'rank-card' then 'competitive' when 'broadcast' then 'minimal' else 'fighter' end))
where config->>'theme' in ('rank-card', 'broadcast', 'prestige');
```

Prefer a forward fix.

## Known issues

- **Overlay limit race:** the 10-overlay check is count → check → create, so two concurrent
  creations at 9 could both pass. This predates Phase 4 and is tracked as a follow-up
  (transaction or advisory lock).
- **Overlay builder at ~390 px / 768 px — fixed in Phase 4.5** (small, isolated):
  - the grid items are `min-w-0`, so a previously measured preview width can no longer hold the
    column open;
  - the header actions and the Layout rows wrap.

  Verified: no horizontal overflow at 1440, 768 and 390.

- **Rank names of Master extensions:** they render only if Capcom's label carries them (SST stores
  no `rankTier` for MR). Otherwise those players show the Master tier.
