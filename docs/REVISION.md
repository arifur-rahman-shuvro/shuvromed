# Revision and insights (Phase 9)

Screen: **Revision and insights** (`/app/workspace/revision`, behind the workspace switch). No database change: nothing new is stored. Everything is worked out on the device from your saved answers (`user_question_attempts`), so it always agrees with them.

## Due for revision
- After a right answer a question returns after 1, 2, 4, 8, 16, 32, then 60 days. A wrong answer sends it back to tomorrow.
- A right answer you marked "Guessing" does not move the question forward. Unanswered exam questions are ignored.
- Archived or deleted questions are never offered. Questions with an edit still syncing are left out of a run until it syncs.
- **Start revision** makes a practice session flagged as revision; its answers are saved with mode `revision`.

## Insights
- Overview (answers, days practised, accuracy, average time; a partly right answer counts as half).
- Weakest subjects and topics (only with at least 5 answers).
- Often wrong: wrong at least twice and at least half of the time, with "Practise the often wrong ones".
- Confidence: optional "How sure are you?" (Guessing to Certain) while practising or in an exam; shows accuracy per rating and how many answers were wrong while sure.
- Last 8 weeks (UTC weeks).
- Per-version results appear on each question's Version history page.
