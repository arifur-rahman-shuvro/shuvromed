# ShuvroMed v3.0: revised roadmap (v3.1 plan)

Written 2026-11-08 after Phases 0-2 and the M6 production migration. It replaces the 12-phase order in the Change Directive with a re-engineered one. The Directive's requirements are all kept (private data, four question types, optional topics and tags, Universal questions, versioning, no data loss, approval before any production migration). Only the order, the grouping and the engineering rules changed.

## 1. Where we are

| Phase | Status |
|---|---|
| 0 Audit and architecture | Done |
| 1 Private data model (M6) | Done, applied to production and verified (legacy 16 attempts / 1 note / 1 user unchanged) |
| 2 Subject/Topic Manager | Done, hidden behind Settings → Experimental |
| 3 Local-first foundation | Done, phone-verified. See docs/WORKSPACE_SYNC.md |
| 4 Question engine and editor | Done; M6.1 applied to production 2026-11-09. See docs/QUESTION_ENGINE.md |
| 5 Tags and quick classify | Built and tested (2026-11-09); awaiting your phone check |

## 2. What was wrong with the old order, and the fix

| Problem found | Fix |
|---|---|
| Offline, cache and sync were the old Phase 11, but Phases 3-10 would all read and write over the network. Retrofitting a local store at the end means rewriting every screen. | **Local-first foundation moves to the front** (new Phase 3). Every later screen reads from one on-device store; sync runs in the background. |
| Phase 2 talks to Supabase directly, so it is slow on a weak connection and useless offline. | It is moved onto the local store in Phase 3 (small change: only `repo.ts` is swapped). |
| Import (old 5) planned a server SQL function plus a new production migration. | **Import writes to the local store and the normal sync pushes it.** No import function, one fewer production migration, and it works offline. |
| Question Bank (old 6) and Search/Filters (old 7) are one screen; a bank without filters is unusable, and a filter engine built twice would drift. | **Merged** into one phase. |
| Practice (old 8) and Custom exams (old 9) share one session engine (timer, navigation, grading, results). | **Merged** into one phase, practice first, exam mode second, same code. |
| Four tiny phases (tags, import, search, assets) each needed their own review round. | Grouped so each owner check covers something you can actually use on the phone. |
| Staging project (D5) needs a new account resource. | **Dropped as a requirement.** The proven path (green backup, exact SQL shown, your approval, rollback ready, verify queries) worked for M6. Staging stays optional. |
| Progress notes were a single long file. | This file is the plan; PROGRESS.md stays the log. |

## 3. Revised phase list (11 phases)

| # | Phase | What you can do on your phone when it is done | Production DB change |
|---|---|---|---|
| 0-2 | Done (above) | Subjects and topics (online) | M6 applied |
| **3** | **Local-first foundation** | Subjects/topics work offline and sync across devices. A small "Sync" status shows pending changes | None |
| **4** | **Question engine and editor** | Create, edit, preview and answer the four types (SBA, multiple-answer, true/false, fill-in-the-gap). Every meaning change keeps a version. Drafts autosave | None (M6 already has the tables) |
| **5** | **Tags and quick classify** | Exam tags and general tags, separate. Untagged = Universal. Assign tags to many questions at once | None |
| **6** | **Import / export and paste kit** | Paste many questions from text, or import JSON. A dry-run report shows what will happen before anything is saved. Export everything as JSON | None |
| **7** | **Question bank, search and filters** | One list of all your questions. Search, filter by subject / topic / type / tag / difficulty / state, saved filters, bulk actions, version history with restore | M7 (small): saved filters, file metadata |
| **8** | **Sessions: practice and custom exams** | Practice any filtered set. Build timed exams (count, time, negative marking). Results and review | M8: exam config, sessions, answers |
| **9** | **Revision and analytics** | Due-for-revision queue, weak topics, "often wrong", confidence trends, per-version history | None |
| **10** | **Cutover** | The main menu uses your private workspace. Old demo data stays hidden but kept. First-run empty-state guide, storage meter, data health check | None |
| **11** | **Hardening and production QA** | Security review, 20,000-question test, accessibility, offline, performance, full regression, final deploy checklist | None |

Production migrations drop from four planned (M6-M9) to three (M6 done, M7, M8), and each still needs your approval of the exact SQL first.

## 4. Ideas added (all free, all fit a one-person phone-first workflow)

1. **Paste import and an AI prompt kit.** Typing questions on a phone is slow. Phase 6 includes a simple paste format and a ready-made prompt you can give to any chatbot to turn your notes into the import file.
2. **Duplicate warning.** New and imported questions are compared by their normalised wording and you are warned before saving a copy.
3. **Draft autosave.** An interrupted call or a closed tab no longer loses a half-written question.
4. **Undo for archive and delete.** A short "Undo" bar after each action.
5. **Bulk actions.** Select many questions: move subject, add or remove tags, archive.
6. **Version history with restore.** See what changed in a question and put an old version back (this becomes a new version, history is never rewritten).
7. **Smart lists.** Never attempted, often wrong, low confidence, reported, recently edited.
8. **Storage meter and data health check.** Shows how much of the free 500 MB you use and scans for broken or inconsistent items.

## 5. Engineering rules (every phase follows these)

1. **Contract first.** Types and schemas plus shared test fixtures come before screens. The same fixtures check the TypeScript validators and the SQL checks, so they cannot drift.
2. **Pure logic separate from screens.** Grading, filtering, scheduling, tree and merge rules are plain functions with unit tests. Screens only call them.
3. **One data layer.** Screens never call Supabase directly. They use the local store; only the sync engine talks to the server.
4. **Additive database changes only.** Every migration has a paired rollback and verify queries, a green backup run first, and your approval of the exact SQL before it touches production.
5. **Hidden until finished.** New screens stay behind the Settings switch until Phase 10.
6. **Definition of Done for each phase:** typecheck clean; unit tests pass; database tests pass; lint has 0 errors; build passes; accessibility checks on new screens; CI green; PROGRESS.md and docs updated; a report listing real results, what is not verified, and what you need to do.
7. **Honest reporting.** Nothing is called working unless it was run. Limits are listed.

## 6. Folder structure (new code)

```
src/workspace/   model, store (IndexedDB), sync, flags      (Phases 2-3)
src/questions/   registry + one folder per type + grader     (Phase 4)
src/bank/        list, filters, bulk, history                (Phase 7)
src/session/     practice + exam engine                      (Phase 8)
src/revision/    scheduling and analytics                    (Phase 9)
```

## 7. Changes made to earlier phases

- Phase 2: lint warning in `src/workspace/flag.ts` fixed. The Subject/Topic screen will move from direct server calls to the local store in Phase 3 (planned, not done yet).
- Phase 1: no change needed. Its tables already support everything above, including import via sync, which is why no import function is required.

## 8. Open items for the owner

- Cloudflare Pages deploy (docs/DEPLOY.md) and the Supabase Site URL / Redirect URLs are still pending from the original build.
- Optional: run **Keep Supabase awake** once.
- Phone-test the Phase 2 screen now that M6 is live (Settings → Experimental → My subjects).
