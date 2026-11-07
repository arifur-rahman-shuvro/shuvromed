# Restoring

## A student's backup file (in the app)
1. Settings → **Restore from a backup file** → choose the `.json` file.
2. The app checks the file (format, version, checksum). A damaged, edited, wrong or too-new file is refused with a reason and nothing changes.
3. It shows how many items are new and how many are already on the account. Tap **Restore now** to apply, or **Cancel**.
Restoring only adds. Existing notes, bookmarks, collections and answers are never replaced or deleted, and restoring the same file twice changes nothing. Restored items sync to the account like new work.

## The whole database (owner)
Use only if the project was lost or damaged. Needs the `.tar.enc` file from the backup artifact and the passphrase.
1. Create a NEW Supabase project (do not touch the old one until the new one works). Free plan limits apply (docs/FREE_TIER.md).
2. Get its **Session pooler** connection string (Connect button). Keep it out of chat.
3. On a computer with PostgreSQL 17 client tools:
   ```
   export TARGET_DB_URL='postgresql://...'      # new project, session pooler
   export BACKUP_PASSPHRASE='...'
   scripts/db-restore.sh shuvromed-backup-<time>.tar.enc
   ```
   The script verifies the checksum, decrypts, checks the manifest, **refuses if the target already has tables in `public`**, then restores the schema and data.
4. Users: `scripts/db-restore.sh <file> --with-auth` also loads `auth.users`/`auth.identities` so accounts keep their ids and passwords. This step is untested against a real Supabase project; if it fails, students must sign up again and can use their own backup file from the app.
5. Re-apply the Auth dashboard settings (docs/AUTH_SETUP.md) and the Site URL/Redirect URLs; update `VITE_SUPABASE_URL` and the publishable key in the hosting settings.
6. Check by signing in with a test account and opening Analytics.
