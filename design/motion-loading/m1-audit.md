# M1 — Skeleton foundation and loading boundaries

This is the first phase of «SST Motion & Loading Experience». It covers a route-by-route loading
audit, a small CSS-only skeleton system, and four route boundaries chosen from evidence.

- **Base:** `main` `2b65ab1` (PR #72).
- **Environment:** every number below is local: WSL2, Node 22, `next start` production build,
  local Postgres, headless Chromium. Production was never used.

## 1. Route and loading inventory (before M1)

The only loading boundary was `src/app/(app)/dashboard/loading.tsx`. It was a centred card
reading «Cargando tu panel… Iniciando SST… Esto puede tardar unos segundos en la beta gratuita»,
and it was used by **every** `/dashboard/*` route on initial load and on each client navigation.

### Route by route

| #   | Route                                                      | Rendering and data                                                                                                                                                                                      | Boundary before                                              | Real waiting                                                                           | Auth / OBS                                                       | Decision                                                                                                                                                                         |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/dashboard` PREPARE (Fight Session, allowlist)            | Server: `requirePlayer`, `buildDashboardLiveState` (session engine, Companion signals, recent matches), overlays, history (10), devices, plan, entitlements. Client: `LiveDashboardProvider` (one SSE). | Dashboard card                                               | Yes. ~1.4–2.0 s to content with +40 ms per DB round trip; ~0.5 s client nav when fast. | Authenticated (`requireUser` in the layout, before the boundary) | **Skeleton** (`DashboardSkeleton`)                                                                                                                                               |
| 2   | `/dashboard` LIVE                                          | Same render. After it, everything comes from SSE snapshots (state replaced whole).                                                                                                                      | Same                                                         | Initial render only                                                                    | Authenticated                                                    | **Skeleton for the initial render only.** Realtime updates, pending MR/LP (5.5 hold), reconnects and Companion silence keep their own states. Nothing is replaced by a skeleton. |
| 3   | `/dashboard/sessions/[id]` RECAP (Fight Session + classic) | Server: `getOwnedSession` (IDOR-safe), engine summary, counted matches. No SSE.                                                                                                                         | Dashboard card (wrong layout and text)                       | Yes, ~0.6 s with slow DB                                                               | Authenticated; a non-owner gets not-found                        | **Skeleton** (`RecapSkeleton`). Fight Session «Ver resumen» becomes a `<Link>`: it used to reload the whole document.                                                            |
| 4   | Session history                                            | Server component inside `/dashboard` (`listSessionHistory`, 10 rows)                                                                                                                                    | Part of the dashboard                                        | Inside the dashboard render                                                            | Authenticated                                                    | Part of `DashboardSkeleton` (table-shaped rows on the real columns)                                                                                                              |
| 5   | `/dashboard/analytics`                                     | Server: `getPlayerAnalyticsForUser` (bounded queries, pure aggregation)                                                                                                                                 | Dashboard card                                               | Yes, ~0.6 s slow; ~0.4 s nav                                                           | Authenticated; no player → onboarding                            | **Skeleton** (`AnalyticsSkeleton`)                                                                                                                                               |
| 6   | Player page (`/onboarding`, the «Jugador» tab)             | Server: `requireUser`, player and devices; client `OnboardingFlow` with its own pending/error states                                                                                                    | None (outside `/dashboard`)                                  | Short. Navigation keeps the previous page until ready.                                 | Authenticated                                                    | **Unchanged.** Short render, and the actionable states belong to its client flow. Revisit in M4 with field data.                                                                 |
| 7   | Overlay management (dashboard console)                     | Server-rendered list inside `/dashboard`; previews use the live state                                                                                                                                   | Part of the dashboard                                        | Part of the dashboard                                                                  | Authenticated; URLs/tokens never in a skeleton                   | Part of `DashboardSkeleton` (thumbnails at 800×180, no URLs)                                                                                                                     |
| 8   | `/dashboard/overlays/[id]` Overlay Builder                 | Server: `getOwnedOverlay`, live state, entitlements, presets. Then all editing is **client state** (instant preview).                                                                                   | Dashboard card                                               | Initial render only                                                                    | Authenticated; entitlement data never shown before load          | **Skeleton for the initial render only** (`BuilderSkeleton`). Settings changes never show one.                                                                                   |
| 9   | `/overlay/[token]` OBS overlay                             | Separate root layout, transparent, no app CSS. Server renders the current numbers, then SSE.                                                                                                            | None, by design (blank until the real numbers; no 0–0 flash) | —                                                                                      | **Public, used in OBS**                                          | **Unchanged and isolated** (tested: no boundary, no skeleton, transparent, no app CSS)                                                                                           |
| 10  | Companion pairing (dashboard module + `/help/companion`)   | Client component inside `/dashboard` (pairing code, live device count); help page server-rendered                                                                                                       | Part of the dashboard / none                                 | Pairing has its own pending, expired and slow states                                   | Authenticated / public                                           | **Unchanged.** No skeleton for connection state: it would hide actionable states.                                                                                                |
| 11  | `/login`, `/signup` and auth transitions                   | Server shell + client `AuthForm` with pending state; redirects                                                                                                                                          | None                                                         | Form submit only (button pending)                                                      | Public                                                           | **Unchanged.** A boundary here would delay redirects.                                                                                                                            |
| 12  | Loading / empty / error states                             | `dashboard/error.tsx` (retry); `not-found`; empty analytics and recap states from the data                                                                                                              | —                                                            | —                                                                                      | —                                                                | **Unchanged.** Errors and empty states are never hidden behind skeletons.                                                                                                        |

### Problems found (measured, `metrics-before-*.json`)

1. **Flash on every client navigation.** Even with a fast server, the generic card was visible
   for **16–19 animation frames (~300 ms)** on dashboard, analytics and builder navigations.
2. **Wrong geometry.** The card replaced the whole page with a 512 px box, and the destination
   (analytics, recap, builder) looked nothing like it.
3. **Misleading text.** «Iniciando SST… beta gratuita» appeared on ordinary navigations, not
   only on cold starts.
4. **Full document reload for the recap.** The Fight Session «Ver resumen» was a plain `<a>`.
   Opening the recap reloaded the document: 42 requests, and a new JS boot.
5. **Accessibility.** The card was a `role="status"` with two text nodes. It was announced on
   every navigation, with no `aria-busy` on the region.
6. **Pre-existing, outside M1** (recorded for a later accessibility pass): with text at 200 %
   on a 390 px phone, the **loaded** analytics page overflows by about 149 px (filters) and the
   **loaded** builder by about 189 px (tabs and canvas controls).

## 2. Strategy per route

- **Route `loading.tsx` boundaries.** These are server components with no data, no auth call
  and no per-account decision, for:
  - `/dashboard`;
  - `/dashboard/analytics`;
  - `/dashboard/sessions/[id]`;
  - `/dashboard/overlays/[id]`.

  The nearest boundary wins, so each route shows its own footprint.

- **Why not nested Suspense inside the pages.** The pages compute everything up front, and the
  dashboard state must arrive whole: it is the SSE provider's initial snapshot. Splitting it
  would reset known session state or duplicate queries. Route boundaries cover the real wait at
  no data cost.
- **Same skeleton for both UIs.** The boundary renders before the Fight Session / classic
  decision. Making it account-aware would cost a session lookup on every prefetch and would
  expose the gate before access checks. Both dashboards share the 400 px console column; the
  left column follows the Fight Session layout.
- **No flash for fast responses.** The region becomes visible only after **150 ms** (CSS
  animation delay). Nothing is artificially delayed: content replaces the boundary as soon as
  it streams in.
- **Cold-start hint after 2.5 s only.** «Está tardando más de lo normal… la beta gratuita puede
  tardar en arrancar».
- **Prefetch.** Next only shows a route's loading segment once its link has been prefetched,
  which happens when the link is in the viewport. Before that the previous page stays until the
  server answers. This is framework behaviour and unchanged.
- **Unchanged:**
  - LIVE realtime semantics (SSE, held ratings, PR #72 observation times);
  - the builder's live preview;
  - Companion states;
  - auth;
  - the OBS route.

## 3. Skeleton components (`src/components/loading/`)

| Component                                                                    | Purpose                                                                         | Notes                                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LoadingRegion`                                                              | The busy region of a route                                                      | `data-skeleton`, `aria-busy="true"`, **one** `role="status"` with a plain label (not repeated), shapes in `aria-hidden`, delayed cold-start hint |
| `SkeletonBlock`                                                              | Surface block; `tone` = base / soft / accent; `cut` = Fight Session forward cut | Never contains text                                                                                                                              |
| `SkeletonText`                                                               | Lines at the size of the text they stand for                                    | Height in `em`, so translations and text scaling keep their proportions; uneven widths                                                           |
| `SkeletonNumber`                                                             | Display numeral box (scoreboard, results)                                       | `0.82em` at the numeral's font size; shows no digits                                                                                             |
| `SkeletonThumbnail`                                                          | Overlay preview at its real aspect ratio                                        | 800×180                                                                                                                                          |
| `DashboardSkeleton`, `AnalyticsSkeleton`, `RecapSkeleton`, `BuilderSkeleton` | Route footprints                                                                | Same grids and tracks as the loaded pages (`minmax(0,1fr)` columns, 400 px console, analytics 232 px nav, builder `26rem` editor)                |

**Style:**

- surface-3 blocks with a `line-strong` border, `line-strong` text lines and a magenta accent
  only where the real page has its primary action (CTA, Copy OBS URL);
- the angular cut on control shapes;
- no glow;
- shapes never show text, digits, statuses or ratings: this is unit-tested, the rendered text
  is the empty string.

**Motion (CSS only, about 2.6 KB raw / +516 B gzip in the app stylesheet; JS +18 B):**

- a 180 ms fade-in after 150 ms;
- one opacity pulse (0.75 ↔ 1) on the shapes container: a single layer, with no gradients,
  filters, blur or transforms;
- `prefers-reduced-motion: reduce`: the global rule collapses every animation to its static end
  state (verified: 0 running animations, opacity 1).

## 4. Measurements

**Method:** `e2e/m1.e2e.mts`, Playwright Chromium 1440×900.

- An init script records every animation frame: whether a loading marker is visible (old card
  or `[data-skeleton]`, opacity > 0.05) and whether the route's content marker exists.
- It also records CLS (layout-shift without input) and long tasks.
- **Fast:** local DB.
- **Slow:** `e2e/latency-proxy.mjs` adds 40 ms to every DB round trip.
- **Navigation:** a real link click from another page; «slow nav» holds the RSC response for
  1.5 s.
- **Runs:** each figure is a single run, so expect about ±100 ms of noise on times.
- **CPU:** CDP `TaskDuration` over 3 s while the loading state is shown, then over 3 s idle.

### Fast (local DB)

CPU during loading, 3 s: 5 ms before / 12 ms after. Idle after load, 3 s: 0 / 0 ms.

| Route                   | Initial load: content (ms) | CLS             | Requests | SSE   | Fast nav: loading frames | Nav content (ms)      | Held nav content (ms) |
| ----------------------- | -------------------------- | --------------- | -------- | ----- | ------------------------ | --------------------- | --------------------- |
| Fight Session dashboard | 566 → 578                  | 0.0041 → 0.0031 | 54 → 54  | 1 → 1 | **16 → 3**               | 506 → 595             | 1978 → 1925           |
| Fight Session analytics | 184 → 168                  | 0.0016 → 0.0008 | 41 → 44  | 0 → 0 | **18 → 7**               | 408 → 433             | 1624 → 1597           |
| Fight Session recap     | 178 → 156                  | 0.0016 → 0.0008 | 42 → 42  | 0 → 0 | 1 → 0                    | full reload → **153** | full reload → 1599    |
| Fight Session builder   | 203 → 201                  | 0.0544 → 0.0544 | 46 → 46  | 1 → 1 | **19 → 6**               | 496 → 591             | 1752 → 1756           |
| Classic dashboard       | 172 → 162                  | 0.0016 → 0.0016 | 52 → 52  | 1 → 1 | **16 → 6**               | 478 → 522             | 1898 → 1870           |
| Classic analytics       | 177 → 157                  | 0.0007 → 0.0007 | 44 → 41  | 0 → 0 | **18 → 0**               | 409 → 133             | 1616 → 1674           |
| Classic recap           | 297 → 166                  | 0.0007 → 0.0015 | 42 → 42  | 0 → 0 | 1 → 0                    | 137 → 101             | 1589 → 1586           |
| Classic builder         | 160 → 180                  | 0.0544 → 0.0544 | 46 → 46  | 1 → 1 | **19 → 7**               | 535 → 595             | 1735 → 1746           |

### Slow (+40 ms per DB round trip)

CPU during loading, 3 s: 4 ms before / 8 ms after. Idle, 3 s: 1 / 1 ms.

| Route                   | Initial load: content (ms) | CLS             | Fast nav: loading frames | Nav content (ms)  |
| ----------------------- | -------------------------- | --------------- | ------------------------ | ----------------- |
| Fight Session dashboard | 2020 → 1839                | 0.0027 → 0.0028 | 53 → 44                  | 1134 → 1350       |
| Fight Session analytics | 597 → 615                  | 0.0016 → 0.0016 | 31 → 21                  | 605 → 578         |
| Fight Session recap     | 588 → 559                  | 0.0016 → 0.0008 | 16 → 17                  | full reload → 573 |
| Fight Session builder   | 1266 → 951                 | 0.0544 → 0.0538 | 48 → 39                  | 994 → 1146        |
| Classic dashboard       | 1401 → 1487                | 0.0016 → 0.0016 | 53 → 42                  | 1100 → 1177       |
| Classic analytics       | 571 → 624                  | 0.0007 → 0.0015 | 30 → 20                  | 612 → 575         |
| Classic recap           | 595 → 643                  | 0.0015 → 0.0015 | 24 → 13                  | 505 → 497         |
| Classic builder         | 1193 → 1421                | 0.0544 → 0.0544 | 47 → 36                  | 991 → 975         |

### Reading

- **Faster?** No. Time to content is unchanged within run-to-run noise, in both directions.
  Skeletons change perceived continuity, not latency.
- **Flash:** the visible loading flash on fast navigations drops from 16–19 frames to 0–7.
- **Fight Session recap:** it is now a client navigation (no document reload).
- **CLS:** unchanged.
  - The builder's 0.054 is the builder's own layout after hydration, before and after M1.
  - The 0.096 on the mobile Fight Session dashboard navigation is also identical before and
    after.
- **Requests and SSE:** same request counts within noise, and the same single SSE stream on the
  dashboard and builder. No new endpoints, no polling.
- **Pulse cost:** under 0.4 % of one core.
- **Long tasks:** unchanged.

## 5. Accessibility

- **Announcement:** one `role="status"` per loading region with a route-specific label
  («Cargando las analíticas…»), announced once. The region has `aria-busy="true"`.
- **Decorative shapes:** `aria-hidden`, with nothing focusable. Verified in the browser:
  0 links, buttons or tabindex inside.
- **Focus:** after load, the App Router's normal focus handling applies; nothing is trapped
  behind pending content.
- **Reduced motion:** static shapes at full opacity, no running animation (browser check on all
  4 routes).
- **Text 200 %** (Chromium's own default font size at 32 px): the skeletons of all 4 routes have
  no horizontal overflow at 1440 and 390. The pre-existing overflow of the **loaded** analytics
  and builder pages at 390 is listed in §1.

## 6. Verification

- **Unit:** `src/components/loading/skeleton.test.tsx`, 23 tests:
  - semantics; no text or digits in any skeleton;
  - nothing focusable;
  - server-only, with no data access in boundaries or skeletons;
  - ES/EN labels; rendered boundary;
  - CSS motion contract and reduced-motion rule;
  - OBS isolation.
- **Browser** (`e2e/m1.e2e.mts capture after-*`), **60/60 checks with a fast DB and 60/60 with a
  slow DB.** For Fight Session and classic, ES and EN, and the 4 routes:
  - the skeleton is shown while the route renders, labelled once, with no data and nothing
    focusable;
  - no horizontal overflow at 1920/1440/1280/768/390/360;
  - the content replaces the skeleton, with at most 1 SSE stream and no page errors;
  - text 200 % at 1440 and 390;
  - reduced motion.
- **Classic dashboard:** same boundaries; measured above; no change to its components.
- **Evidence:** `screenshots/evidence/`:
  - `before--*`: the old card;
  - `after--*`: skeletons and loaded pages at 1440 and 390, EN and text 200 %;
  - `after--frames-nav-{fast,slow}.jpg`: frame sequences;
  - `metrics-*.json`, `checks-*.json`.

## 7. Deferred work

- **M2 (motion):** PREPARE → LIVE → RECAP choreography and page transitions, on top of these
  boundaries.
- **M3:** realtime feedback refinements (they stay domain states, never skeletons).
- **M4:**
  - onboarding / player page boundary, if field data shows real waits;
  - a skeleton for the PDF review download (route handler, not a page);
  - the **pre-existing 200 % text overflow of the loaded analytics filters and builder tabs**
    at 390 px;
  - field timing from Render (cold starts) to tune the 150 ms / 2.5 s thresholds.

## 8. Risks

- **Fast-response flash:** below about 150 ms nothing shows (a brief empty area under the
  header). Between 150 and 300 ms a short fade can still show.
- **Recap width:** the shared recap skeleton sits between the classic (`max-w-3xl`) and Fight
  Session (`max-w-5xl`) widths. The replacement is a swap, not a shift (CLS unchanged).
- **Single runs:** the timings are single local runs. Production latency (Render, Supabase) is
  not measured here.
