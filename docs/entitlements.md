# Plans and entitlements

Implements RFC 0001 **Phase 2 — Entitlement foundation**
([§11](rfc/0001-sst-open-core-multigame.md#11-entitlements), [§17](rfc/0001-sst-open-core-multigame.md#17-incremental-roadmap)).
**No user-facing capability is removed or paywalled in Phase 2.**

## Plan vs entitlements

| Concept          | What it is                                       | Where                                                     |
| ---------------- | ------------------------------------------------ | --------------------------------------------------------- |
| **Plan**         | commercial label: `free` \| `creator_beta`       | `account_plan` (base) + `entitlement_grant` (time-bound)  |
| **Entitlements** | typed values the code checks (`overlays.max`, …) | derived in code from the effective plan; **never stored** |

```ts
// src/domain/entitlements/plans.ts (pure) — src/server/entitlements/service.ts (server authority)
const { overlays } = await getEntitlements(db, userId); // userId from the server session
```

**Rules**

- Features read **entitlements**, never plan ids. A static test enforces it: no plan-id
  comparisons outside the entitlements modules, and no client component imports the service.
- **The server is the only authority.** There is no plan in cookies, localStorage, env, query
  strings or `NEXT_PUBLIC_*`. If the UI ever shows "Plan: Free", it comes from
  `getPlanSummary()` (`{ plan }` only, never row ids, sources or dates) and is display-only.
- `plus`, `creator` and billing do **not** exist yet. **Creator Keys** (Phase 3) grant
  `creator_beta` for 90 days through `entitlement_grant` (`source = 'creator_key'`, linked by
  `creator_key_id`): see [creator-keys.md](creator-keys.md).

## Resolution and precedence

1. **Base plan:** the `account_plan` row, or **`free` when there is no row**. Existing accounts
   need no backfill.
2. **Grants:** every `entitlement_grant` that is **active**: `revoked_at IS NULL`,
   `starts_at <= now` and (`expires_at IS NULL` or `expires_at > now`). Expiry needs no write.
3. **Effective plan:** the highest-ranked of the base plan and the active grants
   (`free < creator_beta`). **A grant can only raise the plan, never lower it.** The result is
   deterministic regardless of row order.
4. **Entitlements** = `PLAN_ENTITLEMENTS[effectivePlan]`: deep-frozen, shared definitions.

**Why `entitlement_grant` exists already.** Phase 3's Creator Keys give **90-day,
manually renewable** `creator_beta` grants. Keeping "base plan" and "time-bound override"
separate now means Phase 3 only adds the key table and inserts a grant (`source = 'creator_key'`),
without reshaping this resolver. Grants carry no free-form JSON and no notes or secrets. They are
never deleted to downgrade: they expire or get revoked, which keeps the audit trail.

## Entitlement set (Phase 2)

| Key                     | free | creator_beta | Notes                                                                                       |
| ----------------------- | ---- | ------------ | ------------------------------------------------------------------------------------------- |
| `overlays.max`          | 10   | 10           | **10 is the current technical/product behaviour, not a final commercial Free policy.**      |
| `history.retentionDays` | null | null         | `null` = no retention policy (current behaviour: nothing is ever purged). Not enforced yet. |

**`creator_beta` is behaviour-equivalent to `free` in Phase 2.** The first Creator capability
(advanced overlay customization) arrives in Phase 4 as **new** entitlements, never by lowering
Free. The final Free limits are decided from beta usage data (RFC §11.4).

## Limits audit (what goes through the resolver)

| Limit                                                                                               | Where                                            | Class                | Through entitlements?                                          |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------- | -------------------------------------------------------------- |
| Max overlays per account (10)                                                                       | `createOverlayAction` → `canCreateOverlay()`     | **Product**          | **Yes** (`overlays.max`); same value, same message             |
| Dashboard history rows (10)                                                                         | `dashboard/page.tsx` `listSessionHistory(…, 10)` | **Display**          | No: older sessions stay reachable by id and nothing is deleted |
| Matches shown in a recap (200)                                                                      | `sessions/[id]/page.tsx`                         | **Display / safety** | No                                                             |
| History retention                                                                                   | none (no purge job)                              | Product (future)     | Scaffolding only (`retentionDays: null`)                       |
| Rate limits (session start, pairing, sync, auth, heartbeat, lookups)                                | `security/rate-limit.ts` call sites              | **Technical safety** | **Never**                                                      |
| SSE caps (per user / overlay / IP)                                                                  | `realtime/connection-limits.ts`                  | **Technical safety** | **Never**                                                      |
| Companion body size, sync interval, known replay ids, snapshot size, pairing TTL, device inactivity | `COMPANION_LIMITS`, companion service            | **Technical safety** | **Never**                                                      |
| Input validation (overlay name, config schema), worker concurrency, polling                         | domain/env                                       | **Technical safety** | **Never**                                                      |
| One active session per player, one player per account                                               | DB constraints                                   | **Domain invariant** | Out of scope                                                   |

## Downgrade safety (all phases)

**Losing a plan never deletes data.** Overlays, sessions, presets and history above a limit stay
readable and usable; only the **creation** of new resources is refused (`canCreateMore`). Premium
renderings must fall back to a fully functional core rendering.

## Public overlay (OBS)

The overlay endpoint has no viewer session. Entitlements are resolved for the **owner**, never
the viewer: `overlay.player_id → sf6_player.user_id → getEntitlements(owner)`. The path exists
today. Phase 2 changes nothing in rendering; Phase 4 will apply the owner's entitlements to the
public payload.

## Self-hosting

There is no edition system. The plan definitions live in public code (`PLAN_ENTITLEMENTS`), so a
self-hosted instance works with no `account_plan` rows: every account resolves to `free`. Operators
can change their own limits there.

## Database

Migration `drizzle/0008_entitlement_foundation.sql` is additive: no existing table changes and
no backfill.

- **`account_plan`**:
  - `user_id` is the PK, FK → `auth_user(id)` ON DELETE CASCADE;
  - `plan` has CHECK `in ('free','creator_beta')`;
  - `created_at`, `updated_at`.
- **`entitlement_grant`**:
  - `id` uuid PK; `user_id` FK → `auth_user(id)` ON DELETE CASCADE, with an index;
  - `plan` has CHECK `in ('creator_beta')`;
  - `source` has CHECK `in ('operator','creator_key')`;
  - `starts_at`, `expires_at` (nullable), `revoked_at`, `created_at`;
  - window CHECK `expires_at IS NULL OR expires_at > starts_at`.

**Production (Supabase)**

- Apply migrations with the **admin** connection, never with the runtime role.
- The runtime role `sf6_app` only needs to **read** these tables in Phase 2:

  ```sql
  grant select on table public.account_plan, public.entitlement_grant to sf6_app;
  -- verify:
  select has_table_privilege('sf6_app', 'public.account_plan', 'select'),
         has_table_privilege('sf6_app', 'public.entitlement_grant', 'select');
  ```

  If `sf6_app` already receives DML on new tables through default privileges, the grant is a
  no-op. Never grant `CREATE`, `ALTER`, `DROP` or `BYPASSRLS`.

- Plans and operator grants are set with the admin connection. Since Phase 3 the runtime also
  needs `INSERT` on `entitlement_grant` (Creator Key redeem only; never `UPDATE`/`DELETE`):
  see [creator-keys.md § Production permissions](creator-keys.md#production-permissions-least-privilege).
- The Data API stays disabled and `anon`/`authenticated` stay revoked. Plans are only read by the
  SST backend.

**Granting a plan manually** (operator, admin connection):

```sql
insert into account_plan (user_id, plan) values ('<user id>', 'creator_beta')
on conflict (user_id) do update set plan = excluded.plan, updated_at = now();

insert into entitlement_grant (user_id, plan, source, expires_at)
values ('<user id>', 'creator_beta', 'operator', now() + interval '90 days');
```

**Rollback.** Revert the code: nothing else reads these tables, so they become inert. Dropping
them is optional and should be a separate, deliberate migration (never automatic).
