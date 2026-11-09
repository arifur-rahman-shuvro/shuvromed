# Cutover (Phase 10)

The private workspace is now the main menu. No database change.

## What changed
- **Home** (`/app`) replaces the old dashboard. A new account sees a three-step guide (subject, questions, practise); step cards show "(done)" as you go. Once there are subjects and questions it shows your question count, how many are due for revision, unfinished sessions to continue, and shortcuts.
- **Menu**: Home, My subjects, My questions, Practice and exams, Revision and insights, My tags, Import / export, Data health, Settings. The phone bottom bar shows Home, Questions, Practice, Insights, Settings.
- **Old demo screens** (Subjects, Revision, Bookmarks, Notebook, Mock exam, Progress, Analytics, old dashboard at `/app/legacy`) are not in the menu. Their data is kept, never deleted. Settings → "Also list the old demo screens in the menu" brings them back. Their addresses keep working.
- **Way back**: Settings → "Use my private workspace as the main menu" off returns this device to the old menu. The choice is per user and per device.
- **Data health** (`/app/workspace/health`): storage used on this device and whether the browser will keep it, what is waiting to sync and any refused changes, and a read-only check that reports: questions with invalid answer data, missing subject, topic or tag, topics from another subject, orphan topics, and (as notes) answers or sessions that refer to questions not on this device and sessions unfinished for over 30 days. It never changes data.

## Not changed
Old demo data on the server and on devices; the old screens' code; any table.
