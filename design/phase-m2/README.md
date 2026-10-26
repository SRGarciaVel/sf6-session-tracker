# M2A: SST interactive controls and motion foundations

**Base:** `main` `648bb3b`. S-01 (`next` 16.4.2) and S-02 (`security/work-gate.ts` plus
`guardedReviewPdfResponse`) are present and **untouched**.

**Scope:** this is the first of three independently mergeable PRs (§7). It is a design-system
slice: controls, iconography and motion tokens. It is **not** a redesign. Fight Session stays
behind `FIGHT_SESSION_UI_USERS`, and the classic UI keeps working.

## 1. Action / control audit (before)

| Area                  | Action                                   | Component / semantics     | Before                        | Problem                                                 | Now                                                           |
| --------------------- | ---------------------------------------- | ------------------------- | ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| PREPARE               | Iniciar sesión de juego                  | `button.fs-cta` (primary) | `→` text glyph                | Glyph as decoration; font-dependent                     | SVG `arrow-right`, same angular CTA; nudge on hover           |
| PREPARE               | Ver resumen                              | `Link.fs-btn` (secondary) | `→` glyph                     | Same                                                    | SVG `arrow-right`                                             |
| PREPARE               | Ir al Companion (readiness)              | `<a href="#companion">`   | Plain underlined text         | No affordance                                           | `ActionLink kind="down"`                                      |
| Status strip (mobile) | Ir a tus overlays                        | `<a>.fs-btn`              | `↓` glyph                     | Glyph                                                   | SVG `arrow-down`                                              |
| Console               | Detalles (per overlay)                   | `<summary>`               | `›` glyph rotating            | Glyph                                                   | SVG `chevron` rotating (`--motion-standard`)                  |
| Console               | Añadir a OBS / Creator beta              | `<summary>`               | `›` glyph                     | Glyph                                                   | SVG `chevron`                                                 |
| Console               | Copiar URL para OBS                      | `CopyButton` (utility)    | Text only, «✓ Copiado»        | Check as text glyph                                     | `copy` icon → `check` icon, stable width                      |
| Console               | Abrir vista previa                       | `<a target=_blank>`       | `↗` inside the i18n string    | Glyph in the catalogue; no hint when unnamed            | SVG `external` + accessible «opens in a new tab»              |
| Console (classic)     | Configurar                               | `Link.btn`                | —                             | —                                                       | Unchanged                                                     |
| Companion             | ¿No tienes el Companion? Ver instalación | `Link`                    | `→` glyph                     | Glyph                                                   | `ActionLink` (forward)                                        |
| Companion             | Descargar actualización                  | `<a>.btn-primary`         | `↓` in the string             | Glyph                                                   | SVG `download`                                                |
| Companion             | Revocar / Sí, revocar                    | `Button ghost / danger`   | —                             | Destructive treatment already explicit                  | Unchanged (§4 F)                                              |
| RECAP (Fight Session) | Preparar otra sesión                     | `Link.fs-cta`             | `→` glyph                     | Glyph                                                   | SVG `arrow-right`                                             |
| RECAP (Fight Session) | Volver al panel                          | `Link.fs-btn`             | Text only                     | No direction                                            | SVG `arrow-left` (leading)                                    |
| RECAP (Fight Session) | Gestionar overlays                       | `Link`                    | `→` appended to the text      | Glyph                                                   | `ActionLink`                                                  |
| RECAP (Fight Session) | Ver resumen clásico                      | `<a href="?ui=classic">`  | Muted text                    | —                                                       | `sst-link--quiet` (still a plain anchor: server decides)      |
| RECAP (classic)       | ← Panel / Volver / Nueva sesión          | `Link`, `Link.btn`        | `←` inside the string         | Glyph; **same accessible name «Panel» as the nav tab**  | `ActionLink back` «Volver al panel»; buttons with arrow icons |
| History               | Row → recap                              | `Link.hud-row`            | `›` glyph                     | Glyph                                                   | SVG `chevron`                                                 |
| Builder               | ← Panel (dirty-guarded)                  | `Link` with `onClick`     | `←` string                    | Glyph; duplicated name                                  | `sst-link` with SVG `arrow-left`; guard unchanged             |
| Builder               | Abrir overlay                            | `<a target=_blank>`       | `↗` string                    | Glyph                                                   | SVG `external` + accessible hint                              |
| Onboarding            | ← Volver al panel                        | `Link`                    | `←` string                    | Glyph                                                   | `ActionLink back`                                             |
| Help                  | Descargar Companion / última versión     | `<a>.btn`                 | `↓` string                    | Glyph                                                   | SVG `download`                                                |
| Help                  | Abrir Buckler                            | `<a target=_blank>`       | `↗` string                    | Glyph                                                   | SVG `external` + accessible hint                              |
| Analytics             | Ver enfrentamientos / … (review card)    | `<a href="#…">`           | `→` glyph for an in-page jump | Wrong direction                                         | `ActionLink kind="down"`                                      |
| Analytics             | Replays «↓ Siguiente»                    | Text marker               | `↓` glyph                     | Decorative glyph                                        | Decorative SVG                                                |
| Analytics             | Descargar PDF                            | `<a download>`            | —                             | Refusals (429/503) appear as a browser download failure | **M2C** (§7)                                                  |

