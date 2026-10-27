# Character portraits in OBS overlays: architecture and design audit

**Type:** audit and design only. No application code, assets, schema, dependencies or
configuration change in this PR.

## 1. Baseline (verified at the start of work)

| Item   | Verified state                                                           |
| ------ | ------------------------------------------------------------------------ |
| PR #83 | **merged** 2026-10-26 23:49:25 UTC (`gh api …/pulls/83`: `merged: true`) |
| `main` | `c79075a9aaa87fc5888504454a3da3ad0e00d39f` («Merge pull request #83 …»)  |
| Branch | `docs/overlay-character-portrait-audit`, created from that commit        |

Read for this audit:

- `AGENTS.md`;
- `docs/architecture.md`, `docs/creator-overlays.md`, `docs/entitlements.md`;
- `docs/brand/NOTICE.md`, `next.config.ts`;
- every file cited below.

**Nothing was rendered in a browser for this audit.** The layouts below are text wireframes from
the real markup and CSS. They are not screenshots.

## 2. Character identity: source → renderer

```
Capcom play.json / battlelog (Companion)              packages/sf6-capcom-core
  character_tool_name  "aki", "jp", "gouki", …  ──►  parse.ts: validated against
  (Capcom's own key; 32 in the test fixture,           CHARACTER_KEY_PATTERN (types.ts:31),
   including "random")                                  invalid/duplicate keys skipped
        │
        ▼
match.character_key, player_character_rating          src/server/db/schema.ts
        │
        ▼
loadSessionContext → summarizeFromContext             src/server/sessions/service.ts
  engine: computeCharacterProgress,                    src/domain/session/engine.ts
          resolveActiveCharacter (engine.ts:436):
          latest counted match → favorite → first rated
        │
        ▼
toLiveSessionState → PlayerLiveState                  src/domain/overlay/state.ts
  session.activeCharacterKey, session.characters[]
  (characterKey, characterName, ratings, stats)
        │                                   ┌─ initial HTML: overlay/[token]/page.tsx →
        ▼                                   │  loadOverlayPayload (server/overlays/public.ts)
OverlayPayload { config, live }  ───────────┤
                                            └─ updates: /api/overlay/:token/stream (SSE, full
                                               snapshot; 10 s /state polling fallback only when
                                               the stream fails) — LiveOverlay.tsx
        │
        ▼
SessionOverlayView (OverlayView.tsx)
  resolvePresentation (presentation.ts): rotation view → projected config
     (ratingCharacterKey = view's character, or active character for the session view)
  ThemeView → each theme calls ratingParts(live, config)          parts.tsx
     ratingParts → pickRatingCharacter(session, config.ratingCharacterKey)   state.ts
       = pinned key (if known) ?? session.activeCharacterKey
     returns { character (name), characterKey, rank, value, delta, … }
```

**Findings:**

- **Normalization.** The character identity is Capcom's `character_tool_name`, validated as a
  slug. SST keeps **no character catalog**: new characters appear automatically, with the name
  Capcom sends. `random` is a key in the profile payload and is not special-cased anywhere.
- **The one authority for «the character this overlay shows» is `ratingParts().characterKey`**:
  the pinned `ratingCharacterKey` if that character is known, otherwise
  `session.activeCharacterKey`.
- **The six themes cannot disagree.** All six call `ratingParts` on the same projected `display`
  config (`OverlayView.tsx` → `ThemeView`), so for one config they show the same character. A
  portrait keyed on `ratingParts().characterKey` inherits this. No new lookup is needed.
- **Configured vs latest vs active vs sample:**
  - the configured key pins the character;
  - otherwise the character comes from the engine's `resolveActiveCharacter` (latest counted
    match, else favorite, else the first rated character);
  - the preview uses `sampleLiveState` / `sample-session.ts` with the same types.
- **Lifecycle:**
  - Change character mid-session: the next snapshot carries the new `activeCharacterKey` and the
    portrait follows on the same render.
  - New session: `sessionIdentity` changes, and the session and rotation baselines reset.
  - Ended session: its last active character stays.
  - No session ever (idle): favorite or first rated character from the roster
    (`computeIdleRoster`).
  - No character at all: `characterKey === null`, and the name shows «—».
- **Data arrival.** The identity is in the **server-rendered initial HTML** (no flash) and in
  every SSE snapshot. A portrait derived from it needs **no new request, subscription or field**.
