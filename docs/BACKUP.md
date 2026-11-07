# Backups

There are two separate kinds. Neither costs anything.

## 1. A student's own backup (in the app)
Settings → **Download backup** saves one `.json` file with the student's answers, bookmarks, collections, notes, reports and
finished mock exams, plus a checksum. It contains no email, password or account id. **Download answers (CSV)** saves the answers
for a spreadsheet (text starting with = + - @ is neutralised so a spreadsheet cannot run it as a formula).
Restore is in docs/RESTORE.md. Tested: file round trip, damaged/edited file refused, restore adds only what is missing, twice is harmless.

## 2. Whole-database backup (owner, automatic)
`.github/workflows/backup.yml` runs every Sunday 03:17 UTC and on demand. `scripts/db-backup.sh`:
1. counts every public table, dumps the public schema and data, and dumps the auth users;
2. **restores the dump into a throwaway database and checks every table's row count**, so a backup that cannot be restored is reported as failed;
3. encrypts everything with AES-256 (passphrase), decrypts it again and compares, and keeps only the `.tar.enc` and its `.sha256`.
The encrypted file is stored as a workflow artifact for 90 days (Actions → the run → Artifacts). The repository is public, so the
encryption matters: **anyone can download the artifact, only your passphrase opens it.**

### One-time setup (owner, Android Chrome)
1. Supabase dashboard → open the project → **Connect** → choose **Session pooler** → copy the connection string and put your database password in place of `[YOUR-PASSWORD]`. (The direct connection is IPv6-only, which GitHub's runners cannot use. The password is under Project Settings → Database → "Reset database password" if you do not have it. Do not send it to me.)
2. Make a passphrase of 16+ random characters and save it in your password manager. Without it a backup cannot be opened and nobody can recover it.
3. Open https://github.com/arifur-rahman-shuvro/shuvromed/settings/secrets/actions → **New repository secret**:
   - Name `SUPABASE_DB_URL`, value: the connection string from step 1.
   - Name `BACKUP_PASSPHRASE`, value: the passphrase from step 2.
4. Open https://github.com/arifur-rahman-shuvro/shuvromed/actions → **Database backup** → **Run workflow** → **Run workflow**. Green tick = backup made and restore-verified. A red cross emails you; open the run to see which step failed.

### What is and is not covered
- Public data (answers, bookmarks, notes, flags, catalogue, admins, backup records) and the auth users table (ids, emails, password hashes, via `auth.dump`).
- Not covered: Supabase project settings (Auth dashboard options, email templates), the static question files (they are in git), GitHub secrets.
- Free Supabase plans have no downloadable automatic backups, which is why this exists.

### Verified vs not
- Verified (local PostgreSQL, `npm run test:backup`, 14 checks): backup completes, only encrypted files remain, secret text is not readable in the file, no passphrase or connection string in the log, short passphrase refused, wrong passphrase and damaged file refused, restore into an empty database gives identical data with RLS on, restore refuses a non-empty database, the source is untouched.
- **Not verified**: the workflow itself and a backup of the real Supabase database (needs the two secrets, and this sandbox cannot reach Supabase). The auth-users part of a restore into a real Supabase project is also untested.
