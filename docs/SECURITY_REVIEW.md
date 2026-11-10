# Security review (Phase 7, 2026-11-07)

Scope: the web app, the Supabase schema/RLS, the build and backup tooling. Method: what I ran, not opinions.

## Checked by running
| Check | Result |
|---|---|
| RLS/permission tests on PostgreSQL (`npm run test:db`) | 80 of 80 pass: every public table has RLS, users reach only their own rows, no cross-user writes, upsert SQL used by sync behaves, append-only tables, SECURITY DEFINER functions pin `search_path` |
| Supabase security advisor (hosted, today) | 0 errors. WARN/INFO: `is_admin()` and `delete_my_account()` callable via RPC (intended and tested); `rls_auto_enable()` callable (platform function; hardening declined by owner); `admins` RLS with no policy (intended: no API access); leaked-password protection off |
| Secret scan of the whole git history | No `sb_secret_`, service-role JWT, database URL with password or `.env` file ever committed (only `.env.example`) |
| Risky browser APIs in `src` | None: no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write` |
| External hosts in app code | None except the Supabase project (all fonts/images are local) |
| Content-Security-Policy and headers (`public/_headers`, for Cloudflare Pages) | Real Chromium at 360px with the policy applied: 11 of 11 flows (landing, dashboard, subjects, content loading, analytics, settings, mock setup, progress, file download) with zero violations; an injected inline script was blocked |
| `npm audit --audit-level=high` | passes |
| Backup/restore tooling (`npm run test:backup`) | 14 of 14 (see docs/BACKUP.md) |

## Findings
1. **No per-user storage limit (medium, needs your approval to fix).** A signed-in user could upload very many answers or notes and push the free 500 MB database toward its limit. Sign-up needs email confirmation, which slows this. Proposed fix (not applied): a database trigger that caps rows per user per table. It is a production migration, so I will only prepare it if you ask.
2. **Shared phone (low).** Progress is kept per user in the browser, so someone with the unlocked phone and the same browser profile can open the app signed in. Signing out ends the session but keeps local data so unsynced work is not lost. Use a phone lock; "Delete my account" wipes the device.
3. **Scores are client-computed (low, by design).** A user can alter only their own statistics.
4. **CSP allows inline styles (low).** Needed for React style attributes; scripts remain `self` only.
5. **The GitHub Pages preview cannot send security headers** (preview only). The Cloudflare Pages deploy in Phase 8 uses `public/_headers`.
6. **Backups in a public repo** are encrypted; strength depends on your passphrase (16+ characters enforced). Rotate the passphrase by changing the secret; old backups still need the old one.
7. **Leaked-password protection is off.** The advisor suggests it; I have not verified whether it is available on the free plan and will not enable anything paid.
8. **Email delivery** uses Supabase's built-in sender (team addresses only, hourly limit). Real users cannot sign up until a custom sender is set up (Phase 8 decision).
9. **Admin area** is hidden for non-admins but every rule is enforced by the database. Verified only with a fake admin client in tests and by the SQL tests; not yet tried with a real admin account (see docs/ADMIN.md).

## Not verified
Real Supabase behaviour of the new screens (delete account, admin, restore sync); the backup workflow on GitHub; the auth-users restore into a real project; anything on an iOS device.

---

# Update for v3.0 (Phase 11, 2026-11-10)

Scope: the private workspace tables M6-M8 and the screens built on them.

## Checked by running
| Check | Result |
|---|---|
| Database tests on PostgreSQL (`npm run test:db`) | 186 of 186: private-table isolation (`workspace.test.ts`), saved filters (own rows, no impersonation, size limits), exams and sessions (own rows only, no delete, finished session immutable, foreign exam or session refused), batch inserts (other user's subject, topic or question refused) |
| Production, read-only checks (today, after M8) | No public table without RLS; no anonymous grant on any of the 19 private tables; every private table is restricted to signed-in users; every private table is removed with its owner (the question-versions table through its question) |
| Supabase security advisor (hosted, today) | No new finding after M8. Same notes as before: `is_admin()` and `delete_my_account()` callable (intended), `rls_auto_enable()` (owner declined hardening), `admins` has RLS and no policy (intended), leaked-password protection off |
| Supabase performance advisor (hosted, today) | Information only: 8 foreign keys without a covering index (including the new sessions-to-exam and answers-to-version links), 20 unused indexes (no traffic yet), 3 double-policy warnings on the old public catalogue tables. Nothing urgent at this size; an index migration would be needed only if a table grows large, and would need your approval |
| Browser | No new risky APIs; CSP, offline and accessibility checks re-run on the production build (see docs/SCALE.md) |

## New findings
1. **Answers and sessions have no per-user row limit (low, same as finding 1 above).** A session holds at most 500 questions and 200 KB of state, but a user can start unlimited sessions. Not fixed; a cap would be a production migration and needs your approval.
2. **Sessions cannot be deleted through the API (by design).** "Delete my account" removes them. There is no way to erase only your answers short of deleting the account.

## Not verified
Real two-user behaviour on the hosted project (the tests use a local PostgreSQL with Supabase-style roles); the 20,000-question run (see docs/SCALE.md); anything on a real phone.