- **Rotation.** In mixed modes (Creator `characterRotation`), `resolvePresentation` sets the
  view's character as `ratingCharacterKey` and writes the **view label into the title slot**
  (`withViewTitle`). The rotation frame is re-keyed per view (`ov-rot-frame`), so a portrait
  changes together with the view.

## 3. Theme inventory

Canvases (`OVERLAY_PRESETS`, `config.ts`): **compact 600×120, standard 800×180, detailed
900×240**.

- Everything is em-based. `overlayStyle` sets the root font size from the canvas, and
  `useFitToBox` shrinks it when content overflows.
- **Any added width therefore shrinks all text**, not just the portrait. That is the main
  layout cost.
- Registry: `src/domain/overlay/themes.ts`.

| Theme              | Tier · canvases              | Markup                                    | Structure                                                                                                  | Character name today                           | Title today                                 |
| ------------------ | ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| Minimal            | Free · all                   | `MinimalTheme`, `OverlayView.tsx:125`     | one `nowrap` line at 1.4em: `ov-min-bar` (skewed accent tick) + items                                      | inside the rating item (`ov-char`, small caps) | none; the view label leads in mixed modes   |
| Competitive        | Free · all                   | `CompetitiveTheme`, `OverlayView.tsx:234` | column: top row (`ov-comp-tag` title, rule, rank) / main cells / recent form; notched `clip-path`          | label of the rating `Cell`                     | `ov-comp-tag`                               |
| Fighter («Street») | Free · all                   | `FighterTheme`, `OverlayView.tsx:352`     | row of skewed blocks (`skewX(-14deg)`), slash lead-in                                                      | rating block label «NAME · RANK»               | small label in the score block              |
| Rank Card          | Creator · standard, detailed | `RankCardTheme`, `creator-themes.tsx`     | left badge column (SST CSS emblem + rank), body (head: name + title; rating; stats; form)                  | `ov-rc-char`, head of the body                 | `ov-rc-title` beside the name               |
| Broadcast          | Creator · all                | `BroadcastTheme`, `creator-themes.tsx`    | `ov-bc` row: `ov-bc-tab` (title) + `ov-bc-bar` of equal segments (label over value)                        | label of the rating segment                    | `ov-bc-tab`: «SESIÓN» / custom / view label |
| Prestige           | Creator · standard, detailed | `PrestigeTheme`, `creator-themes.tsx`     | three columns: record side / centre (title, emblem, rank, name + rating) / win-rate side; corner ornaments | `ov-pr-char` in the centre rating row          | `ov-pr-title`, centre top                   |

The CSS for all six is `src/components/overlay/overlay.css`. It is OBS/CEF-safe by rule: no
Tailwind, `oklch()`, `color-mix()`, container queries, `:has()`, or remote fonts or images
(`AGENTS.md`, `docs/creator-overlays.md` «OBS / CEF safety»).

## 4. Placement comparison (proposal)

One rule for all six: the portrait is **height-bound**. It takes the height of the row or panel
it sits in (em-based), never a fixed pixel size, so it scales with the canvas and with auto-fit.
It is **never placed behind numbers**. The character name stays as text everywhere it is today.

| Theme           | Recommended placement                                                                                                                                                                                     | Shape                                                                     | Main trade-off                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Broadcast**   | A **new leading cell** before `ov-bc-tab`: `[portrait][tab][bar]`, full bar height. It **complements** the tab: the tab keeps the title or rotation view label. With the title hidden: `[portrait][bar]`. | square, flat, with an accent underline matching `ov-bc-bar`'s bottom rule | about one bar-height of width: on compact (600×120) auto-fit shrinks the text a few percent                                                       |
| **Minimal**     | **Replaces the `ov-min-bar` tick** with a small skewed chip at line start (the tick is decorative; its accent becomes the chip frame)                                                                     | ~1.3em skewed square                                                      | adds ~1em to a `nowrap` line, the theme most likely to auto-shrink on compact; it should be optional per overlay                                  |
| **Competitive** | A **left column spanning the top row and the main cells**, inside the notched panel                                                                                                                       | 3:4 vertical plate                                                        | the widest addition; the scoreboard numbers keep priority, so on compact the plate drops to the top row only (tag height)                         |
| **Fighter**     | A **new first skewed block** after the slash lead-in, same `skewX(-14deg)` frame, content counter-skewed                                                                                                  | skewed square block                                                       | Street is already the widest Free theme; one more block; consistent with its block language                                                       |
| **Rank Card**   | **In the body head, before `ov-rc-char`.** The badge column stays the rank emblem: this card is rank-led.                                                                                                 | small square, `--ov-tier` border                                          | competes visually with the emblem if large: keep it ≤ the head's line height × 2                                                                  |
| **Prestige**    | A **framed medallion in the centre column, left of the name in `ov-pr-rating`**. The emblem stays central.                                                                                                | round/octagonal medallion matching the corner ornaments                   | vertical space is tight on standard (180 px); a bigger medallion replacing the emblem would change the theme's identity, so it is not recommended |

