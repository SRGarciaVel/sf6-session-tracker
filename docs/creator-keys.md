# Creator Keys

Implements RFC 0001 **Phase 3**
([§12](rfc/0001-sst-open-core-multigame.md#12-creator-keys)): a one-time invitation key gives a
signed-in account **`creator_beta` for 90 days**.

In Phase 3 Creator Beta had the same effective entitlements as Free. **Since Phase 4** it also
unlocks advanced overlay customization ([creator-overlays.md](creator-overlays.md)).

## Lifecycle

```
operator CLI ──issue──▶ creator_key (HMAC only)        key shown ONCE to the operator
                          │  unredeemed for 30 days ⇒ expired (derived, no job)
streamer (signed in) ──redeem──▶ one transaction:
                          UPDATE creator_key … WHERE unredeemed AND unrevoked AND unexpired
                          INSERT entitlement_grant (creator_beta, 90 days, creator_key_id)
                          ▼
              resolver (Phase 2) ⇒ creator_beta until the grant expires
operator CLI ──revoke──▶ key unusable; optionally also its grant (--revoke-grant)
```

## Key format and cryptography

- **Format:** `SST-XXXX-XXXX-XXXX-XXXX-XXXX`, 20 Crockford Base32 characters (no I/L/O/U) from
  Node's CSPRNG (`randomBytes`, `byte & 31`, exactly uniform). That is **100 bits** of entropy.
- **Normalization:** `normalizeCreatorKey()` only trims and uppercases, then requires the exact
  format. No "O→0"-style corrections are needed or done: the alphabet has no ambiguous letters.
  Invalid input gets the same generic error as every other failure.
- **Storage:** `key_hash = HMAC-SHA-256(CREATOR_KEY_PEPPER, "sst:creator-key:v1:" + body)` as
  `bytea` (32 bytes, UNIQUE).
  - A keyed hash is the right primitive: keys are high-entropy and looked up directly, so a
    password hash (bcrypt/argon2) isn't needed.
  - The pepper means a database leak alone can't confirm or enumerate keys.
  - The plaintext is never stored, logged or shown again.
- **Hint:** the last 4 characters (`••••-ABCD`). Not secret; for support only.
- The public code (format, algorithm, schema) gives no advantage: security rests on the pepper,
  the 100-bit keys and the server-side controls. Self-hosters generate their own pepper and keys.

## Schema (`drizzle/0009_creator_keys.sql`, additive)

`creator_key`:

| Column                                                                | Notes                                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `id` uuid PK                                                          |                                                                                                     |
| `key_hash` bytea                                                      | **UNIQUE**; CHECK 32 bytes                                                                          |
| `key_hint`                                                            | CHECK `^[0-9A-HJKMNP-TV-Z]{4}$`                                                                     |
| `plan`, `grant_days`                                                  | frozen at issuance; CHECK `plan in ('creator_beta')`, `grant_days between 1 and 366` (issued as 90) |
| `issued_at`, `expires_at`                                             | CHECK `expires_at > issued_at` (issued with +30 days)                                               |
| `issued_by`, `issued_note`                                            | operator label (not an account); note ≤ 200 chars                                                   |
| `redeemed_by` → `auth_user(id)` **ON DELETE SET NULL**, `redeemed_at` | the audit row survives account deletion; CHECK `redeemed_by is null or redeemed_at is not null`     |
| `revoked_at`, `revoked_by`                                            | CHECK `revoked_by is null or revoked_at is not null`                                                |

`entitlement_grant` gains `creator_key_id` → `creator_key(id)` ON DELETE RESTRICT:

- a **partial UNIQUE** index, so there is at most one grant per key at the DB level;
- CHECK `(source = 'creator_key') = (creator_key_id is not null)`.

**State model.** There is no status column to keep in sync. State is derived from timestamps:

- redeemed = `redeemed_at` set;
- revoked = `revoked_at` set, **independent** of redemption (a redeemed key can later be
  revoked, and both facts stay true);
- expired = not redeemed and `expires_at <= now`.

Redeemable = not redeemed, not revoked, not expired. Rows are never deleted.

## Redeem (server action `redeemCreatorKeyAction`)

1. The user id comes **only** from the server session (`getCurrentUser`); the IP comes from
   `getClientIp`.
2. Rate limits run **first**, both **fail-closed**: if the limiter store is down, nobody redeems.
   - **5 attempts per 10 minutes per user**;
   - **20 attempts per hour per IP**.
3. Format check, then HMAC (no DB work for malformed input).
4. **One transaction:**
   - a conditional `UPDATE creator_key SET redeemed_by, redeemed_at WHERE key_hash = $1 AND
redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > now RETURNING plan, grant_days`;
   - if no row comes back: a generic failure;
   - otherwise `INSERT entitlement_grant (creator_beta, starts_at = now, expires_at = now +
grant_days, creator_key_id)`;
   - if the insert fails, the UPDATE rolls back and **the key stays redeemable** (tested with an
     injected DB failure).
5. **One-time use:** concurrent redeems of the same key serialize on the row. The loser's
   `WHERE` no longer matches (`redeemed_at` is now set), so it gets the generic failure. The
   partial unique index makes a second grant for a key impossible anyway. Tested with 6
   concurrent redeems: exactly 1 success and 1 grant.
6. **Generic error** for malformed, unknown, expired, revoked and already-used keys, and for a
   missing pepper outside production:
   - EN: "This Creator Key is invalid or unavailable."
   - ES: "Esta Creator Key no es válida o no está disponible."

   Rate limiting answers "Slow down — try again in N s".

7. **Success** shows "Creator Beta access activated" and the date it ends. Nothing else is
   returned: no key id, hash, operator or note.

**Multiple keys / renewal.** An account can redeem more keys over time. Each key creates an
**independent 90-day grant from its own redemption time**; grants are not summed. The resolver
shows the **latest** end among active grants. Renewal is manual: issue another key, or have an
operator insert a grant (`docs/entitlements.md`). There is no automatic renewal or billing.

**Logging.** Never logged: the plaintext key, the normalized key, the HMAC input, the pepper or
request bodies. The logger also redacts fields named `pepper`, `rawKey` and `plaintext`. Logged
events are `creator_key.issued`, `creator_key.redeem` (`outcome` = `success` | `invalid` |
`rate_limited` | `not_configured`, `userId`, plus `keyId`/`keyHint` only on success) and
`creator_key.revoked`. No emails. A test asserts no key or pepper text appears in the logs.

## Operator CLI

These commands run with **`OPERATOR_DATABASE_URL`** (the admin/operator connection). They never
fall back to `DATABASE_URL`. Each command first checks the connection's real privileges and
refuses if they're missing, which stops someone accidentally using the runtime role.

```bash
# issue (plaintext printed ONCE; needs the SAME CREATOR_KEY_PEPPER as the server)
OPERATOR_DATABASE_URL=… CREATOR_KEY_PEPPER=… pnpm creator-key:issue --by <operator> [--note "<streamer>"] [--count 1..20]

# list (never plaintext or hashes): id, hint, state, issued, expires, redeemed, revoked
OPERATOR_DATABASE_URL=… pnpm creator-key:list

# revoke by id (never by plaintext); --revoke-grant also ends access already granted
OPERATOR_DATABASE_URL=… pnpm creator-key:revoke --id <uuid> --by <operator> [--revoke-grant]
```

- `issue` refuses a placeholder pepper against a non-local database.
- Pass secrets as shell variables, never in files or history you keep.
- **No keys are issued by migrations, tests or deploys.** The first batch (10–20) is issued
  manually after the rollout check below.

**Revocation semantics:**

- **unredeemed key:** it stops being redeemable;
- **redeemed key:** without `--revoke-grant` only the key is marked; the user keeps access until
  the grant ends. With `--revoke-grant` the grant gets `revoked_at` and the user resolves to
  their base plan immediately.

Nothing is deleted.

## Production permissions (least privilege)

New tables give `sf6_app` **SELECT only** by default. Redemption needs exactly:

```sql
grant update (redeemed_by, redeemed_at) on table public.creator_key to sf6_app;  -- column-level
grant insert on table public.entitlement_grant to sf6_app;
-- (SELECT on both comes from the default privileges; verify below)
```

```sql
select has_table_privilege('sf6_app','public.creator_key','select')                                 as key_select,
       has_column_privilege('sf6_app','public.creator_key','redeemed_at','update')                  as key_update_redeem,
       has_column_privilege('sf6_app','public.creator_key','revoked_at','update')                   as key_update_revoke_must_be_false,
       has_table_privilege('sf6_app','public.creator_key','insert')                                 as key_insert_must_be_false,
       has_table_privilege('sf6_app','public.entitlement_grant','insert')                           as grant_insert,
       has_table_privilege('sf6_app','public.entitlement_grant','update')                           as grant_update_must_be_false;
```

- **Runtime never needs:**
  - `INSERT` on `creator_key` (issuing is the operator's job);
  - `UPDATE` of `revoked_*`, `key_hash` or `expires_at`;
  - `UPDATE`/`DELETE` on `entitlement_grant` (revocation is the operator's job);
  - `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, DDL or `BYPASSRLS`.

  FK checks and the `ON DELETE SET NULL` action run with the table owner's rights, not the
  runtime's.

- **Operator (admin) connection:** `INSERT`/`SELECT` on `creator_key`; `UPDATE` on
  `creator_key` and `entitlement_grant` for revocation.
- An integration test creates a temporary role with **exactly** the runtime grants above, redeems
  through it, and checks that the same role **cannot** issue or revoke.

## Pepper operations

- **Generate:** `openssl rand -hex 32` (64 hex chars). Required in production; at least 32 chars;
  placeholders are rejected at boot. It lives only in the server environment (Render) and in the
  operator's shell while issuing.
- **It's a stable secret.** Rotating it makes every **unredeemed** key unusable, because their
  HMACs no longer match. Redeemed keys and existing grants are unaffected. There is no
  multi-pepper rotation scheme.
- **If it leaks:**
  1. Generate a new pepper.
  2. Revoke all unredeemed keys (`creator-key:list` → `creator-key:revoke`).
  3. Deploy the new pepper.
  4. Issue new keys.

  A leaked pepper alone doesn't reveal keys. It helps only together with a database leak, and
  then only lets someone check guesses offline against 100-bit keys.

## Threat model

| Threat                                | Mitigation                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brute force / guessing                | 100-bit keys; fail-closed limits (5/10 min per user, 20/h per IP); generic errors; logged outcomes                                                       |
| Enumeration / state probing           | identical message for every failure; rate limit before any check; no key ids or state in responses                                                       |
| Database leak                         | only HMACs (with a pepper not stored in the DB); hints are 4 chars; notes are operator-chosen                                                            |
| Log leak                              | no key, normalized key, HMAC input or pepper is ever logged; logger redaction; test                                                                      |
| Double redeem race                    | single conditional `UPDATE … RETURNING` inside a transaction; partial unique index on `creator_key_id`; concurrency test                                 |
| Grant without key / key without grant | same transaction; injected-failure rollback test                                                                                                         |
| Compromised user account              | a key only ever grants the authenticated redeemer; operator can revoke key and grant                                                                     |
| Operator misuse                       | CLI with an audit trail (`issued_by`, `revoked_by`, timestamps); refuses the runtime role and placeholder peppers off-local; no public issuance endpoint |
| Pepper leak                           | rotate + revoke unredeemed keys + reissue (above)                                                                                                        |
| Client tampering                      | the redeem is a server action; the plan is resolved server-side; the UI displays only                                                                    |

## Rollout (production; not executed by the PR)

The pepper is validated at boot, so **set it before the new code deploys**:

1. Generate the pepper: `openssl rand -hex 32` (keep it in a password manager).
2. Render → Environment: add `CREATOR_KEY_PEPPER`. This redeploys the **current** code, which
   ignores it.
3. Apply the migration with the **admin** connection: `DATABASE_URL=<admin url> pnpm db:migrate`.
   It is additive, and the current code doesn't read the new objects.
   - **Preflight** (must return 0 rows, or the new CHECK fails):
     `select id from entitlement_grant where source = 'creator_key';`
4. Apply the runtime grants (above) and run the verification query.
5. Merge the PR → Render deploys.
6. Health check: `/api/health` returns 200; the dashboard shows the Creator Beta panel ("Plan: Free").
7. **Don't issue the batch yet.** Issue **one** test key:
   `OPERATOR_DATABASE_URL=… CREATOR_KEY_PEPPER=… pnpm creator-key:issue --by <you> --note "rollout test"`.
8. Redeem it with a test account. Expect "Creator Beta access activated" with a date about 90
   days out, and the panel shows "Creator Beta · Active until …".
9. Redeem the same key again: you should get the generic error. A bad key must give the same
   generic error.
10. Revoke the test grant if you want: `pnpm creator-key:revoke --id <id> --by <you> --revoke-grant`
    (the panel goes back to Free).
11. Only then issue the 10–20 beta keys.

## Rollback

- **Revert the code:** the redeem UI and action disappear. The tables stay (inert); unredeemed
  keys simply can't be used.
- **Existing grants** stay in `entitlement_grant`. The Phase 2 resolver still honours them
  (`creator_beta`, same entitlements as Free). To end them, revoke grants with the operator
  connection.
- **Nothing is dropped or deleted automatically.** Dropping `creator_key` would need removing the
  FK column first, in a separate, deliberate migration.
