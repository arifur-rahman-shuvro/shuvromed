# Mock exams, XP, streaks and badges (Phase 5)

## Mock exam
- Pick subject, topic, exam style, number of questions (max 100) and time per question (60/90/120 s). One countdown covers the whole exam.
- No feedback until you finish. You can change or clear answers, flag questions, and jump between them with the numbered navigator.
- An unanswered question counts as wrong in the score and records no answer.
- Finishing (or the timer reaching zero) grades the exam. Each answered question is saved as an ordinary answer with mode `mock`, so XP, revision scheduling and sync treat it like any other answer.
- The exam in progress is stored on the device after every change, so a reload or dropped connection resumes where you were (the deadline does not pause). "Discard this exam" records nothing.
- Finished exam results (last 30) are kept on this device only. The answers inside them sync; the result list does not.
- Review page: all / wrong-or-unanswered / flagged, with explanations, per-topic breakdown.

## XP, levels, streaks, badges
All computed from the answer history, nothing stored, so every device with the same answers shows the same numbers. Rules live in `src/gamification/progress.ts` and are shown on the Progress page.
- XP: practice and revision 10 correct / 3 wrong; mock 15 correct / 4 wrong. Only the first answer to a question each day earns XP, so repeating one question cannot farm points.
- Level N starts at 50 x N x (N-1) XP: 0, 100, 300, 600, 1000...
- Streak: consecutive local days with at least one answer; today not yet answered does not break it until the day ends.
- 12 badges (answer counts, streaks, mock exams, revision, 80% accuracy over 50+ answers). Earned dates come from the history.
- "Show XP, levels and badges" switch on the Progress page hides them on this device (streak and study numbers stay). It is stored on the device only.

## Security note
Gamification is client-side by design (study motivation, not a competition). Nothing here is shared with other users, and no database change was needed: `attempts.mode` already allowed `mock`.

## Known limits
- The mock timer uses the device clock; changing the clock can extend an exam. There are no rankings, so nothing depends on it.
- The 8 questions are DEMO samples, so exams are short (max 8 questions) until real content is added.
- Mock result history is not synced across devices.
