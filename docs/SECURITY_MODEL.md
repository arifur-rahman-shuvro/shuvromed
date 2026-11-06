# Security model (Phase 2)

- Every table in `public` has RLS enabled (enforced by a test that fails if a new table does not).
- `anon` (signed out) can read only active subjects/topics and **Published** questions. It has no privileges on user tables.
- A signed-in user can read/write only rows where `user_id = auth.uid()`. `user_id` can never be reassigned.
- `attempts` and `user_achievements` are append-only for users. Attempt ids are client-generated, so a retried upload cannot double count.
- Bookmarks cannot point into another user's collection, and attempts cannot point at another user's session (composite foreign keys).
- Admin = a row in `public.admins`, which API roles cannot read or write. Admins manage the catalogue and see/resolve flags.
- Questions marked `unreviewed` can never be `published` (database constraint, applies to every role).
- `backup_runs` is admin-read, service-role-write, and a "success" row must carry size, SHA-256 and destination.
- `delete_my_account()` deletes only the caller and cascades to all their data.
- All `SECURITY DEFINER` functions pin `search_path` (tested).

## Known limits
- `is_correct` on attempts is supplied by the client (answers live in static JSON), so a user can falsify only their own statistics.
- Topic cycles longer than one level (A to B to A) are not blocked by the database; the Phase 3 content validator must catch them.
- A user can insert their own `user_achievements` (gamification is client-computed).
- Migrations were applied to the hosted project on 2026-11-06 and a rolled-back isolation script confirmed the key guarantees on PostgreSQL 17. The Supabase security advisor then showed 0 errors; the WARN items are `is_admin()` and `delete_my_account()` being RPC-callable (intentional) and the platform helper below.
- The hosted project already has a platform helper `public.rls_auto_enable()` (event trigger `ensure_rls`) that Supabase's advisor flags as callable through the API. It is not part of these migrations and has not been changed.
