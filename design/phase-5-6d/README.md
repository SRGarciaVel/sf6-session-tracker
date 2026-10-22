# Phase 5.6D — UX polish, overlay console and beta validation

This is the final stabilisation of the Fight Session experience (PREPARE → LIVE → RECAP), still
**allowlist-only** (`FIGHT_SESSION_UI_USERS`, see
[docs/fight-session-rollout.md](../../docs/fight-session-rollout.md)). There is no redesign, no
new feature, no schema change and no Companion change. Everything below was measured on a local
production build (`pnpm build && pnpm start`) against a local Postgres. Production was never used.

## 1. Audit (main `6259466`, before any change)

The «before» captures are in `screenshots/evidence/before--*`. Measurements come from
`e2e/ux.e2e.mts baseline` (Chromium 1440×900 unless noted).

| #   | Finding                                                                                                                                                                                                                        | Evidence                                      | Code                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------- |
| A1  | The broadcast console is **2203 px** tall with 3 overlays. Each row repeats name, kind, preview, canvas/language/theme readout, the full URL field and 3 actions. The first «Copiar URL» sits 394 px below the console top.    | `before--prepare--1440`                       | `_components/OverlaysPanel.tsx`                                               |
| A2  | Because the console spans two grid rows, «Historial de sesiones» starts ~700 px below the stage, leaving a large empty band (1440).                                                                                            | `before--prepare--1440`, `before--live--1440` | `dashboard/page.tsx` (fight grid)                                             |
| A3  | Connection state repeats in the strip (Companion + Buckler + sync) and in the Companion module, and a paired Companion reads «Conectado» even when Buckler data is missing.                                                    | `before--prepare--1440`                       | `SessionStatus.tsx` `StatusStrip`                                             |
| A4  | **Header overflow at 200 % text:** 142 px (1440), 558 px (1024), 533 px (768), 249–319 px (≤ 430). The same happens on the classic dashboard. Browser zoom 200 % was fine.                                                     | `before--header-text200--*`                   | `dashboard/layout.tsx` (`h-14`, no wrap), `.hud-tab { height: 100% }`         |
| A5  | After «Iniciar sesión de juego» the button unmounts and **keyboard focus falls to `<body>`**.                                                                                                                                  | manual                                        | `FightSessionDashboard.tsx`                                                   |
| A6  | A dropped live stream was **never shown**: the dashboard stream has no polling fallback, so its status went «connecting» (or stayed «open» during back-off) and the strip only reported «fallback».                            | E2E (server crash)                            | `use-event-stream.ts`, `FightStatusStrip`                                     |
| A7  | At 200 % text on phones the sticky header plus the fixed CTA covered about 70 % of an 844 px screen. Several grids with implicit `auto` columns overflowed (classic player header, telemetry band, history row, results form). | `text200--*`                                  | `layout.tsx`, `SessionControls.tsx`, `SessionPanel.tsx`, `SessionHistory.tsx` |
| A8  | «Copiar URL» → «✓ Copiado» changes the button width, so the neighbouring «Configurar» jumps.                                                                                                                                   | manual                                        | `components/ui/CopyButton.tsx`                                                |
| A9  | Small issues: the nav `aria-label="Main"` was hard-coded English, and «¿No tienes el Companion?» was a 20 px-tall target.                                                                                                      | code                                          | `NavTabs.tsx`, `CompanionPanel.tsx`                                           |

Kept as they are, because they work (real 30-match owner session and the 5.6B/C E2E):

