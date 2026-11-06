# Testing

| Command | What it runs | Needs |
|---|---|---|
| `npm run typecheck` | TypeScript | nothing |
| `npm test` | UI, validation and auth-flow tests (jsdom) | nothing |
| `npm run test:db` | Real PostgreSQL: applies every migration, then tries to break RLS | local Postgres on :54329 |
| `npm run build` | Production build | nothing |

## Database tests
`scripts/local-pg.sh start` creates and starts a throwaway Postgres on `localhost:54329`
(needs the PostgreSQL server packages). `npm run test:db` then drops and recreates the
database `shuvromed_test`, loads `supabase/tests/support/supabase_local_shim.sql`, applies
`supabase/migrations/*.sql` in order, and runs `supabase/tests/rls.test.ts`.
The setup refuses to run against any non-local host.

### What the local shim is (and is not)
The shim recreates the Supabase pieces the migrations rely on: the roles `anon`,
`authenticated`, `service_role`, `auth.users`, `auth.uid()` and Supabase's default table
privileges. It does **not** emulate Supabase Auth (GoTrue), JWT signing or email. The
local server is PostgreSQL 16; the hosted project runs PostgreSQL 17. Passing here is strong
evidence the policies are correct, not proof of production behaviour. Re-run the isolation
checks on the hosted project after applying migrations.

## Auth UI tests
`src/test/fakeAuthClient.ts` is an in-memory stand-in for `supabase.auth`. These tests
cover forms, validation, route protection, redirects and error wording. They do not prove
the real Supabase Auth service works; that needs a real sign-up against the hosted project.
