# ShuvroMed — PROGRESS

Last updated: 2026-11-06

## Done
- Preflight + free-tier limits (docs/FREE_TIER.md).
- Phase 1: scaffold, design system, layout, landing, dashboard shell.
- Phase 2:
  - 4 SQL migrations (supabase/migrations): catalogue, per-user tables, strict RLS, signup trigger, `delete_my_account()`, `backup_runs` guards.
  - 78 real-PostgreSQL tests (`npm run test:db`) incl. cross-user isolation and structural guards.
  - Supabase auth in the frontend: sign up, sign in, sign out, forgot/reset password, protected `/app`, session persistence, not-configured screen. 30 UI tests (`npm test`).
  - Migrations APPLIED to the hosted project (jnpqrwutxwjoyoxntfbt, Postgres 17) on 2026-11-06; verified there (see below).
  - CI workflow written (.github/workflows/ci.yml); not yet run on GitHub.

## Verified by running (2026-11-06)
- `npm run typecheck`: clean. `npm test`: 30/30. `npm run test:db`: 78/78 (local PostgreSQL 16 + shim).
- `npm run build`: succeeds. Real publishable key is not in the bundle.
- Hosted project: all 16 public tables have RLS on. A self-rolling-back isolation script on the hosted DB passed 16/16 checks (profile trigger, A cannot read/write B, no self-promotion to admin, anon blocked, account deletion cascades and spares others). Test left 0 rows behind.
- Security advisor (hosted): 0 errors. Remaining notes are intentional or not ours: `admins` has RLS with no policy (by design); `is_admin()` and `delete_my_account()` are callable via RPC (needed by policies / the delete-account button); `rls_auto_enable()` is a Supabase platform helper, left untouched.
- `npm audit --audit-level=high`: passes (no high/critical). 6 low/moderate in dev tooling, unaddressed.

## In progress
- Nothing.

## Blocked / needs owner
- GitHub push, if it fails (see owner actions).
- Real sign-up/sign-in against hosted Auth NOT tested: the sandbox proxy denies *.supabase.co from the shell (policy), so only the management API was reachable.

## Next
- Owner does the Auth dashboard steps in docs/AUTH_SETUP.md, then one real sign-up on a phone as the smoke test.
- Phase 3: subjects/topics, question schema (Zod), CLI validator, import, player, scoring.

## Owner actions
1. Fix GitHub access if push failed (steps in the status message).
2. Follow docs/AUTH_SETUP.md (confirm-email, min password 8, redirect URLs, SMTP before real users).
3. After you sign up once, make yourself admin with the SQL in docs/AUTH_SETUP.md.

## Known limitations
- Local DB tests run on PostgreSQL 16 with a shim; hosted is PostgreSQL 17 (docs/TESTING.md). The hosted isolation script above covers that gap for the key paths, not the full 78 tests.
- Auth UI tests use an in-memory stand-in; real Supabase Auth not yet exercised end to end.
- Hosted migration versions are timestamped by the platform at apply time and differ from the repo filenames; SQL is identical. Reconcile (`supabase migration repair`) before ever using the Supabase CLI against this project.
- Main JS chunk is ~548 kB (supabase-js + auth pages in the entry). Code-splitting is a Phase 8 item.
- Dashboard numbers are zeros until Phase 3+ writes attempts; Subjects/Revision/Mock/Analytics/Settings are placeholders.