**Broadcast in detail** (the reference). Its «title/name region» is `ov-bc-tab`, and it is a
**title**, not the character name. The name is the small label of the rating segment. Putting the
portrait **in** the tab would collide with the custom title and with the rotation view label.
A leading cell keeps all three and reads like a sports-TV lower third: crest, then title, then
numbers.

```
standard 800×180, Broadcast, title on
┌────┬─────────┬──────┬──────┬───────┬──────────────┬─────────────┬────────┐
│ ▒▒ │ SESIÓN  │ VICT.│ DERR.│ % VICT│ RANGO        │ A.K.I.      │ ▪▪▪▪▪  │
│ ▒▒ │         │  3   │  1   │ 75 %  │ ULTIMATE MAST│ 1903 MR ▲+37│        │
└────┴─────────┴──────┴──────┴───────┴──────────────┴─────────────┴────────┘
 ▲ portrait cell (square, bar height, accent underline); name stays in the rating label
```

```
Minimal                        Competitive                     Fighter
╱▒╱ 3V 1D │ 75 % │ AKI 1903…   ┌──┬ SESIÓN ──────── ULTIMATE ┐  ╱╱ ▱▒▱ ▱ 3-1  75% ▱ AKI · UM ▱
 ▲ chip replaces the tick      │▒▒│ 3 / 1 │ 75 % │ A.K.I. 1903│     ▲ new skewed block
                               └──┴───────────────────────────┘
Rank Card                      Prestige
┌─┬──────┬───────────────────┐ ┌────┬───────────────────┬────┐
│ │ ◆ UM │ ▒ A.K.I.  SESIÓN  │ │3-1 │ SESIÓN  ◆  ULTIMATE│75 %│
│ │      │ 1903 MR ▲+37      │ │    │ (▒) A.K.I. 1903 MR │    │
└─┴──────┴───────────────────┘ └────┴───────────────────┴────┘
```

## 5. Image sources and licensing

### 5.1 What Capcom's published policies say

Read from Capcom's own pages on 2026-10-26.

