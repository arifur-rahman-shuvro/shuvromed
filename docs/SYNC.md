# How sync works (Phase 4)

Everything a student does is saved on the device first, then copied to Supabase in the background.
Nothing is lost if the network is down: unsent items stay queued and go up on the next sync.

## What syncs
| Data | Server table | Rule |
|---|---|---|
| Answers | `attempts` | Append-only. The id is made on the device, upload uses `ON CONFLICT (id) DO NOTHING`, so a retry can never double-count. |
| Bookmark collections | `bookmark_collections` | Same name on two devices (case-insensitive) is merged into one. |
| Bookmarks | `bookmarks` | Deleting a collection un-files its bookmarks, it does not delete them. |
| Notes | `question_notes` | Newest edit wins (device clock vs server time; small clock differences can pick the wrong one). |
| Reports (flags) | `flags` | One per question and reason. |
| Revision schedule | none | Recomputed from the answers (`src/practice/srs.ts`), so all devices agree. `review_schedule` table is unused. |
| Confidence rating | `attempts.confidence` | Sent with each answer. |

## When it runs
On opening the app or signing in, when the phone comes back online, when you return to the tab, about
3 seconds after you stop making changes, and from the "Try again" button. After a failure it waits 60 seconds
before retrying by itself. The header always shows the state: Syncing, All changes synced, N waiting to sync,
Offline, Sync problem, or "Saved on this device only" (server not configured).

## Database change (migration 5, applied 2026-11-07 with owner approval)
Questions live in static JSON, not in the database, so the foreign keys from the user-data tables to
`public.questions` were removed and a 1-100 character length check on `question_id` was added.
File: `supabase/migrations/20261107090500_user_data_by_question_id.sql` (hosted version `20261107061405`).
Row level security is unchanged: a user can only read and write their own rows.

## Known limits
- Real Supabase sync is only proven by the two-device test in docs/SYNC_TEST.md; the sandbox cannot reach Supabase.
  Verified here: merge rules, the engine with an in-memory server (two simulated devices), the exact request
  shapes sent to Supabase, and the SQL those requests produce, on local PostgreSQL.
- A device that never syncs keeps its data only on that device.
- If the same account is used on two phones offline and both change the same note, the newest wins; the other edit is replaced.
- Server rows for questions that no longer exist in the question bank are kept and ignored.
- No backup/export yet (Phase 7).
