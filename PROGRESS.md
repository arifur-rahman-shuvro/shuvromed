# ShuvroMed — PROGRESS

Last updated: 2026-11-08 (Phase 8 built and pushed; waiting on the owner's Cloudflare deploy + phone checks. No later phase exists.)

## Done
- Preflight + free-tier limits (docs/FREE_TIER.md).
- Phase 1: scaffold, design system, responsive layout, landing, dashboard shell.
- Phase 2: Supabase auth UI, 4 SQL migrations with strict RLS (applied to hosted project jnpqrwutxwjoyoxntfbt), 78 real-Postgres tests, CI. Pushed; GitHub CI green on c61f6b9 and 18f7d79 (read with `gh`, all steps `success`).
- Phase 3 (data-driven content + practice):
  - Content is data under `content/` (subjects, topics, exam styles, question formats, questions). Adding any of these needs no code change (docs/CONTENT.md).
  - Zod schemas + cross-reference validator + CLI (`npm run content:validate`), run in CI with `--fail-on-warnings`.
  - Build step validates and writes static files to `public/content/` (only student-visible questions; drafts never ship).
  - Bulk import for CSV/JSON (`npm run content:import`): always writes draft + unreviewed, never publishes, writes nothing unless the whole set validates.
  - Runtime loader re-validates downloaded content with the same schemas; per-subject lazy files; version-busted URLs; retry after failure.
  - Subjects page (searchable), hierarchical topic library with real counts/attempted/accuracy/mastery/difficulty mix/exam styles, practice setup (subject, topic, style, difficulty, count, timed, shuffle questions/options, all/unattempted/incorrect-only), question player, scoring, session summary.
  - Option shuffling is seeded and always scores against the original option id.
  - Attempts are stored on this device per signed-in user (client-generated UUID, duplicate-safe, corrupt-entry tolerant, failure is shown not hidden). Dashboard numbers (answers, accuracy, today's goal/time, streak, recent days) come from them.

- Owner decisions (2026-11-07): database hardening DECLINED (no REVOKE run; docs/PROPOSED_HARDENING.md marked declined). Auth dashboard: Email on, Confirm email ON, min password 8. Site URL / Redirect URLs postponed to Phase 8.
- Temporary Auth preview (manual GitHub Pages workflow `.github/workflows/preview.yml`, sub-path build, PREVIEW banner, base-aware URLs, friendly email-limit errors). Owner guide: docs/AUTH_TEST.md. No production change made.

## Verified by running (2026-11-07)
- Preview work: typecheck clean; `npm test` 153/153; lint 0 errors; content:validate OK; `npm audit --audit-level=high` passes; preview-style build (VITE_BASE=/shuvromed/) served by a GitHub-Pages emulator and exercised in real Chromium at 360x740 with a fabricated local session: 24/24 layout/path checks (not real Supabase Auth).
- NOT verified: the preview workflow itself (never run), real Supabase sign-up/email/login.

## Earlier verification (2026-11-06)
- `npm run typecheck`: clean.
- `npm test`: 144/144 (auth 24, app 6, validator 37, importer 20, practice logic 33, practice UI/journey 24).
- `npm run test:db`: 78/78 on local PostgreSQL 16 (unchanged from Phase 2).
- `npm run content:validate -- --fail-on-warnings`: OK (15 subjects, 8 topics, 8 questions, all DEMO/draft/unreviewed).
- Import CLI exercised end to end in an isolated copy: dry run, duplicate id, unknown topic, real write, existing-file refusal, `--force`, path escape refusal, validator afterwards. Repo content untouched.
- `npm run build`: succeeds; main JS chunk ~550 kB (content layer is lazy-loaded); `npm audit --audit-level=high` passes.

## Done: Phase 4 (verified by owner on real devices 2026-11-07)
Bookmarks, collections, notes, flags, confidence, notebook, spaced repetition, cross-device sync (docs/SYNC.md). Migration 5 applied to production with owner approval (hosted version 20261107061405).

## Done: Phase 5 (owner phone check passed 2026-11-07)
Mock exams, XP/levels/streaks/12 badges, Progress page (docs/MOCK_AND_PROGRESS.md). No database change.

## Done: Phase 6 (owner phone check passed 2026-11-07)
Analytics page (docs/ANALYTICS.md). Client-side, no database change.

## Done: Phase 7 (owner checks all passed 2026-11-08: backup secrets, Database backup workflow, Preview, Android backup/restore) - export, backup, restore, security review, admin
- Built: Settings page (daily goal, appearance, download backup JSON / answers CSV, restore with preview, delete account); Admin page (question reports, backup records); encrypted restore-verified database backup (`scripts/db-backup.sh`, `.github/workflows/backup.yml`) and guarded restore (`scripts/db-restore.sh`); security headers `public/_headers`. Docs: BACKUP.md, RESTORE.md, SECURITY_REVIEW.md, ADMIN.md. No production database change in Phase 7.
- Verified by running: typecheck clean; `npm test` 293/293; `npm run test:db` 80/80; `npm run test:backup` 14/14 (local PostgreSQL); lint 0 errors; content:validate OK; build OK; audit (high) passes; real Chromium with the CSP applied, 11/11 flows and no violations; secret scan of full git history clean.
- NOT verified: backup workflow on GitHub and a backup of the real database (needs the two secrets); delete-account, admin and restore against the real Supabase project; auth-users restore into a real project; a real phone.

## In progress: Phase 8 (authorized 2026-11-08) - PWA/offline, accessibility, performance, deploy
- Built: installable app (manifest, own icon set, service worker via vite-plugin-pwa, prompt-style updates), offline shell, "Save all questions for offline" in Settings, immediate Offline status, skip link, page-change announcements (title + focus), real not-found page, landmark/heading/contrast fixes found by axe, vendor chunk splitting, lazy signed-in shell, cache headers, robots.txt, `.node-version`, Cloudflare Pages guide (docs/DEPLOY.md), keep-alive workflow, CI check that the app files are produced. Docs: PWA.md, ACCESSIBILITY.md, PERFORMANCE.md, DEPLOY.md. No database change.
- Verified by running (2026-11-08): typecheck clean; `npm test` 318/318 (new: pwa 15, a11y-ui 10); `npm run test:db` 80/80; `npm run test:backup` 14/14; lint 0 errors; content:validate OK; build OK; real Chromium 360x740 `scripts/check-offline.cjs` 24/24 at the site root and 24/24 at the `/shuvromed/` preview sub-path (install, offline, update prompt, no CSP violations); axe-core `scripts/check-a11y.cjs` 40 screens light+dark 0 violations; Lighthouse mobile (simulated) home 97/100/100/100, sign-in 96/100/100/63 (SEO 63 is deliberate robots rule).
- NOT verified: Cloudflare Pages itself (build, `_headers`, `_redirects` are tested only against an emulation); a real phone (install prompt, airplane mode); a screen reader; keep-alive workflow (never run); real-network performance; iOS.

## Blocked / waiting on owner
- Deploy to Cloudflare Pages and set the Supabase Site URL / Redirect URLs (docs/DEPLOY.md steps 1-11), then the phone checks (steps 12-15). Run **Keep Supabase awake** once from the Actions tab.

## Next
- After the owner confirms the Cloudflare site works: nothing further is planned in the master prompt. Candidates: custom SMTP (owner decision), real question content, lazy-loading the Supabase client, TalkBack testing.

## Known limitations (honest)
- The question bank is 8 DEMO questions (Anatomy, Physiology, Pharmacology). Not a real bank. DEMO questions have no references and have NOT been clinically reviewed.
- Sync passed the owner's real two-device test; not load-tested. Note conflicts: newest edit wins using device clock vs server time. Student export/restore and the whole-database backup exist since Phase 7 (docs/BACKUP.md, docs/RESTORE.md).
- Mock result history is device-only; gamification is client-side.
- A session is rebuilt if the page is refreshed mid-session (answers already given stay saved, but the question list is re-selected).
- Timed mode is a single countdown of 90 seconds per question; there is no per-question timer.
- No owner-only admin web page yet; content import/review is by command line.
- Not verified: layout on a real phone (checked in desktop Chromium emulation at 360px only), real Supabase sign-in/sign-up from the sandbox (the owner's own checks passed), accessibility with a screen reader. Offline behaviour was tested in Chromium in Phase 8 (docs/PWA.md), not on a phone.
- Lint: 0 errors; some React-compiler style warnings remain (setState in effects for data loading, fast-refresh export notes).
- Hosted migration versions are timestamped by the platform and differ from repo filenames; reconcile with `supabase migration repair` before using the Supabase CLI against this project.

## Owner actions
1. Follow docs/AUTH_TEST.md (enable Pages source, add 2 variables, run the preview, sign up/confirm/sign in on your phone) and report pass/fail.
2. (Optional) Site URL / Redirect URLs: postponed to Phase 8.
3. After signing up once, make yourself admin with the SQL in docs/AUTH_SETUP.md.
4. Add the two secrets and run **Database backup** (docs/BACKUP.md); re-run Preview and try Settings; then authorize Phase 8.

## Security review notes (2026-11-06, read-only)
- `is_admin()`, `delete_my_account()`, `handle_new_user()`: SECURITY DEFINER, empty search_path, correct execute grants. `delete_my_account()` has no re-authentication (design gap, planned for Phase 7).
- Platform helper `rls_auto_enable()` and our `set_updated_at()` are executable by anon (see docs/PROPOSED_HARDENING.md).

## v3.0 Change Directive: Phase 1 (private data model) — built locally, NOT applied to production
- New migration `supabase/migrations/20261108090600_private_workspace_core.sql` (M6, additive only): user_subjects, user_topics, user_tags, user_questions, user_question_versions, user_question_topics, user_question_tag_links, user_question_attempts, user_bookmark_collections, user_question_bookmarks, user_question_notes, user_question_reviews, user_question_review_log, user_question_reports. All have RLS (`owner_id = auth.uid()`), composite owner-scoped foreign keys, no anon access.
- Rollback: `supabase/rollback/20261108090600_private_workspace_core.down.sql`. Post-apply checks: `supabase/verify/m6_verify.sql`.
- Tests: `supabase/tests/workspace.test.ts` (32 tests: empty-by-default, two-user isolation, cross-owner links, topic tree, versioning, per-type content validation, append-only attempts). Local PG16 DB suite 112/112, unit 318/318, backup 14/14, typecheck clean, lint 0 errors.
- Production: M6 is NOT applied. Waiting for owner approval of the exact SQL, a green Database backup run, and (optionally) a staging rehearsal.

## v3.0 Phase 2 (Subject/Topic Manager) — built locally, behind a hidden setting
- New screen **My subjects** (`/app/workspace/subjects`, `src/pages/WorkspaceSubjects.tsx`): add, rename, archive/restore, delete subjects; nested topics (add sub-topic, rename, move, archive, delete). Delete is refused with counts when anything is inside; archive hides without deleting.
- Hidden until Settings → "Experimental: private workspace" is switched on (per user, per device). Off by default; nothing else in the app changes.
- Code: `src/workspace/{model,repo,flag}.ts`. The repo talks to the M6 tables, so on the live server it shows "not set up on the server yet" until M6 is applied (owner approval pending).
- Tests: 10 new UI/model tests (`src/test/workspace-ui.test.tsx`); unit 328/328, DB 112/112, lint 0 errors, build OK.
- Not verified: the Supabase repo against a real server (needs M6 applied); screen on a real phone; screen reader.
- 2026-11-08: Database backup workflow fixed to use pg_dump 17 (runner's default 16 refused the Postgres 17 server). Needs a green re-run before M6.
- 2026-11-08 ~14:40 (Asia/Dhaka): **M6 APPLIED to production** (owner-approved, after green Database backup run 42463356071). Verified: legacy attempts 16, notes 1, users 1 unchanged; 14 new tables, all RLS on, 49 policies, 0 anon grants, 0 rows; security advisors show no findings on new objects (existing warnings are on older functions). Hosted migration name: private_workspace_core. Rollback: supabase/rollback/20261108090600_private_workspace_core.down.sql.

## v3.0 plan revised (2026-11-08)
- New plan: `docs/ROADMAP_V3.md` (11 phases). Local-first foundation moved to Phase 3; import goes through the local store and sync (no import SQL function); bank+search merged; practice+custom exams merged; staging project no longer required. Phase 3 = local-first foundation, Phase 4 = question engine.

## v3.0 Phase 3 (local-first foundation) — built, not yet phone-tested
- My subjects now reads and writes an on-device IndexedDB store; a sync engine sends changes to the M6 tables in the background (newest edit wins, queued changes never lost, refused changes shown with a Discard button). Works offline. Docs: `docs/WORKSPACE_SYNC.md`.
- Changed in this phase: `src/workspace/{tables,localRepo,WorkspaceProvider}`, `store/`, `sync/`; `repo.ts` no longer has a direct-to-server repo (screens use the on-device repo only); `AppLayout` mounts the provider when the workspace is switched on; account deletion clears the on-device database; dev dependency `fake-indexeddb`.
- Found and fixed by tests: a discarded change did not refresh the lists.
- Results: unit 358/358, DB 112/112, typecheck clean, lint 0 errors, build OK; real Chromium check of IndexedDB persistence passed.
- Not verified: real Supabase sync, two real devices, real phone.

## v3.0 Phases 8-10 (2026-11-10)
- Phase 8 (practice + exam sessions, M8 applied to production 2026-11-09 after exact-SQL approval and a green backup) and Phase 9 (revision queue, insights, confidence) phone-checked by the owner.
- Phase 10 (cutover): workspace is the default menu; Home with first-run guide; old demo screens hidden but kept (Settings switch); Data health page (storage meter, sync state, read-only data check). No migration. See `docs/CUTOVER.md`.
- Found by the real-browser accessibility audit and fixed: the prompt-kit box on Import was scrollable but not keyboard-focusable. Audit now covers the workspace screens: 58 screens, 0 issues.
- Not verified: real phone for Phase 10; session player and result screens under axe (they need data); real-server sync of Phase 10 screens.
