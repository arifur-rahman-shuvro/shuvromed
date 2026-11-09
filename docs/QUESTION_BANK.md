# Question bank, search, filters, history (Phase 7)

Screen: My questions (`/app/workspace/questions`), hidden behind Settings > Experimental until the cutover.

## Search and filters (`src/bank/filter.ts`, pure and unit-tested)
- Search looks in wording, options, accepted answers, explanation and reference; case-insensitive; every word must match; `"quoted phrases"` stay together.
- Filters: subject, topic (includes sub-topics), no topic, type, exam tags, general tags, no tags, exam scope (any / Universal only / has an exam tag), difficulty (incl. not set), state (active / archived / all), sort (recent, oldest, A-Z).
- **Inside one group choices are OR; different groups are AND.** Deleted questions never show.
- Runs on the device over the whole bank. 20,000 questions: index build and a filtered search are asserted fast in a test (index < 3 s, search < 0.5 s). The list shows 50 at a time with "Show more".
- The current search and filters are remembered for the browser session (session storage only, never required).

## Saved filters (migration M7)
- Table `user_saved_filters` (name unique per person ignoring case/spacing, filter JSON object <= 20 KB, sort, max 100 per person, RLS own rows only, no anon access). File: `supabase/migrations/20261109090700_saved_filters.sql`; rollback and verify files alongside.
- **The app works before M7 is applied.** The table spec is `optionalRemote`: while the server says the table does not exist, sync skips it quietly (no error shown), everything else syncs, and the saved filters wait on the device. Once M7 is applied they are sent with no app change. The sync bar shows "1 change waiting to sync" until then.
- The saved filter is read defensively (`parseFilter`): an unknown or missing field falls back to a default, so a filter saved by a newer app never breaks an older one.

## Bulk actions
Select, then "Select all N matching" (not just what is on screen). Add/remove a tag, archive, restore, delete (each with Undo), move to another subject (confirmation first: topics belong to the old subject so they are cleared; tags are kept). Each action is saved atomically on the device.

## Version history and restore
- Versions are written by the database trigger, so history is read from the server and **needs a connection**; offline it says so and offers Try again.
- The list shows each version, when, what changed (wording / answers / explanation / reference / difficulty) and its subject.
- "Put this version back" saves the old wording and answers as the NEXT version (history is never rewritten). Subject, topics and tags stay as they are now. A version of a different question type cannot be put back.
- Known limit: several local edits made offline become one server version (see QUESTION_ENGINE.md).

## Left out on purpose
File/attachment metadata (listed in the roadmap for M7) is not in M7: nothing in the app uses it yet, and an unused production table adds risk for no benefit. It will be added with the screen that needs it.