- the PREPARE CTA and its hierarchy;
- the LIVE scoreboard;
- the `SessionResults` container-query fix (PR #69);
- the RECAP structure and its bounded strip and list.

**Found during QA, outside 5.6D's scope (reported, not changed):** the provider's 5 s profile
cache (`ResilientProvider`, `PROVIDER_CACHE_TTL_MS`) can hand a pre-sync profile to session
end, or to a session started right after another one ends. It then freezes a stale MR/LP (for
example ±0 instead of +12). The trigger is an end or start less than 5 s after another profile
read. The E2E waits past that window. This is a backend fix and needs its own PR.

## 2. What changed

**Overlay console (Fight Session only; the classic console stays detailed):**

- Every overlay row keeps the name, kind, a small live preview (same `OverlayView`),
  **Copiar URL para OBS** and **Configurar**.
- «Detalles» is a native `<details>` holding canvas, language, theme/style, the full URL field
  and «Abrir vista previa ↗». It works with keyboard and touch, with no hover-only UI.
- Accessible names carry the overlay name («Copiar URL para OBS de Progreso de rango»).
- No per-overlay OBS status is shown: the server only knows the account-wide count of connected
  sources, which stays in the heading.
- «Añadir a OBS» and «Creator beta» are folded under their headings (the plan stays visible).
  A `#creator-beta` link from the builder opens that module.
- The Companion module moves right under the overlays.
- **Result:** console 2203 → ~1277 px (−42 %); first «Copiar URL» 394 → 194 px from the top.

**Status («Seguimiento»):**

- One state derived from the existing `assessCompanion` plus the tracker (`trackingStatus`,
  `components/fight-session/adapters.ts`):
  - «Listo para registrar»;
  - «Registrando partidas»;
  - «Esperando sincronización»;
  - «Requiere atención: Companion desconectado / Inicia sesión en Buckler»;
  - «Companion sin señal»;
  - «Desconocido».
- A paired Companion without fresh Buckler data is never «ready».
- Warning states link to the Companion module («Ver diagnóstico»). The full diagnostics
  (Companion, Buckler, version, devices, pairing) are unchanged there.
- No new endpoint and no polling.

**Live stream:** «Panel en vivo ⚠ Reconectando…» appears whenever the stream is down after
having been open, never on the first connect. `useEventStream` now reports «connecting» as soon
as the stream closes. The overlay page ignores this status, so OBS rendering is unchanged.

**Focus and feedback:**

- After Start, focus moves to the LIVE heading, which enters once (260 ms). This never happens
  on page load.
- «✓ Copiado» swaps the text in place without changing the button width.
- Programmatically focused headings show no ring.
- The global `prefers-reduced-motion` rule flattens every animation.

**Header and reflow:**

- The header wraps instead of overflowing, on both dashboards.
- The header is sticky, and the mobile CTA fixed, only when the window is ≥ 36 em tall. Normal
  phones keep both; enlarged text gets the screen back.
- Implicit grid columns were made `minmax(0,1fr)`, history tracks shrink, labels and `hud-tag`
  wrap, and the classic score row stacks at ≤ 20 em.

**Layout:** the Fight Session grid uses `hud:grid-rows-[auto_1fr]`, so the history follows the
stage.

**i18n:** every new string is in `es.json` and `en.json`. Relative times use
`formatTimeAgo`, numbers use the existing formatters.

## 3. Verification

`e2e/ux.e2e.mts` has the phases `setup`, `baseline`, `run`, `rollback` and `cleanup`. It
refuses non-local database or app URLs and uses fictitious `@test.local` accounts. Companion
data goes through the real `/api/companion/sync` endpoint, sessions use the real UI and server
actions, and SSE is real. To run it:

```bash
E2E_STATE=/tmp/sst-e2e.json pnpm exec tsx design/phase-5-6d/e2e/ux.e2e.mts setup     # server without the allowlist
E2E_STATE=/tmp/sst-e2e.json E2E_SERVER_SCRIPT=/path/to/srv.sh pnpm exec tsx design/phase-5-6d/e2e/ux.e2e.mts run   # FIGHT_SESSION_UI_USERS=<A id>
E2E_STATE=/tmp/sst-e2e.json pnpm exec tsx design/phase-5-6d/e2e/ux.e2e.mts rollback  # server without the allowlist
E2E_STATE=/tmp/sst-e2e.json pnpm exec tsx design/phase-5-6d/e2e/ux.e2e.mts cleanup
```

`E2E_SERVER_SCRIPT` is optional. It restarts the local server (`start <ids>`) after the crash
test, which uses SIGKILL because a graceful stop keeps serving open streams.

**Run checks:**

- **Gate:**
  - A gets Fight Session.
  - B cannot force it with a query, cookie, header or localStorage.
  - B cannot open A's overlay builder.
  - `?ui=classic` still works.
- **Network:** one SSE stream on each dashboard.
- **Console:**
  - compact rows with details folded;
  - copy writes the exact `/overlay/<token>` URL, with visible and announced feedback;
  - Tab/Enter/Space work on «Detalles», with a visible focus ring;
  - the details show readout, URL and preview, and the preview is HTTP 200;
  - «Configurar» uses the same route;
  - `#creator-beta` opens the folded module.
- **Tracking:**
  - ready;
  - Companion silent: warning, diagnostics link and start blocked with the reason;
  - recovery.
- **Lifecycle:**
  - START by keyboard moves focus to the LIVE heading;
  - «Registrando partidas»;
  - a match arrives through SSE with «Nueva» and a polite announcement;
  - 1402 → 1414 +12, then 1405 (+3);
  - CLS during updates;
  - LIVE at 360/390/430/768 with a long opponent name;
  - server crash → «Reconectando…» → recovery;
  - End cancel returns focus to End;
  - END → RECAP (saved, 2 · 1 · 1 · 50 %, 1402 → 1405) → «Preparar otra sesión» → PREPARE.
- **Responsive:**
  - PREPARE and RECAP at 360×800, 390×844, 430×932, 768×1024, 1280×720, 1440×900 and
    1920×1080 (ES), plus 390 and 1440 (EN);
  - no overflow;
  - the fixed CTA never hides the end of the page;
  - every tap target is ≥ 24 px (WCAG 2.2 2.5.8).
- **Mobile flow:** «Ir a tus overlays» → copy by touch.
- **Text 200 %:**
  - Chromium's own default font size set to 32 px, so `em` media queries react as for a real
    user;
  - Fight dashboard, classic dashboard and RECAP at all 7 widths;
  - no overflow, sign-out and language reachable, no clipped header labels;
  - browser zoom 200 % (720 CSS px).
  - A CSS-only stress test (`html{font-size:200%}`, where breakpoints do not move) is recorded too.
- **Keyboard:** about 58 stops; START comes before the overlay actions; no trap; every stop
  has a visible focus.
- **Reduced motion:** start and the new-match feedback leave no running animation.
- **Long sessions:** 0, 30, 100 and 500 matches stored through the sync endpoint.
  - The recap strip is ≤ 30 and the list ≤ 20 visible.
  - No overflow at 390.
- **Integrity:**
  - overlay tokens unchanged;
  - no page errors or hydration warnings.
- **Rollback:** an empty allowlist gives the classic dashboard (detailed console) and the
  classic recap.

**Unit tests (new or updated):**

- `overlays-console-compact.test.tsx`: compact and expanded states, exact URL copy and stable
  width, routes, preview, OBS count only, zero overlays, EN, classic unchanged, folded modules,
  hash opening.
- `adapters.test.ts`: `trackingStatus` matrix.
- `fight-dashboard.test.tsx`: strip states.
- `fight-dashboard.interaction.test.tsx`: focus after start, none on load.
- `fight-dashboard.realtime.test.tsx`: dropped stream → «Reconectando…» → reopen, one stream.

## 4. Performance (local, methodology)

**Environment and method:**

- WSL2 Linux, Node 22, `next start` production build, local Postgres 5433, headless Chromium.
- SSR is the median of 5 authenticated `fetch` calls until the streamed body ends.
- DOM size is `document.querySelectorAll('*').length`.
- CLS comes from a `PerformanceObserver('layout-shift')` during LIVE updates.
- Client activity is the number of DOM mutations in 30 s on an idle PREPARE.

The figures are in `screenshots/evidence/e2e-metrics.json` (before: `baseline-metrics.json`) and summarised in the PR. Query counts were
not instrumented. By code, the recap runs `summarizeSessionRow` plus one bounded
`loadRecentMatches` query, the same as in 5.6C, and 5.6D adds no query.

## 5. Not in this phase

- New overlay kinds, builder redesign, replay analysis, MR/LP observation schema, per-match
  charts, Companion 0.5.0, migrations, global rollout and deployment.
- The 5 s provider-cache issue above (backend, separate PR).

## Files

- `e2e/ux.e2e.mts`: phases above.
- `beta-validation.md`: streamer checklist and feedback template.
- `screenshots/evidence/`: curated before/after captures and E2E JSON.
- `screenshots/full/`: every capture (git-ignored).
