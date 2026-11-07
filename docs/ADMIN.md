# Admin area

Admin = a row in `public.admins`. Nothing in the app or API can add one; only you in the Supabase dashboard.
What admins can do (enforced by the database): read and resolve question reports from all users, read backup records.

## Make yourself admin (owner action, Android Chrome)
1. Supabase dashboard → **Authentication** → **Users** → tap your test/real account → copy the **User UID**.
2. **SQL Editor** → **New query**, paste (replace the id with your UID), tap **Run**:
   `insert into public.admins (user_id) values ('PASTE-YOUR-UID-HERE');`
3. Open the app → Settings → an **Admin area** button appears. It lists question reports (open first, **Mark resolved** / **Reopen**) and recorded backups.
To remove: `delete from public.admins where user_id = 'PASTE-YOUR-UID-HERE';`
