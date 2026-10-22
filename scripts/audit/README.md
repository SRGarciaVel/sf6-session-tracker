# Audit tooling (local only)

Measurement helpers for `docs/audit/2026-10-22-performance-security-review.md`. Every script
refuses non-loopback databases or apps. Never point them at production.

1. Build and start the app behind the wire probe (same credentials, the local database):

   ```bash
   pnpm build
   node scripts/audit/pg-wire-probe.mjs 5441 5433 5442 0 &       # last arg: added RTT in ms
   DATABASE_URL=postgres://…@localhost:5441/sf6_tracker SF6_PROVIDER=companion \
     APP_URL=http://localhost:3171 PORT=3171 TRACKER_RUNTIME_MODE=standalone pnpm start
   ```

   Use `TRACKER_RUNTIME_MODE=embedded` for the `idle` phase (production shape on Render).

2. Run the phases with a state file outside the repository:

   ```bash
   AUDIT_STATE=/tmp/audit.json pnpm exec tsx scripts/audit/measure.mts setup
   AUDIT_STATE=/tmp/audit.json pnpm exec tsx scripts/audit/measure.mts requests
   AUDIT_STATE=/tmp/audit.json pnpm exec tsx scripts/audit/measure.mts frontend
   AUDIT_STATE=/tmp/audit.json pnpm exec tsx scripts/audit/measure.mts interactions
   AUDIT_STATE=/tmp/audit.json pnpm exec tsx scripts/audit/waterfall.mts 0   # then restart the probe with 40
   AUDIT_STATE=/tmp/audit.json pnpm exec tsx scripts/audit/measure.mts cleanup
   pnpm exec tsx scripts/audit/explain.mts           # synthetic dataset, deleted afterwards
   pnpm exec tsx scripts/audit/concurrent-start.mts  # TEST_DATABASE_URL only
   ```

The `idle` phase needs `TRACKER_RUNTIME_MODE=embedded`, and the account in `setup` that is used
for Fight Session needs to be in `FIGHT_SESSION_UI_USERS`. The state file contains local device
tokens and session cookies of test accounts: keep it out of the repository and delete it after
`cleanup`.