**Kept as text on purpose (content, not controls):**

- rating transitions (`1402 → 1414`);
- rank changes;
- ▲/▼ deltas;
- instruction paths (`OBS Studio → Fuentes → +`, `CFN → Replays → …`);
- simulation and rotation descriptions.

A test keeps these as an explicit allowlist.

## 2. Existing icons and dependencies

No icon library was installed. The only inline SVGs were the brand mark, the overlay brand flag
and the landing illustrations.

**Decision:** one tiny in-house set (`src/components/ui/Icon.tsx`, 8 paths) instead of a
dependency.

- Cost: **~2 KB gzip of client JS per page** and **~0.5 KB gzip of CSS**, measured below.
- The style is SST's own: a 2 px stroke with **square caps and mitred joins**, matching the
  angular geometry.
- Icons are sized in `em`, so they follow text size and the 200 % text setting.

## 3. SST action design language

| Role                     | Component                                                        | Use                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. PrimaryAction**     | `.fs-cta` (Fight Session) / `btn-primary` (classic) + `Icon`     | One per screen: start a session, prepare another, download. Angular cut, magenta, no glow.                                                                                 |
| **B. SecondaryAction**   | `.fs-btn` / `btn-secondary` + `Icon`                             | Configure, back to the dashboard, view recap, open a preview.                                                                                                              |
| **C. UtilityAction**     | `CopyButton`, small buttons                                      | Copy the OBS URL (copy → check), compact.                                                                                                                                  |
| **D. ActionLink**        | `ActionLink` (`components/ui/ActionLink.tsx`)                    | Navigation only, never `role="button"`. Five kinds: `forward`, `back` (icon first), `down` (same page), `external` (new tab + hint), `download`. Cyan, or `quiet` (muted). |
| **E. IconButton**        | `Icon label=…`                                                   | Not needed in this slice: every control has a visible text label. The `label` prop gives `role="img"` and a name for a future icon-only control.                           |
| **F. DestructiveAction** | `btn-danger` / `fs-btn-danger` + an inline two-step confirmation | Already explicit (revoke device, delete overlay, end session). Unchanged; the confirmation rules are covered by existing tests.                                            |

**Icon semantics:**

| Icon             | Meaning                        |
| ---------------- | ------------------------------ |
| `arrow-right`    | Go to                          |
| `arrow-left`     | Back to the parent             |
| `arrow-down`     | Further down this page         |
| `external`       | Leaves SST / opens a new tab   |
| `chevron`        | Disclosure                     |
| `download`       | File                           |
| `copy` / `check` | Clipboard and its confirmation |

No emoji or Unicode arrows are used as controls.

## 4. Motion tokens (`src/app/(app)/globals.css`, `:root`)

| Token                    | Value                         | Intent                                  |
| ------------------------ | ----------------------------- | --------------------------------------- |
| `--motion-instant`       | 100 ms                        | Press / toggle feedback                 |
| `--motion-quick`         | 160 ms                        | Hover, colour, icon nudge               |
| `--motion-standard`      | 220 ms                        | Disclosure, small reveal                |
| `--motion-panel`         | 280 ms                        | Panels / sections entering              |
| `--motion-stage`         | 400 ms                        | Session-state transition (maximum)      |
| `--motion-ease-out`      | `var(--ease-snap)`            | Default (decelerate)                    |
| `--motion-ease-in-out`   | `cubic-bezier(.65,0,.35,1)`   | Symmetric moves                         |
| `--motion-ease-emphasis` | `cubic-bezier(.2,.9,.2,1.15)` | Small overshoot for domain events (M2B) |
| `--motion-nudge`         | 3 px (0 with reduced motion)  | Directional icon response               |