**[Capcom Fan Content Guidelines](https://www.capcom-games.com/en/fan-content-guidelines/)**
(dated Nov. 4, 2025):

- _«…the act of processing or using our materials as is or without any creative input does not
  constitute a derivative work, and is **not subject to the permissions** granted under these
  Guidelines.»_ (§III)
- _«Commercial use, including use of our intellectual property to **promote or market commercial
  products or services or any monetization** … is not permitted…»_ (§IV)
- Prohibited: _«Any content, activity or presentation that may mislead people into believing
  that the content is official or authorized by Capcom»_ and _«Items that do not fall under the
  category of derivative works … (e.g., items that do not have creative input by the user)»_
  (§VI).
- _«Capcom may in its sole and absolute discretion, require that the use of Capcom property in a
  derivative work be discontinued.»_ (§VII)

**[Capcom Video Policy](https://www.capcomusa.com/video-policy/)** (last updated March 15, 2021):

- _«You may not split our game content into components (visual, vocal, in-game elements, etc.)
  and distribute such components as separate content.»_
- _«…we do not allow Capcom content to be uploaded to a platform for which rights have not been
  granted (such as in the creation of Twitch emotes featuring Capcom content.)»_
- The policy _«is not intended to be … express permission nor an official license or
  authorization for you to create mods or derivative works»_.

Secondary coverage of the 2025 guidelines matches this reading:
[Automaton](https://automaton-media.com/en/news/capcom-publishes-fan-content-guidelines-including-rules-against-offensive-fanart-and-commercial-use/),
[Siliconera](https://www.siliconera.com/capcom-shared-game-fan-creation-and-derivatives-guidelines/).

### 5.2 Repository policy already in force

- `docs/creator-overlays.md`: _«SST ships **no official Capcom or Riot assets**»_, and OBS
  overlays use _«No remote fonts or images»_.
- `creator-themes.tsx` and `docs/architecture.md`: the rank emblem is _«SST-native CSS (no
  official artwork)»_.
- `docs/brand/NOTICE.md`: SST is not affiliated with Capcom.
- The repository is **public and MIT-licensed**: anything committed is redistributed.
- `docs/entitlements.md`: there is no billing yet, but a `creator_beta` plan exists and RFC 0001
  plans commercialization. That is relevant to §IV's «any monetization».

### 5.3 Assessment

| Approach                                                                      | Redistribution / licence                                                                                                                                                                                                                                     | Quality and consistency               | OBS reliability                                                                                 | Cost                | Privacy and security                                                               | Maintenance                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **A. Bundle official SF6 portraits** (renders, select-screen art, game files) | **Not permitted by the published policies**: «as is» use is excluded (§III), «components distributed as separate content» is excluded (Video Policy), and a public MIT repo would redistribute them. **Unverified; requires a written licence from Capcom.** | best                                  | same-origin static files: reliable                                                              | small               | none                                                                               | each new character needs an asset, and art may change              |
| **B. Curated gallery** (third-party or fan art)                               | per-artist licences would be needed for _each_ image; fan art of Capcom characters is itself bound by Capcom's guidelines (no commercial use, takedown at will). **Unverified.**                                                                             | inconsistent styles                   | same as A if bundled                                                                            | curation work       | none                                                                               | high: rights tracking per image                                    |
| **C. User-provided image** (upload or URL)                                    | SST would **host or proxy** whatever users choose, very likely Capcom art: the case the Video Policy excludes («uploaded to a platform for which rights have not been granted»). It needs a takedown/DMCA process.                                           | uncontrolled                          | URL: hotlinking, mixed content and CORS, third-party outages, CSP change; upload: needs storage | storage + bandwidth | URL leaks viewers' OBS IP to third parties; uploads need validation and moderation | high                                                               |
| **D. SST-native portrait plate** (typographic/vector, no artwork)             | **SST's own work**, the same policy as the rank emblem and the Fight Session «ghost» name ([`SessionStage`](../../src/components/fight-session/SessionStage.tsx): «type, never character artwork»)                                                           | consistent by construction; themeable | inline (no request): cannot fail to load                                                        | none                | nothing user-controlled                                                            | none: new characters work automatically from the name Capcom sends |

**Conclusions:**

- **A and B must not be bundled**: permission is **not established**.
- **C is not recommended now.** There is no storage infrastructure (verified: no Supabase Storage,
  S3 or upload code in `src/`; no storage dependency in `package.json`). The CSP is
  `img-src 'self' data: blob:` (`next.config.ts:22`), so a URL field would also need a CSP
  relaxation for the overlay surface. And the licensing exposure moves from SST to SST-plus-users.
- **D is the only option SST can ship today without legal or infrastructure blockers.**

## 6. Customization and persistence

How the existing infrastructure works:

- Overlay config lives in `overlay.config` (jsonb). It is validated by
  `sessionOverlayConfigSchema` (`config.ts`) on save (`saveOverlayAction`, `dashboard/actions.ts`:
  authenticated owner, `overlayConfigSchema.safeParse`, kind immutability).
- Reading is **lenient**: missing keys get defaults, which is how `statsScope` and
  `ratingTransition` were added **without a migration**.
- Creator-only options sit in `config.creator` (`creatorCustomizationSchema`). They are applied
  only through the owner's _effective_ entitlements (`resolveEffectiveOverlayConfig`).
- Every save publishes a `{ kind: "overlay" }` realtime event
  (`src/server/overlays/service.ts:112`, `src/server/realtime/events.ts`), and the existing
  stream pushes the new config to OBS. There is no page reload, and the session statistics are
  untouched (`LiveOverlay.tsx`: config-only updates reuse the same live snapshot).

| Experience                                      | Fits existing infra?                                        | Recommendation                 |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------ |
| Automatic portrait from the overlay's character | yes: derived from `ratingParts().characterKey`, no new data | **implement**                  |
| Choose from a verified gallery                  | infra yes (an enum key in config), **licence no**           | blocked until a licence exists |
| User image                                      | no storage; CSP; licence exposure                           | **do not implement**           |
| Reset to automatic                              | trivial with an enum setting                                | part of the setting itself     |

The smallest safe setting is **one Free field**, `portrait: "auto" | "off"`, in the session
config:

- **New overlays default to `"auto"`.** «Automatic by default» needs no visit to the settings.
- **Stored configs without the key read as `"off"`.** A live stream's layout must not shift or
  shrink by surprise. This is the same legacy rule as `ratingTransition: "instant"`.
- **No `characterKey` override is needed.** The existing «rating character» pin
  (`ratingCharacterKey`) already chooses which character the overlay represents.
- **A future `"gallery:<id>"`** value can be added only when licensed assets exist. The setting
  stays an enum, never a URL.

## 7. Default and fallback

The **SST-native plate** is both the default and the fallback:

- the character name from Capcom, as an abbreviation, set in the overlay's display font (for
  example «AKI», «JP», «GOUKI»);
- on an angular plate in the theme's colours, with an accent edge;
- the same visual family as the M2 control language (angular cut, no glow);
- no image, so nothing can fail to load.

| Situation                                    | Plate shows                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| known character                              | abbreviation of `characterName`                                                      |
| `characterKey === null` (no character known) | neutral SST mark (monogram outline), no text                                         |
| `random`                                     | «?» on the plate (pending confirmation of how Capcom reports Random in matches, §12) |
| very long name                               | abbreviation capped at 4–5 glyphs; the full name is still the existing text label    |

**Only if licensed raster art exists later:**

- the plate stays underneath as the placeholder;
- the image is reserved with explicit `width`/`height` (no layout shift) and keyed by
  `characterKey` (no stale image);
- `onError` keeps the plate;
- there is no animation, and nothing is required by reduced motion.

## 8. Recommended minimal architecture

```
domain/overlay/portrait.ts   (pure)
  portraitFor(characterKey, characterName) → { kind: "plate", label } | { kind: "none" }
  abbreviation rules + fixed overrides only where Capcom names abbreviate badly (tested)

domain/overlay/themes.ts     registry capability (like integratedBranding):
  portrait: { slot: "lead-cell" | "line-start" | "left-column" | "lead-block" | "head" | "medallion",
              minCanvas: OverlayCanvasId }

components/overlay/portrait.tsx   <CharacterPortrait> — inline markup, aria-hidden, no <img>
overlay.css                       .ov-portrait + per-theme placement classes (OBS-safe CSS)
themes (OverlayView.tsx, creator-themes.tsx)  render it from ratingParts().characterKey
```

Properties:

- no new data, field in the payload, request, SSE event or dependency;
- the renderer stays a pure `(config, live) → markup`;
- the dashboard preview gets it for free (same `OverlayView`).

## 9. Files likely to change in the implementation PR

- `src/domain/overlay/portrait.ts` (+ test), new.
- `src/domain/overlay/themes.ts`: the `portrait` capability.
- `src/domain/overlay/config.ts`: `portrait` field, legacy default `"off"`, new-overlay default
  `"auto"`; plus `config.test.ts`.
- `src/components/overlay/portrait.tsx`, new.
- `src/components/overlay/parts.tsx`: possibly expose `characterName` and `characterKey`, which
  are already returned.
- `src/components/overlay/OverlayView.tsx`: Minimal, Competitive and Fighter.
- `src/components/overlay/creator-themes.tsx`: Rank Card, Broadcast and Prestige.
- `src/components/overlay/overlay.css`.
- The builder control and help text: `src/app/(app)/dashboard/overlays/[id]/OverlayBuilder.tsx`
  (or its settings section), plus `src/i18n/messages/es.json` and `en.json`.
- `docs/creator-overlays.md` / `docs/overlay-builder.md`: a portrait section.
- Tests (§11).

Not touched: `src/server/**`, SSE routes, schema and migrations, Companion, the engine and
`state.ts`.

## 10. Risks

- **Accessibility.** OBS output has no assistive-technology users, but the dashboard preview
  does. The plate is `aria-hidden` and the name stays as text. Contrast: the plate text uses
  `--ov-text` on `--ov-bg` with an accent edge, never accent-on-accent. It must be checked
  against the custom colours of each theme.
- **Layout.** Width plus auto-fit shrinks every number on compact canvases. Mitigation: per-theme
  `minCanvas` (no portrait below it); height-bound sizing; Minimal and Competitive measured at
  600×120.
- **Performance.** Inline markup only: no images, decoding or animation. A theme change does not
  alter the SSE cadence.
- **Security.** Nothing user-controlled reaches CSS or URLs. The label comes from the server
  snapshot as text. No CSP change.
- **OBS compatibility.** The same URL, query parameters, canvas sizes, stream contract and
  standalone `(overlay)` root layout; no dashboard CSS or bundle. Classes and custom properties
  only (CEF-safe).
- **Product.** A typographic plate may fall short of what the tester imagined («a picture of the
  character»). It is honest about that and upgradeable (§7, §12).
- **Legal.** If anyone later bundles official art without a licence, the project inherits
  takedown and reputational risk. This report should be cited in that review.

## 11. Acceptance criteria and test plan

**Criteria for the implementation PR:**

1. For the same config, all six themes render the plate for `ratingParts().characterKey`. Pinned
   key, active character, rotation views and idle roster all match the existing name label.
2. New overlays show the plate with no configuration. Existing overlays (no key) render
   **byte-identical markup** to today until the streamer turns it on.
3. `characterKey` null shows the neutral mark. Unknown or new characters get a plate from the
   name. No case renders a broken image (there is no image).
4. After a character change, the plate updates in the same render as the name. There is never a
   plate of character A next to the name of character B (rotation frame included).
5. MR/LP, rank, delta, W/L, win rate, streaks and recent results are **identical** with
   `portrait` on and off. That is a snapshot comparison of the text content.
6. The same OBS URLs and SSE/fallback behaviour: no new route, event, subscription or polling.
   The request count per overlay load is unchanged.
7. At each theme's `minCanvas`, no text is clipped. Auto-fit scale with the portrait is ≥ 0.85 of
   the scale without it (measured in Chromium).
8. No `animation`/`transition` on the plate. Reduced motion changes nothing.
9. The setting is validated by the schema (an enum only). Unknown values read as `"auto"` for new
   and `"off"` for legacy configs. It is saved through the existing owner-checked action.
10. The builder control and help text exist in ES and EN.

**Tests:**

- **Unit:** `portrait.ts` (abbreviations, null, `random`, long names, Unicode names such as
  «A.K.I.»); config defaults and legacy reads; the theme registry capability.
- **Render** (happy-dom, real `OverlayView`): all six themes × on/off × pinned/active/rotation
  views, covering identity agreement, metrics unchanged and byte-identical output when off.
- **Browser** (Chromium, local production build, local DB, `@test.local`, real Companion sync):
  - the six themes at every supported canvas;
  - a character change mid-session through a real sync, so the plate follows without a reload;
  - the fit-scale measurement;
  - the OBS document loads no new resources (`performance.getEntriesByType("resource")` diff);
  - reduced motion;
  - ES/EN builder.

## 12. Unresolved questions

1. **A licence for official portraits.** Would Capcom grant written permission for SF6 character
   art in a third-party overlay tool, possibly with a paid tier? It cannot be answered from
   public sources. The Fan Content Guidelines say Capcom _«will not respond to inquiries
   regarding rights»_, so this needs a direct licensing request, outside fan-content channels.
2. **Commercial status.** Whether SST's future plans count as «monetization» under §IV is a legal
   question (RFC 0001 §15 already calls for legal review before commercialization).
3. **How `random` appears in matches.** It is in the profile roster. Whether a match ever
   carries `characterKey: "random"` or always the character actually played could not be
   confirmed from the fixtures.
4. **Product expectation.** Does the tester accept an SST-native plate as «the portrait»? This
   needs feedback on an implemented prototype.
5. **Abbreviations.** Should the plate use a short form (for example a Capcom
   `character_alpha`-style label, present in `play.json` but not stored today) or SST's own
   abbreviation? Storing `character_alpha` would be a Companion/data change and is out of the
   minimal scope.
6. **Should Rank Progress overlays get the plate too?** It is a separate kind with its own
   renderer, out of this audit's six themes.

## Recommendation

**Implement D first: the automatic, SST-native portrait plate.** It is a Free `portrait: "auto" |
"off"` setting, with `"auto"` for new overlays and `"off"` for stored ones, derived from the
character every theme already shows (`ratingParts().characterKey`). It is the safest option
because:

- it uses **no Capcom artwork**, which keeps SST inside its own published asset policy and
  outside the parts of Capcom's guidelines that exclude «as is» use and separately distributed
  components;
- it adds **no data, request, storage or dependency** and cannot fail to load in OBS;
- it cannot desynchronize from the name, rank or MR, because it comes from the same value.

**Remaining blockers:**

- Official or gallery art is **blocked on a written licence** (§12.1–2).
- User images are **blocked on storage infrastructure, a CSP change and a takedown process**, and
  are not recommended even then.
- Each theme's minimum canvas must be **measured in the implementation PR**.
