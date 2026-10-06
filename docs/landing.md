# Landing page (Phase 4.7)

The homepage is a scroll-driven product story. Every animation explains, demonstrates or
reinforces SST. Native scroll is never intercepted.

## Scene map

| #   | Scene                                                      | Component                   | Scroll behaviour                                                                         | Product UI                                                                           |
| --- | ---------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Hero: message + CTA + "live stream" stage                  | `Hero.tsx`                  | CSS load animation; light exit parallax (Motion)                                         | real **Street** overlay; one live update 11-5 → 12-5 after ~2 s in view              |
| 2   | Live session: match ends → result → stats → OBS            | `LiveSessionStory.tsx`      | **sticky stage** + steps in normal flow; active step by IntersectionObserver             | real **Competitive** overlay ticking 11-5 → 12-5, 1588 → 1684 MR (+96), streak 3 → 4 |
| 3   | How it works: Buckler → Companion → SST → OBS              | `HowItWorks.tsx`            | normal scroll; scroll-linked line (Motion value → transform), nodes light at thresholds  | SST-native SVG icons (no third-party logos)                                          |
| 4   | Overlay showcase: all 6 themes                             | `OverlayShowcase.tsx`       | desktop: **sticky stage** swapping themes; mobile: inline preview per theme (no pinning) | real renderer × `THEME_REGISTRY` order (Free, then Creator Beta)                     |
| 5   | Creator preview: theme → variant → density → glow → preset | `CreatorPreview.tsx`        | plays **once** when in view (~6 s), then stops; Replay button                            | real Rank Card / Prestige with real variants                                         |
| 6   | Built for fighting games (SF6 today)                       | `BuiltForFightingGames.tsx` | static + reveal                                                                          | real SST rank emblems (`RankEmblem` + `rankPrestige`)                                |
| 7   | Final CTA                                                  | `FinalCta.tsx`              | reveal                                                                                   | none                                                                                 |

There are only two sticky scenes (2 and 4), and both use plain `position: sticky` beside content
that scrolls normally. Nothing pins the page, so trackpad, wheel, Space, PageDown and arrow keys
all behave natively (verified with PageDown).

## Motion language

`motion-tokens.ts` and `landing.css` define one style per element type:

| Element    | Motion                                                                           |
| ---------- | -------------------------------------------------------------------------------- |
| Headlines  | masked reveal: `clip-path` + 0.35em rise                                         |
| Product UI | depth on swap: scale 0.94 → 1 + translate (`STAGE_SWAP`)                         |
| Numbers    | the overlay's own HUD tick (OverlayView): fast and snappy, never a slow count-up |
| Copy       | short 12 px rise, used sparingly                                                 |
| CTA        | opacity only                                                                     |
| Background | static layers; one light parallax in the hero                                    |

Everything animates `transform`, `opacity` or `clip-path`. React state changes only at step
boundaries (one IntersectionObserver per scene, or Motion threshold events). Nothing updates
state per scrolled pixel, and there are no `requestAnimationFrame` loops.

## Progressive enhancement

- All copy is server-rendered text. A test checks that no heading or paragraph ships hidden.
- The hidden "before reveal" state applies only under `[data-motion="ready"]`, which
  `RevealRoot` sets after hydration, and only inside
  `@media (prefers-reduced-motion: no-preference)`. Without JS, with failed hydration, or with
  reduced motion, content is simply visible.
- **Reduced motion:** no parallax, no reveals, no sweep. The pipeline is shown complete and the
  Creator preview shows its final state. The preference comes from a hydration-safe hook
  (`usePrefersReducedMotion`); Motion's own hook differs between server and client.

## Stack

**Motion for React** (`motion/react`) adds ~+30 KB uncompressed JS on `/`, measured in the
browser. It's used through `LazyMotion` with `domAnimation` (strict `m.*`) for `AnimatePresence`,
`useScroll`/`useTransform` and `useInView`.

Not used:

- **GSAP:** not needed. The stories are step-based, which IntersectionObserver plus sticky
  handles cleanly.
- **Lenis or any scroll hijacking.**
- **Video, Lottie or remote assets.**

## Demo data

`demo-state.ts` holds typed static fixtures (`LandingDemoStats`). They are never the visitor's
data and involve no fetch, API or DB. Values are literals with no session math. They are mapped
to the renderer's normal `PlayerLiveState` shape, so the landing shows exactly what OBS shows.

## Fixes made along the way

- **`DemoOverlay`** uses `contain: inline-size`. Without it, a grid/flex parent sized the stage to
  the overlay's content, so the measured width fed a bigger font: a growth loop (CLS 0.17).
- **`OverlayView` fit-to-box guard** now caps adjustments per frame in any direction. A long
  run of tiny shrinks could exceed React's nested-update limit (crash seen with reduced motion).
  Converging renders are unchanged.
- **Body background** is `no-repeat`. The root box is one viewport tall, so the glows tiled and
  drew hard bands on long pages.

## Measurements (local production build, 1440×900)

|                          | before  | after       |
| ------------------------ | ------- | ----------- |
| JS on `/` (uncompressed) | 410 KB  | 416–439 KB  |
| LCP                      | ~500 ms | ~450–470 ms |
| CLS (full scroll)        | 0       | 0.0003      |
| Page height              | 906 px  | ~9 200 px   |
