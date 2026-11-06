# Proposed database hardening (NOT APPLIED)

Status: **proposal only. Nothing here has been run against the production Supabase project.**
It needs the owner's separate approval first.

## What was found (read-only checks, 2026-11-06)

| Function | What it is | Who can execute it now |
|---|---|---|
| `public.rls_auto_enable()` | Supabase platform helper. Returns `event_trigger`. Used by the event trigger `ensure_rls` (on `ddl_command_end`). Not created by our migrations. | PUBLIC, anon, authenticated, service_role |
| `public.set_updated_at()` | Ours. Returns `trigger`. Used by 9 row triggers. | PUBLIC, anon, authenticated, service_role |

Both can be called through the REST API (`/rest/v1/rpc/...`) by signed-out visitors. Because they return
trigger types, a direct call fails instead of doing anything, so there is no known way to misuse them. The
Supabase advisor still lists `rls_auto_enable` as a warning.

## Proposed SQL

```sql
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.set_updated_at()  from public, anon, authenticated;
```

`service_role` and the owner (`postgres`) keep access.

## Evidence it is safe (local PostgreSQL 16 experiment, not production)

After revoking EXECUTE from PUBLIC: a low-privilege role's single `CREATE TABLE` still fired the event trigger
exactly once, and an `UPDATE` by that role still ran the row trigger. PostgreSQL checks EXECUTE when a trigger
is created, not each time it fires. Production runs PostgreSQL 17; the same experiment has not been run there.

## Side effects and risks

* A direct RPC call to either function now returns "permission denied" (nobody should be calling them).
* `rls_auto_enable` is managed by Supabase. A platform update could restore the old grant, so the warning may return.
* If revoking ever caused trouble, undo with `grant execute on function ... to public;`.

## Not proposed (must stay as is)

* `is_admin()`: RLS policies call it as the signed-in or anonymous caller, so those roles need EXECUTE.
  It takes no arguments and only returns whether the caller is an admin.
* `delete_my_account()`: signed-in users need it; anon is already denied.

## Is it necessary?

No. It is defence in depth and clears an advisor warning. The practical risk today is very low.
If approved, it should be applied as a new numbered migration in `supabase/migrations/` and re-checked.