**Rules:**

- Only `transform` and `opacity` are animated. Dimensions never are.
- **Direction follows meaning:** forward nudges right, back left, down and download down,
  external diagonally.
- **Disclosures** rotate their chevron (`--motion-standard`).
- **Interruption:** CSS transitions reverse from the current value, so there is no queueing.
- **Reduced motion:** the nudge distance is 0 and the global rule collapses durations, so the
  icon stays put and colour or underline still signal the state.
- **Focus** gets the same nudge as hover, so keyboard users see the response too. The focus ring
  stays the global 2 px cyan outline.

## 5. Implemented in this PR

- `components/ui/Icon.tsx`, `components/ui/ActionLink.tsx`.
- `CopyButton` (copy/check icon).
- `SessionControls` (CTA icon).
- **Fight Session:** `FightSessionDashboard` (view recap, overlays jump, readiness link) and
  `FightSessionRecap` (prepare another, back, manage overlays, classic link). `OverlayAccess`.
- **Console:** `OverlaysPanel` (chevrons, preview link) and `CompanionPanel` (download, install
  link).
- `Readiness`, `SessionHistory`.
- **Classic recap:** back links and buttons.
- **Builder:** back link in both builders, `ObsOutput` open overlay.
- **Onboarding** back link.
- **Help:** download, update, open Buckler.
- **Analytics:** review links, replay marker.
- **i18n (ES/EN):** glyphs removed from 9 control strings. `Common.opensInNewTab` added.
  `Common.backToDashboard` is now «Volver al panel» / «Back to dashboard»: it used to share the
  accessible name «Panel» with the navigation tab.

**Destinations unchanged:**

- `/dashboard#session`, `/dashboard`, `/dashboard#overlays`, `?ui=classic`;
- `/dashboard/sessions/<id>`, `/dashboard/overlays/<id>`, `/help/companion`;
- the public overlay URLs.

Verified by clicking in Chromium (§9) and by the existing SSR tests.

## 6. Evidence

`screenshots/evidence/`:

- `before--*` / `after--*` for PREPARE, recap and the classic dashboard and recap (1440 and 390),
  builder, onboarding and help;
