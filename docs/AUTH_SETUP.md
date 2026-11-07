# Supabase Auth setup (owner steps, from Android Chrome)

Do these in https://supabase.com/dashboard, project **shuvromed**. Nothing here needs a password in chat.

1. **Authentication > Sign In / Providers**: keep **Email** enabled. Keep **Confirm email** on.
2. **Authentication > URL Configuration**: set **Site URL** to the live site URL once Cloudflare Pages
   gives you one (exact steps are in docs/DEPLOY.md). Add the same URL, plus `<url>/login` and `<url>/reset-password`, to
   **Redirect URLs**. Without this, confirmation and reset links will not return to the app.
3. **Authentication > Sign In / Providers > Email**: set **Minimum password length** to 8
   (the app also enforces 8 on the form).
4. **Authentication > Rate Limits / SMTP**: the built-in email service is rate limited across the
   whole project, is best-effort, and is meant for trying things out, per Supabase docs
   (https://supabase.com/docs/guides/auth/rate-limits). Before real students sign up you will need a custom
   SMTP provider. Check that provider's current free limits first.

## Making yourself admin (after you have signed up once)
In **SQL Editor** run, replacing the email with yours:

    insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';

Only the service role / SQL editor can write `public.admins`; no API user can promote themselves.

## Environment variables
Frontend needs only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (public by design).
Copy `.env.example` to `.env.local` for local work. Never use the service-role/secret key in the frontend or in git.
