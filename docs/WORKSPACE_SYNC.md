# Private workspace: on-device store and sync (v3.0 Phase 3)

## What it does
The private workspace (subjects, topics now; questions, tags and the rest in later phases) is saved **on the phone first** and sent to the server in the background. The screens never call the server directly: they use one on-device store, so everything opens instantly, works offline, and survives closing the app.

## Where the pieces are
| Piece | File |
|---|---|
| Table list (add new tables here in later phases) | `src/workspace/tables.ts` |
| Store (the only thing screens read and write) | `src/workspace/store/store.ts` |
| Real database (IndexedDB, one per signed-in user) | `src/workspace/store/idb.ts` |
| In-memory database (tests, or a browser that blocks storage) | `src/workspace/store/memory.ts` |
| Merge rules (pure functions) | `src/workspace/sync/merge.ts` |
| Sync run (read, then send) | `src/workspace/sync/engine.ts` |
| When to sync, one at a time | `src/workspace/sync/controller.ts` |
| Server access (20-second limit per request) | `src/workspace/sync/remote.ts` |
| Rules enforced on the device (same as the database) | `src/workspace/localRepo.ts` |
| React wiring and status | `src/workspace/WorkspaceProvider.tsx` |

## How a change travels
1. You add or edit something. It is written to the on-device database and queued, in one step. The screen updates at once.
2. About 1.5 seconds later (a burst of edits goes out together), when you reopen the app, when the phone reconnects, or when you tap **Sync now**, one sync runs: first it reads what changed on the server, then sends your queued changes. Only one sync runs at a time.
3. The server's answer replaces the on-device copy. If you edited the same row again while it was being sent, that newer edit stays queued.

## Rules that keep data safe
- **Newest edit wins per row** (your edit time against the server's last change time). It compares your phone's clock with the server's, so a badly wrong phone clock can make an older edit win; correcting the clock fixes it.
- **Parents before children** when sending; removals last, children first.
- **A partial read never deletes anything.** Rows are removed from the device only after every page was read, and only if you have no unsent change for them.
- **Nothing unsent is ever thrown away by a sync.** A failed or offline sync leaves the queue as it was.
- **Repeating is safe.** If an answer from the server is lost, the next sync notices the row already exists and updates it instead of duplicating.
- **Refused changes.** If the server refuses a change for good (for example another device already used that name), it is not retried forever. The screen shows what was refused and a **Discard** button, which restores the server's version (or removes a create the server never accepted, with anything hanging from it).
- **Delete is guarded.** A subject or topic with content inside cannot be deleted (archive it instead), on the device and again on the server.

## Privacy and storage
- One database per account (`shuvromed-workspace-v1-<account id>`), so accounts on a shared phone do not see each other.
- Signing out keeps the data on the phone so it opens offline next time; **deleting the account** clears it. (A "clear this device" button comes with the Phase 10 settings.)
- If the browser blocks storage, the app falls back to memory and shows a warning that changes are lost when the app closes.

## Tested
- 26 store/merge/engine/IndexedDB/controller tests (`src/test/workspace-sync.test.ts`) and 4 screen tests with the real provider (`src/test/workspace-provider.test.tsx`): offline add then sync, changes from another device, reopen, refused change then discard.
- Real Chromium (Playwright, against a production build): data and nested topics survive a reload from the real IndexedDB; one database per user; no page errors.

## Not verified / limits
- Sync against the real Supabase server and a second real device (needs a phone test, see PROGRESS.md).
- With an artificial fake sign-in and a blocked network, the status stayed on "Syncing…" for about 27 seconds before settling on "Offline"; that delay came from the sign-in library retrying and a real session is not expected to behave that way, but it is unconfirmed on a phone.
- The question counts used by the delete guard come from the on-device questions table, which Phase 4 adds. Until then the server's own check is the backstop.