- `after--text200--*` (text at 200 % through Chromium's default font size);
- `motion--hover-frames.jpg` (rest → +40 → +90 → +200 ms for the CTA, a secondary «back» button
  and an ActionLink);
- `metrics-*.json`, `checks-after.json`.

## 7. Deferred, as separate PRs (not started)

- **M2B: Fight Session motion.** Implemented in [`m2b.md`](m2b.md) (PR «feat(ui): add
  event-driven Fight Session motion»). Two departures from this plan: domain cues use
  `--motion-ease-out` (no overshoot), and RECAP → PREPARE gets no extra animation. The original
  plan follows.
  - PREPARE → LIVE: entrance of the LIVE heading and scoreboard after the server confirms the
    session. The existing `fs-enter` and focus move to tokens.
  - New match: one accent per unique match id, no replay on reconnect or remount, bursts
    coalesced. The existing `useFreshMatchId` and `fs-pop` move to tokens, with tests for
    reconnect and initial render.
  - Rating: reuse the existing rating transition only; never animate a held or unconfirmed value.
  - LIVE → RECAP and RECAP → PREPARE: short `--motion-panel` entrances after navigation, with no
    delay.
  - Coordination with the M1 skeletons: no cross-fade with the skeleton.
- **M2C: PDF export feedback.** Implemented in [`m2c.md`](m2c.md) (PR «fix(analytics): provide
  feedback for PDF export failures»). Departures from this plan: the control stays a link that
  intercepts plain clicks, and a success must also carry the `%PDF-` signature. The original plan
  follows.
  - Client-side `fetch` of the protected route, keeping the server limits.
  - A pending state on the button; no second request while one is in flight.
  - 200 → blob download using the server's filename (`Content-Disposition`), revoking the object
    URL.
  - 429/503 → a localized inline message with a safely parsed `Retry-After` (integer seconds,
    clamped), no automatic retry.
  - Network errors → generic message.
  - Tests for 200, 429, 503 and network failure.
- **M3/M4:**
  - remaining secondary pages (landing, auth forms, the builder's internal panels);
  - **pre-existing overflow at 200 % text on 390 px of the analytics filters and builder tabs**
    (from M1, not touched here).

## 8. Accessibility

- **Links vs buttons:** every navigation is an `<a>` (Next `Link`, or a plain anchor for
  `#…`, `?ui=…`, downloads and external pages). Buttons stay buttons (start, copy, end).
- **Icons:** decorative (`aria-hidden`, `focusable="false"`). The accessible name comes from the
  visible text. External links add «se abre en una pestaña nueva» / «opens in a new tab».
- **Duplicate name removed:** «Panel» (navigation tab) vs «Panel» (back link).
- **Focus:** global 2 px cyan outline (measured: `solid 2px`). Focus also nudges the icon.
- **Touch targets:** every action control is ≥ 24 × 24 px (WCAG 2.2 SC 2.5.8, browser check).
  `ActionLink` has a 2 rem minimum height.
- **Reduced motion:** the hovered icon does not move (`transform: none`, browser check).
- **Text 200 %:** no overflow on PREPARE or the recap at 1440 and 390.
- **Copy:** the visible text and icon change; the existing polite announcement is unchanged.

## 9. Verification

- **Browser, `e2e/controls.e2e.mts`** (local production build, local Postgres, real Companion
  sync): **22/22**.
  - CTA is a button with an SVG.
  - «Ver resumen» → recap.
  - Recap primary and secondary actions, and their destinations (`#overlays`, `#session`).
  - Exact OBS URL copy with copy → check.
  - Chevron rotation; «Configurar» → builder; builder back link.
  - Keyboard focus ring and nudge; touch targets.
  - Reduced motion.
  - No overflow at 1920/1440/1280/768/390/360 on 5 pages, Fight Session and classic.
  - Text 200 %.
  - OBS isolation: no control icons and no app CSS in the overlay document.
- **Unit:** `src/components/ui/controls.test.tsx`:
  - icon accessibility and drawing style;
  - ActionLink semantics, kinds and the external hint in ES/EN;
  - copy → check, and failure keeps the copy icon;
  - no control glyphs in the catalogues or components (with a content allowlist);
  - motion-token contract and reduced motion.

  Also updated: tests that asserted the old glyph strings.

## 10. Performance (local production build, one run each; ± noise)

| Page (1440)             | JS transferred (KB) | CSS (KB)    | CLS             | DOM nodes |
| ----------------------- | ------------------- | ----------- | --------------- | --------- |
| PREPARE (Fight Session) | 234.9 → 236.7       | 22.9 → 23.3 | 0.0018 → 0.0022 | 379 → 400 |
| Classic dashboard       | 234.9 → 236.7       | 22.9 → 23.3 | 0.0001 → 0.0001 | 433 → 443 |
| Recap (Fight Session)   | 174.3 → 175.0       | 17.7 → 18.2 | 0 → 0           | 207 → 213 |
| Analytics               | 164.8 → 164.8       | 17.7 → 18.2 | 0 → 0           | 484 → 484 |
| Builder                 | 231.5 → 232.0       | 22.9 → 23.3 | 0.053 → 0.053   | 788 → 796 |

- **Bundles:** total client JS +5.2 KB raw; app CSS +1.6 KB raw (+456 B gzip).
- **Idle CPU on PREPARE:** 26 → 33 ms of task time per 30 s. Both are negligible; there are no
  animation loops.
- **Hover sweep under 4× CPU throttling:** 752 → 601 ms, which is Playwright-driven and noisy.
- **Long tasks** vary run to run in both directions (for example, builder 363 → 535 ms and
  onboarding 320 → 130 ms). No change in this PR runs on load, so these are treated as noise.
- **No speed improvement is claimed.**

## 11. Security / compatibility

- **Unchanged:**
  - session math, MR/LP persistence and observation rules;
  - Companion ingestion and SSE contracts;
  - the feature gate, auth and the schema;
  - the OBS URLs and renderer;
  - S-01 (Next 16.4.2) and S-02 (PDF admission).
- **No new dependency.** The overlay document has no motion tokens, control icons or app CSS
  (browser check).
