# Phase 5.6A — Session Experience & Visual Identity

This is a design exploration for SST's session lifecycle (**Prepare → Live → Recap**). It
contains an audit of the current UI and two interactive directions. **Nothing here changes
production.** The prototypes are static files served by a local, file-only server: they are
not part of the Next.js build, are not routed by the app and never call SST.

| Document                                         | Content                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [audit.md](audit.md)                             | Current UI audit: strengths, findings (high/medium/cosmetic), accessibility, data constraint                 |
| [design-directions.md](design-directions.md)     | Direction A (Broadcast Control) and B (Fight Session): concepts, design systems, motion, reusable components |
| [comparison.md](comparison.md)                   | Task-based heuristic comparison, matrix, **recommendation (B-led hybrid)**                                   |
| [implementation-plan.md](implementation-plan.md) | Phase 5.6B–D PR plan, dependencies, expected code changes                                                    |
| `screenshots/evidence/`                          | Curated screenshots (current UI + both prototypes, desktop/laptop/mobile, ES/EN) and QA JSON                 |

## Open the prototypes

```bash
node design/phase-5-6a/prototypes/serve.mjs
```

Then open <http://127.0.0.1:4173/>, which links to **A** (`/broadcast-control/`) and **B**
(`/fight-session/`).

Each prototype has a **Prototype controls** drawer (bottom right) where you can:

- switch the moment (Prepare / Live / Recap);
- set the Companion to connected, no signal or disconnected;
- simulate a win or a loss (the MR is "pending" for about 1.8 s, then confirmed);
- change the language (ES/EN);
- jump to named scenarios.

Deep links: `#scenario=live-pending&lang=en`, `#view=overlays`, `#lab=hide` (no drawer). Use
your browser's device toolbar for the mobile layout.

The scenarios are `prepare-first`, `prepare`, `prepare-offline`, `live-empty`, `live`,
`live-pending`, `live-offline`, `recap`, `recap-norating` and `recap-empty`.

## Re-run the evidence

QA of the prototypes (needs the server above): screenshots of all scenarios × 3 viewports, plus
overflow, clipping and target-size checks, the click-through flow, the Tab order and reduced
motion.

```bash
pnpm exec tsx design/phase-5-6a/prototypes/qa.mts
```

The audit of the current UI needs a local production build on port 3171 (companion mode) and a
**local** Postgres. The script refuses anything else, creates a `@test.local` account and
deletes it at the end.

```bash
pnpm exec tsx design/phase-5-6a/audit/capture-current.mts
```

The full screenshot sets (`screenshots/current/`, `screenshots/prototypes/`) are git-ignored;
`screenshots/evidence/` is the committed subset.

## Data

- The data is fictional: player «Yasmine», CFN `9990000200`, main Ryu (MASTER).
- The session baseline is 1571 MR. The script has 10 matches (7V–3D, 1571 → 1613, +42).
- The previous session was 4V–2D (1532 → 1571, +39).
- Opponents are character names only. No ranking positions are shown.
- The derivations in `prototypes/shared/engine.js` mirror the engine's rules:
  - win rate over decided games, unknown with none;
  - the session delta;
  - a held MR while pending;
  - null when unknown.
- Per-match MR is marked **CONCEPTO**: SST does not store it today (see `audit.md`).

## Safety

- The work touches no production routes, components, APIs, migrations, Supabase or Render.
- The prototype server binds to `127.0.0.1` and only serves:
  - this folder;
  - the repo's OFL fonts (`src/server/analytics/report/fonts/`);
  - `public/brand/`;
  - the screenshots.
- The prototype controls mutate in-memory state only (no fetch, no storage).
