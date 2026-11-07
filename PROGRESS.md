# ShuvroMed — PROGRESS

Last updated: 2026-11-07 (Phase 4 built; waiting on owner's real two-device sync test)

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

## In progress (Phase 4, authorized 2026-11-07)
- Built: bookmarks + collections, notes, flags, optional confidence rating, incorrect-question notebook, spaced repetition (derived from answers, src/practice/srs.ts), Revision/Bookmarks/Notebook pages, bookmarked and due practice modes, dashboard due count.
- Built: cross-device sync (src/sync/*; docs/SYNC.md): attempts, collections, bookmarks, notes, flags, with header status and retry.
- Production change (owner-approved 2026-11-07): migration 5 applied (hosted version 20261107061405): question foreign keys dropped from user-data tables, length check added. Verified by read-back: no FK to questions remain, 5 checks present. Security advisor shows only items already known.
- Verified by running: typecheck clean; `npm test` 216/216 (incl. sync merge rules 18, request shapes 8, status UI 3); `npm run test:db` 80/80 (incl. the exact upsert SQL); lint 0 errors; content:validate OK; build OK (main JS ~662 kB, was ~550 kB, since sync is in the main bundle); audit (high) passes.
- NOT verified: real sync against Supabase (sandbox cannot reach it). Owner test: docs/SYNC_TEST.md (re-run the Preview workflow first).

## Blocked / waiting on owner
- Owner to run docs/SYNC_TEST.md (two devices) and report; then Phase 5 can be authorized.

## Next
- After owner verifies sync: - Then Phase 5 (mock exams, XP, streak rules, badges), Phase 6 (analytics, weak topics), Phase 7 (export, backup, restore, security review, admin page), Phase 8 (PWA/offline, accessibility, performance, deploy).

## Known limitations (honest)
- The question bank is 8 DEMO questions (Anatomy, Physiology, Pharmacology). Not a real bank. DEMO questions have no references and have NOT been clinically reviewed.
- Sync is untested against real Supabase until the owner's two-device test. Note conflicts: newest edit wins using device clock vs server time. There is no backup/export yet (Phase 7); docs/BACKUP.md and docs/RESTORE.md do not exist yet.
- Dashboard: XP/level shown as "—" (Phase 5), no weak-topics panel yet (Phase 6).
- A session is rebuilt if the page is refreshed mid-session (answers already given stay saved, but the question list is re-selected).
- Timed mode is a single countdown of 90 seconds per question; there is no per-question timer.
- No owner-only admin web page yet; content import/review is by command line.
- Not verified: layout on a real phone (checked in desktop Chromium emulation at 360px only), real Supabase sign-in/sign-up (sandbox cannot reach supabase.co from the shell), accessibility with a screen reader, offline behaviour (Phase 8).
- Lint: 0 errors; some React-compiler style warnings remain (setState in effects for data loading, fast-refresh export notes).
- Hosted migration versions are timestamped by the platform and differ from repo filenames; reconcile with `supabase migration repair` before using the Supabase CLI against this project.

## Owner actions
1. Follow docs/AUTH_TEST.md (enable Pages source, add 2 variables, run the preview, sign up/confirm/sign in on your phone) and report pass/fail.
2. (Optional) Site URL / Redirect URLs: postponed to Phase 8.
3. After signing up once, make yourself admin with the SQL in docs/AUTH_SETUP.md.
4. Tell me when to start Phase 4.

## Security review notes (2026-11-06, read-only)
- `is_admin()`, `delete_my_account()`, `handle_new_user()`: SECURITY DEFINER, empty search_path, correct execute grants. `delete_my_account()` has no re-authentication (design gap, planned for Phase 7).
- Platform helper `rls_auto_enable()` and our `set_updated_at()` are executable by anon (see docs/PROPOSED_HARDENING.md).
