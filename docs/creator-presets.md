# Creator presets

RFC 0001 **Phase 4.5** (Creator Overlay Suite). A Creator preset is a saved overlay **look** that
can be applied to any of the account's overlays. Entitlement: `overlays.creatorPresets`
([entitlements.md](entitlements.md)).

## What a preset contains (appearance only)

`src/domain/overlay/presets.ts` defines `presetAppearanceSchema`, a strict pick of the overlay
config schema that rejects unknown keys.

| Included                                                                                                                                          | Never included                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| theme and canvas                                                                                                                                  | title **text**, overlay language, rating character, stats scope |
| colors, background and opacity, border, radius                                                                                                    | session, W/L, win rate, MR/LP, rank or streak values            |
| font, scale, spacing, alignment, animations                                                                                                       | player, CFN id, overlay id or public token                      |
| which stats are visible (`fields` booleans) and `showTitle`                                                                                       | plan, entitlements, grants or Creator Key data                  |
| Creator block (`config.creator`, incl. motion and automatic presentation: mode, transition, direction, …) and Creator theme variants (`variants`) | custom CSS, HTML, URLs, fonts by URL (none exist)               |

Rank-aware themes derive their style from the **live** rank at render time. A preset never
stores a rank or a rank style.

## Storage

Migration `drizzle/0010_creator_overlay_presets.sql` is **additive**. It doesn't touch `overlay`,
`creator_key`, the SF6 tables or sessions/matches.

```
creator_overlay_preset
  id          uuid PK default gen_random_uuid()
  user_id     text NOT NULL → auth_user(id) ON DELETE CASCADE   (index with created_at)
  name        text NOT NULL   CHECK length 1..40
  config      jsonb NOT NULL  CHECK jsonb_typeof = 'object' AND octet_length(config::text) <= 8192
  created_at, updated_at timestamptz
```

The DB CHECKs back up the app validation: a strict schema, a 40-character name and an 8 KB size
limit. Rows that no longer parse, for example after a future schema change, are **listed as
invalid** and can be deleted but never applied.

## Operations and rules (`src/server/overlays/presets.ts`)

| Operation                      | Needs `creatorPresets` | Notes                                                       |
| ------------------------------ | ---------------------- | ----------------------------------------------------------- |
| List (builder)                 | no                     | own presets only; the page sends `{ id, name, theme }` only |
| Create from the current editor | **yes**                | the editor config is validated, then reduced to appearance  |
| Rename                         | **yes**                |                                                             |
| Duplicate                      | **yes**                | counts toward the limit                                     |
| Update from the current editor | **yes**                |                                                             |
| Apply to an overlay            | **yes**                | see below                                                   |
| Delete                         | no                     | your data stays yours, even after a downgrade               |

- **Ownership.** Every query is scoped by `user_id` from the server session, and overlays by
  `getOwnedOverlay`. Another account's preset id, or an unknown one, behaves exactly like a
  missing one (`not_found`), so there is no IDOR and no existence oracle. This is
  integration-tested for rename, update, duplicate, delete and both apply directions.
- **Apply = stored → entitlements → effective.** The applied config is the stored overlay with
  the preset's appearance on top; title, language, rating character and stats scope are kept. It then goes
  through `prepareOverlayConfigForSave` (the same owner-entitled save rules as the editor) and is
  persisted. Renderers then use the effective config as always. A preset can never install
  anything the owner isn't entitled to. Apply saves immediately, and the builder asks for
  confirmation, warning when unsaved editor changes would be discarded.
- **Technical limit:** 20 presets per account, enforced under a per-account
  `pg_advisory_xact_lock`, so concurrent creates can't exceed it (tested with 25 parallel
  creates). This is a safety bound, **not a commercial policy**.

## Downgrade and renewal

- Presets are **kept**: never deleted or modified by a plan change.
- Without the entitlement, the builder shows: **"Your Creator presets are saved. Renew Creator
  access to use them again."** Presets stay listed with only **Delete** available. Apply, create,
  rename, duplicate and update are refused server-side (`not_entitled`), whatever the client
  sends.
- On renewal they work again unchanged.
- Account deletion removes them (FK cascade).

## Production permissions (least privilege)

Apply the migration with the **admin** connection. New tables give the runtime role `sf6_app`
**SELECT only** by default (hardened default privileges), and presets need DML from the app:

```sql
grant select, insert, update, delete on table public.creator_overlay_preset to sf6_app;
-- verify (all true):
select has_table_privilege('sf6_app', 'public.creator_overlay_preset', 'select') as sel,
       has_table_privilege('sf6_app', 'public.creator_overlay_preset', 'insert') as ins,
       has_table_privilege('sf6_app', 'public.creator_overlay_preset', 'update') as upd,
       has_table_privilege('sf6_app', 'public.creator_overlay_preset', 'delete') as del;
```

No DDL, `TRUNCATE`, `REFERENCES`, `TRIGGER` or `BYPASSRLS`. The advisory lock needs no grant.
The Data API stays disabled and `anon`/`authenticated` stay revoked.

**Rollback.** Revert the code: nothing else reads the table, so it becomes inert. Dropping it
deletes users' presets, so don't drop it unless that is intended.
