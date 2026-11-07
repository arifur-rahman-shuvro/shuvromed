# Testing real sign-up, email confirmation and login (temporary preview)

Purpose: let the owner test the real Supabase Auth flow from an Android phone **before** Phase 4,
without touching production settings and without deploying the final site.

What this is: a manual, temporary copy of the app on GitHub Pages
(`https://arifur-rahman-shuvro.github.io/shuvromed/`). It shows a "PREVIEW build for testing" banner.
It uses the public publishable key only. It is replaced by the Cloudflare Pages deploy in Phase 8.

What was verified by me (sandbox): the sub-path build, the 404 fallback for deep links, links and
content paths under `/shuvromed/`, and phone-width layout in real Chromium with a **fabricated local
session** (a layout/path check only). I could NOT verify real Supabase sign-up/email/login: the sandbox
cannot reach supabase.co, and the workflow has never been run. That is what your test is for.

## One-time setup (Android, Chrome)

1. Open https://github.com/arifur-rahman-shuvro/shuvromed/settings/pages
   Under **Build and deployment → Source**, choose **GitHub Actions**. (Lets the workflow publish the preview.)
2. Open https://github.com/arifur-rahman-shuvro/shuvromed/settings/variables/actions
   Tap **New repository variable** and add two **variables** (not secrets; both are public by design):
   - Name `VITE_SUPABASE_URL`, value `https://jnpqrwutxwjoyoxntfbt.supabase.co`
   - Name `VITE_SUPABASE_PUBLISHABLE_KEY`, value: the key starting `sb_publishable_` from
     Supabase dashboard → Project Settings → API Keys. Never paste the `sb_secret_` key anywhere;
     the workflow refuses it. Do not send keys to me in chat.
3. Open https://github.com/arifur-rahman-shuvro/shuvromed/actions → **Preview (manual)** → **Run workflow** → **Run workflow**.
   Wait for the green tick (about 2 minutes). If it fails, tell me the failing step name.

## Test (use your Supabase-account email)

Built-in Supabase email only delivers to your Supabase organization's team members, and has an hourly
limit. Use the email you log in to Supabase with. Other addresses will show "We cannot send email to
this address yet" (expected, not a bug).

1. Open https://arifur-rahman-shuvro.github.io/shuvromed/ — expect the PREVIEW banner.
2. Tap **Create free account**, enter email and a password of 8+ characters (a throwaway one), submit.
   Expect: "check your email".
3. Open the email, tap the confirm link. **Expected quirk:** it lands on a "can't reach localhost:3000"
   page, because Site URL/Redirect URLs are postponed to Phase 8. The account is still confirmed.
4. Go back to the preview, open **Sign in**, use the same email/password.
   Expect: you reach the Dashboard. Open Subjects → Anatomy → practice a question.
5. Wrong-password check: sign out, sign in with a wrong password. Expect a clear error, not a crash.
6. In Supabase dashboard → Authentication → Users: confirm the user exists and shows as confirmed.

Password reset cannot be completed end to end until Site URL / Redirect URLs are set (Phase 8). Optionally
you may add the preview URL there now; that is your call and I will not change it.

## Report back (no passwords or keys)

For each of steps 2–6: pass/fail, plus any message shown. If something fails: Supabase dashboard →
Logs → Auth, and tell me the error text.

## Clean up

Delete the test user in Authentication → Users (your action). The preview ends when Phase 8 deploys to
Cloudflare; to take it down earlier, remove the Pages deployment in repo Settings → Pages.
