# Testing

| Command | What it runs | Needs |
|---|---|---|
| `npm run typecheck` | TypeScript | nothing |
| `npm test` | UI, validation and auth-flow tests (jsdom) | nothing |
| `npm run test:db` | Real PostgreSQL: applies every migration, then tries to break RLS | local Postgres on :54329 |
| `npm run test:backup` | Backup, encryption and restore scripts end to end | local Postgres on :54329 + pg_dump/pg_restore/openssl |
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

## Real-browser checks (Phase 8; manual tools, not in CI)
These need Playwright (not a project dependency) and a built site being served. Build with `VITE_SUPABASE_URL=https://example.supabase.co` because the fake session is stored under that name; they block `supabase.co`, so they test the app shell, caching and offline behaviour, not real sign-in.
- `node scripts/check-offline.cjs <dist-copy> <base-url>`: manifest, installability, service worker, Save-all, offline navigation and answering, update prompt (it appends to `sw.js` in the copy it is given, so give it a throwaway copy).
- `node scripts/check-a11y.cjs <base-url>`: axe-core over 40 screens, light and dark.
- `node scripts/make-icons.cjs`: one-off, regenerates the PNG icons from `public/icon.svg`.
Unit tests for the same features run in the normal suite: `src/test/pwa.test.tsx`, `src/test/a11y-ui.test.tsx`.
