# Brand assets: SST

Use of the name and logo: see [NOTICE.md](NOTICE.md) (draft).

## Identity (Phase 4.8, "HUD Slash" monogram)

| Level            | What                                                                                                   | Where                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Primary mark** | the **SST monogram**: three slanted, blocky letters, a cyan leading slash and magenta trailing slashes | favicon / app icon (compact form), mobile headers, dashboard nav, avatars, watermarks |
| **Brand lockup** | monogram + divider + "SESSION / STATS / TRACKER"                                                       | landing header and auth/onboarding/help headers from 640 px up                        |
| **Wordmark**     | the words "Session Stats Tracker"                                                                      | page titles, metadata, accessible names, copy                                         |

The product name (SST, Session Stats Tracker) is never translated.

- **Page titles:**
  - default tab title: `SST | Session Stats Tracker`;
  - internal pages: `<Page> | SST`, e.g. `Panel | SST`, `Configurar overlay | SST`;
  - OBS overlay pages: `Overlay | SST`.

  The constants live in `src/components/brand/names.ts`.

## Source of truth: vector geometry

`src/components/brand/geometry.ts` is the single source of every asset. The concept image the
direction was approved from is reference only and is **not** in the repo. The mark was rebuilt
as clean geometry:

- **Letters:** S, S, T, drawn upright on a 100-unit cap height from straight segments, then
  slanted by one group transform (`skewX(-24°)` pivoting on the baseline).
- **Accents:** cyan and magenta parallelograms, slanted with the letters. They're optional
  decoration: **the letters alone are the mark** (monochrome = letters only).
- **Layers:** `.sst-letters`, `.sst-accent-cyan` and `.sst-accent-magenta` are separate groups
  and paths, so a future animation (slash reveal, short glow, HUD scan) needs no new geometry.
  **Nothing is animated today.**
- **Compact mark:** the first S with the same slashes, for ≤ 32 px. Three letters are illegible
  at 16 px, so this is a crop of the monogram, not a different icon.

| Asset                                                               | Content                                                        | Use                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| `<BrandMark variant="monogram" \| "lockup" tone="color" \| "mono">` | inline SVG (React, server component)                           | every header via `<Logo>`                               |
| `public/brand/sst-monogram.svg`                                     | colour monogram                                                | docs, external use on dark backgrounds                  |
| `public/brand/sst-monogram-white.svg` / `-black.svg`                | single colour                                                  | dark / light backgrounds, print, single-colour contexts |
| `public/brand/sst-mark-compact.svg`                                 | compact S                                                      | tiny placements                                         |
| `public/brand/sst-lockup.svg`                                       | lockup (the name is SVG text, Barlow Condensed with fallbacks) | docs, external use                                      |
| `src/app/icon.svg`                                                  | compact mark on the dark tile                                  | `<link rel="icon" sizes="any">` (modern browsers)       |
| `src/app/favicon.ico`                                               | compact mark, 16/32/48                                         | legacy favicon                                          |
| `src/app/apple-icon.png`                                            | full monogram, 180×180, opaque                                 | iOS home screen                                         |
| `src/app/(app)/opengraph-image.png`                                 | monogram + name + tagline, 1200×630                            | social previews                                         |

**Regenerating** after changing the geometry:

```bash
pnpm build
pnpm exec tsx scripts/brand/build-brand-assets.mts
```

Chromium (Playwright) renders the rasters, Pillow packs the `.ico`, and Barlow comes from the
app's own build output, so nothing is downloaded.

## Rules

- **Colours** are the existing tokens: letters `#eef1fb`, cyan `#2fe0ff`, magenta `#ff2e93`, and
  the app ink `#05070f` behind icons. There's no new palette and no orange.
- **Glow** is optional and restrained (only the OG image uses a soft drop shadow). The mark is
  always sharp, never a blur halo.
- **Light backgrounds:** use `tone="mono"` with a dark text colour, or `sst-monogram-black.svg`.
- **Don't** stretch, re-slant, outline, recolour the letters or rearrange the slashes. **Don't**
  use the lockup in tight spaces: below 640 px the header shows the monogram only.

## History

The previous raster logo was a symbol plus an orange-accented "SST". It was retired in Phase
4.8, together with its WebP/PNG derivatives and the Python derivation script; they remain in git
history.

The Companion extension declares no icons yet (Chrome shows its default), so nothing legacy
ships there. Adding an icon set from the compact mark is a follow-up for its next release.
