#!/usr/bin/env bash
# End-to-end test of scripts/db-backup.sh and scripts/db-restore.sh on the local throwaway PostgreSQL
# (scripts/local-pg.sh start). Builds a database from the real migrations, fills it with sample data,
# backs it up, and checks the claims the docs make. Exits non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."
ADMIN="${PG_ADMIN_URL:-postgresql://postgres@localhost:54329/postgres}"
base="${ADMIN%/*}"
SRC="bk_src_$$"; DST="bk_dst_$$"; OUT="$(mktemp -d)"
PASS="correct horse battery staple 123"
pass=0; fail=0
ok()   { pass=$((pass+1)); echo "PASS  $1"; }
bad()  { fail=$((fail+1)); echo "FAIL  $1"; }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }
cleanup() { psql "$ADMIN" -qAt -c "drop database if exists $SRC" -c "drop database if exists $DST" >/dev/null 2>&1 || true; rm -rf "$OUT"; }
trap cleanup EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 -At "$@"; }

P "$ADMIN" -c "create database $SRC"
P "$base/$SRC" -f supabase/tests/support/supabase_local_shim.sql >/dev/null
for f in $(ls supabase/migrations/*.sql | sort); do P "$base/$SRC" -f "$f" >/dev/null; done
U1=11111111-1111-4111-8111-111111111111; U2=22222222-2222-4222-8222-222222222222
P "$base/$SRC" >/dev/null <<SQL
insert into auth.users (id, email) values ('$U1','a@example.test'), ('$U2','b@example.test');
insert into public.attempts (id, user_id, question_id, selected_option, is_correct) values
  ('00000000-0000-4000-8000-000000000001','$U1','q1','A',true), ('00000000-0000-4000-8000-000000000002','$U2','q2','B',false);
insert into public.question_notes (user_id, question_id, body) values ('$U1','q1','SECRET-NOTE-TEXT-12345');
insert into public.bookmarks (user_id, question_id) values ('$U1','q1');
SQL

SOURCE_DB_URL="$base/$SRC" BACKUP_PASSPHRASE="$PASS" SCRATCH_ADMIN_URL="$ADMIN" scripts/db-backup.sh "$OUT" >"$OUT.log" 2>&1 && ok "backup script succeeds" || { bad "backup script succeeds"; cat "$OUT.log"; }
ENC="$(ls "$OUT"/*.tar.enc 2>/dev/null | head -1 || true)"
check "only the encrypted file and its checksum are left" '[ "$(ls "$OUT" | wc -l)" = 2 ] && [ -f "$ENC.sha256" ]'
check "the log says the restore check passed" 'grep -q "restore check passed" "$OUT.log"'
check "the secret text is not readable in the encrypted file" '! grep -aq "SECRET-NOTE-TEXT-12345" "$ENC"'
check "no passphrase or connection string in the log" '! grep -q "$PASS" "$OUT.log" && ! grep -q "postgresql://" "$OUT.log"'
check "short passphrase is refused" '! SOURCE_DB_URL="$base/$SRC" BACKUP_PASSPHRASE=short SCRATCH_ADMIN_URL="$ADMIN" scripts/db-backup.sh "$OUT/x" >/dev/null 2>&1'
check "missing source URL is refused" '! BACKUP_PASSPHRASE="$PASS" SCRATCH_ADMIN_URL="$ADMIN" scripts/db-backup.sh "$OUT/x" >/dev/null 2>&1'

P "$ADMIN" -c "create database $DST"
check "restore refuses a wrong passphrase" '! TARGET_DB_URL="$base/$DST" BACKUP_PASSPHRASE="wrong wrong wrong wrong" scripts/db-restore.sh "$ENC" >/dev/null 2>&1'
cp "$ENC" "$OUT/damaged.tar.enc"; printf 'X' | dd of="$OUT/damaged.tar.enc" bs=1 seek=200 conv=notrunc 2>/dev/null
check "restore refuses a damaged file" '! TARGET_DB_URL="$base/$DST" BACKUP_PASSPHRASE="$PASS" scripts/db-restore.sh "$OUT/damaged.tar.enc" >/dev/null 2>&1'
P "$base/$DST" -f supabase/tests/support/supabase_local_shim.sql >/dev/null
P "$base/$DST" -c "insert into auth.users (id) values ('$U1'), ('$U2')"
TARGET_DB_URL="$base/$DST" BACKUP_PASSPHRASE="$PASS" scripts/db-restore.sh "$ENC" >"$OUT/restore.log" 2>&1 && ok "restore into an empty database succeeds" || { bad "restore into an empty database succeeds"; cat "$OUT/restore.log"; }
check "restored data matches (attempts, note text, bookmark)" '[ "$(P "$base/$DST" -c "select count(*) from public.attempts")" = 2 ] && [ "$(P "$base/$DST" -c "select body from public.question_notes")" = "SECRET-NOTE-TEXT-12345" ] && [ "$(P "$base/$DST" -c "select count(*) from public.bookmarks")" = 1 ]'
check "restored RLS is still on for every table" '[ "$(P "$base/$DST" -c "select count(*) from pg_tables where schemaname=\$\$public\$\$ and not rowsecurity")" = 0 ]'
check "restore refuses a database that already has tables (never overwrites)" '! TARGET_DB_URL="$base/$DST" BACKUP_PASSPHRASE="$PASS" scripts/db-restore.sh "$ENC" >/dev/null 2>&1'
check "the live source database was not changed by the backup" '[ "$(P "$base/$SRC" -c "select count(*) from public.attempts")" = 2 ]'

echo; echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
