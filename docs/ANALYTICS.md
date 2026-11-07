# Analytics (Phase 6)

Page: **Analytics** (bottom bar / sidebar). Everything is worked out on the device from your own answers and the question bank
(`src/analytics/analytics.ts`, pure functions). No database change, nothing new to sync.

## What it shows
- Overview: answers, accuracy, questions tried, average time per answer.
- **Weak topics**: a topic is weak when it has at least 3 answers and accuracy below 70%. Weakest first, each with a button that opens practice for exactly that topic. With too little data the page says so instead of guessing.
- By subject and by topic: accuracy, answers, questions tried, and mastery (share of questions whose most recent answer was correct; unanswered count as not mastered).
- Last 14 days: answers per day (with a "View as a table" for the same numbers).
- By difficulty, and "How sure you were" (accuracy at each confidence rating, plus counts of sure-but-wrong and unsure-but-right answers; appears once you rate confidence).
- Average time per answer by mode, and the last 10 mock exam scores (device-only list).

## Rules and limits
- Descriptive, not predictive: the page says it is not a prediction of any exam result.
- Answers for questions that are no longer in the bank are left out and counted in a note.
- Charts are plain bars in one colour, every value is also printed as text, and the day chart has a table. The one-hue palette was not run through the separate palette validator (single series, no colour-only meaning).
- With only 8 DEMO questions the numbers are small; thresholds (3 answers, 70%) are constants in `analytics.ts`.
- Mock score history is on the device that took the exams.
