# Practice and exams (Phase 8)

Screens (behind the workspace switch): **Practice and exams** (`/app/workspace/practice`), the session player, the result/review page, and **Past sessions**.

## How it works
- A session fixes its question list (at most 500) when it starts; later edits to the bank do not change it.
- **Practice**: answer, press Check answer, see the verdict and explanation; each checked answer is saved as an attempt.
- **Exam**: free navigation, flag for review, question palette, optional time limit, no feedback until Submit. Submit asks for confirmation (shows how many are unanswered). At time-up it submits automatically. All answers are saved together with the result.
- The clock counts only while the app is open (elapsed time is saved). Progress autosaves every ~10 s, on leaving the tab, and on Pause.
- Negative marking can be switched off per session (a wrong answer then scores 0). Marks lost are set on each question.
- Result page: score, percent, counts, time, by-subject totals, per-question review, and "Practise the ones I missed".
- **Saved exams**: store a set-up (filters, count, timer) and start it again; deleting one keeps the sessions already run.
- A question with an edit still waiting to sync is left out of new sessions (its version is not known yet); it returns once synced.

## Data
Answers are rows in `user_question_attempts` (insert-only). Migration M8 adds `user_exams`, `user_sessions` and a link from attempts to sessions.
M8 is applied on the server. If the tables were ever missing, sessions still work on the device and wait to sync (the app skips missing tables quietly).
Rollback: `supabase/rollback/20261109100000_exams_and_sessions.down.sql`. Checks: `supabase/verify/m8_verify.sql`.
