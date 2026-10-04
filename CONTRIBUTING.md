# Contributing

Thanks for helping! The project is pre-beta, so small, focused changes are easiest to review.

## Workflow

1. Fork the repo (or create a branch if you have access): `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
2. Set up locally (see [Quick start](README.md#quick-start)):
   ```bash
   corepack enable pnpm
   pnpm install
   cp .env.example .env
   docker compose up -d
   pnpm db:migrate
   DATABASE_URL=postgres://sf6:sf6@localhost:5433/sf6_tracker_test pnpm db:migrate
   ```
3. Make your change. Read [AGENTS.md](AGENTS.md) for the project rules: session maths only in
   `src/domain/session/engine.ts`, ratings belong to characters, Capcom access only through
   providers, matches only through ingestion, no hard-coded user-facing text (es + en).
4. Before opening a PR, everything must pass:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm companion:build
   ```
   CI runs the same checks, including the integration tests against Postgres.
5. Open a pull request describing **what** changed and **why**, and how you tested it.

## Rules

- **Never commit secrets:** `.env` files, tokens, cookies, HAR captures, browser profiles or
  database dumps. `.gitignore` covers the usual paths. If you add test data from Buckler, sanitize
  it the same way as `scripts/research/make_capcom_fixtures.py` (an allow-list, no cookies or
  headers).
- Don't silence type or lint errors (`@ts-ignore`, `eslint-disable`, `any`). Fix the cause.
- Add or update tests for behaviour changes. Security fixes get a regression test.
- No automation of Capcom login, no anti-bot evasion, no scraping of other players.

## Commit messages

Use the conventional style already in the history: `type(scope): summary`, for example
`feat(companion): …`, `fix(security): …`, `docs(readme): …`, `chore(dev): …`, `test: …`. Keep the
summary short and explain the _why_ in the body.

## Security issues

Do **not** open public issues for vulnerabilities. See [SECURITY.md](.github/SECURITY.md).
