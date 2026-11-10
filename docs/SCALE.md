# Scale and hardening (Phase 11)

## What was changed for large banks
- **Batched sync.** New questions, topic links, tag links and saved answers are sent up to 100 rows per request instead of one request per row. If the server refuses a batch (all or nothing), the rows are sent one by one so the exact bad row is found and reported. Confirmations are written in one pass. Covered by `src/test/workspace-batch-sync.test.ts` (fake server) and `supabase/tests/bulk-insert.test.ts` (real PostgreSQL: 200 questions in one statement, one bad row rejects the batch, another user's subject refused, 60-tag limit holds inside a batch, missing question version rejects answers).
- Reading many rows by id from the device store is one call (`getMany`), and the pull step builds a lookup instead of searching a list per row.
- No database change.

## The 20,000-question test
- `npm run test:scale` (not part of `npm test`; slow) writes 20,000 questions and 20,000 answers through the real storage code and times each step. `scripts/check-scale.cjs` does the same in real Chromium with a 4x slower CPU.
- **Status: not completed.** The owner asked to skip it on 2026-11-10 after the first attempt exceeded 9 minutes inside the first step. What was measured before it was stopped:
  - 20,000 questions, IndexedDB test double: saving took 457 s; opening the whole bank 1.7 s; building the search index 92 ms; a filtered search 7 ms; choosing 500 for a session 82 ms; starting it 58 ms; finishing a 500-answer exam 4.4 s. Later steps did not run.
  - Smaller sizes passed end to end: 1,000, 2,000 and 4,000 questions with in-memory storage (saving 4,000 took 0.33 s), and 2,000 with the IndexedDB test double (saving took 2.9 s).
  - The jump from 2.9 s at 2,000 to 457 s at 20,000 on the IndexedDB test double is more than 10x worse than linear. The in-memory store is linear, so it points at the test double (a JavaScript imitation of IndexedDB, far slower than a phone's), but this is **not proven**. A real browser run (`check-scale.cjs`) would settle it.
- So: behaviour at 20,000 questions is **not verified**. The search, filter, session and insight code is fast at that size (above), and sync is batched, but saving 20,000 questions into a real phone's database has not been timed.

## Verified in Phase 11
- Offline in real Chromium: `scripts/check-offline.cjs` 36 of 36, including import, practice, a cold reload while offline with the data and the unfinished session still present, and the update prompt.
- Accessibility in real Chromium (axe, 360 px, light and dark): `scripts/check-a11y.cjs` 94 screens and states, 0 issues, with real data in the player, exam, result, history, insights and Data health screens.
- Unit and screen tests 584; database tests 186; lint 0 errors.
