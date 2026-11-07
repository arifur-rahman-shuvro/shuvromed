# Two-device sync test (Android)

You need the preview site refreshed with the new build, then two separate "devices". If you have no second
device, a Chrome Incognito tab on the same phone has completely separate storage and works as device 2.

## 0. Refresh the preview (once)
1. Open https://github.com/arifur-rahman-shuvro/shuvromed/actions → **Preview (manual)** → **Run workflow** → **Run workflow**. (Publishes the new build.) Wait for the green tick.

## 1. Device 1 (normal Chrome tab)
1. Open https://arifur-rahman-shuvro.github.io/shuvromed/ and sign in with the test account.
2. Subjects → Anatomy → pick a topic → **Start practice**. Answer 3 questions; on one, choose "How sure are you?" first.
3. Under a question tap **Bookmark**, and add a **Note** ("test note 1").
4. Menu or Dashboard → **Bookmarks** → type a name "Cardio" → **Add collection**, then move the bookmarked question into Cardio.
5. Look at the top bar: wait for **All changes synced**. If you see **Sync problem**, write down the exact words and tap **Try again**.

## 2. Device 2 (Chrome menu ⋮ → **New Incognito tab**)
1. Open the same preview URL and sign in with the same account.
2. Expect: Dashboard shows 3 answers recorded; Bookmarks shows the question inside Cardio; the note is under the question; Notebook lists any you got wrong; header says All changes synced.

## 3. Changes flow back
1. In the incognito tab remove the bookmark (Bookmarks → **Remove**) and wait for **All changes synced**.
2. Back in the normal tab, switch away and return (or reload). Expect the bookmark to be gone.

## 4. Offline
1. In the normal tab turn on Airplane mode. Answer one question. Expect "Offline · 1 waiting to sync".
2. Turn Airplane mode off. Expect it to say All changes synced within a few seconds.

## 5. Server check (optional)
Supabase dashboard → **Table Editor** → `attempts`: you should see 4 rows for your test user, no duplicates.

## Report back (no passwords or keys)
Pass/fail for steps 1.5, 2.2, 3.2, 4.2, and any message shown. For failures: Supabase → **Logs** → **API** and the exact text on screen.
Clean up: delete the test user in Authentication → Users when finished.
