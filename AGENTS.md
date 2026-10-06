<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SST (Session Stats Tracker) — project rules

- Architecture & decisions: `docs/architecture.md`. Read it before structural changes.
- Session math lives ONLY in `src/domain/session/engine.ts` (pure, unit tested). Never compute
  W/L, win rate, streaks or deltas in React, API routes, the worker or the provider.
- Ratings (rank/LP/MR) belong to a CHARACTER (`characterKey`), never to the player. Never
  subtract ratings of different characters, systems (MR vs LP) or phases; unknown ⇒ `null`.
- Capcom/CFN access lives ONLY in `src/server/sf6/providers/*` behind `SF6DataProvider`.
- Matches enter the system only through `src/server/ingestion/ingest.ts` (dedupe + session
  assignment under lock). Realtime events are invalidation signals; clients receive full state.
- Overlay CSS (`src/components/overlay/overlay.css`) must stay OBS/CEF-safe: no Tailwind, no
  oklch()/color-mix()/container queries/:has().
- No hardcoded user-facing text: add keys to BOTH `src/i18n/messages/es.json` and `en.json` (or
  the `overlay.*.json` catalogs for OBS text) and format numbers/dates via `src/domain/format.ts`.
- Visual system: use the tokens/classes in `src/app/(app)/globals.css` (`hud-panel`, `hud-heading`,
  `hud-label`, `hud-tag`, `btn-*`, `hud-row`) — no rounded SaaS cards, no ad-hoc hex colors.
- Before committing: `pnpm check` (typecheck + lint + tests; integration tests need
  `TEST_DATABASE_URL`) and `pnpm build`. Don't silence errors with ts-ignore/eslint-disable/any.
