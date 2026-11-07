#!/usr/bin/env bash
# Encrypted, verified backup of the ShuvroMed database.
#
#   SOURCE_DB_URL=...  BACKUP_PASSPHRASE=...  SCRATCH_ADMIN_URL=...  scripts/db-backup.sh OUTDIR
#
# What it does, in order:
#   1. counts every public table, dumps the public schema + data and the auth users, counts again;
#   2. RESTORES the public dump into a throwaway database and checks every table came back with a row count
#      that fits between the "before" and "after" counts (the data can change while the dump runs);
#   3. packs dumps + manifest, ENCRYPTS them (AES-256, passphrase), decrypts the result again and compares;
#   4. leaves only OUTDIR/shuvromed-backup-<time>.tar.enc and its .sha256. No plain-text copy remains.
# Any failed step stops the script with a non-zero exit code. Secrets are never printed.
set -euo pipefail

: "${SOURCE_DB_URL:?SOURCE_DB_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
: "${SCRATCH_ADMIN_URL:?SCRATCH_ADMIN_URL is not set (an admin connection to a throwaway PostgreSQL server)}"
OUT="${1:?usage: db-backup.sh OUTDIR}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SHIM="$HERE/../supabase/tests/support/supabase_local_shim.sql"
[ ${#BACKUP_PASSPHRASE} -ge 16 ] || { echo "BACKUP_PASSPHRASE must be at least 16 characters." >&2; exit 2; }

mkdir -p "$OUT"
WORK="$(mktemp -d)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SCRATCH="backup_verify_$$"
cleanup() {
  psql "$SCRATCH_ADMIN_URL" -qAt -c "drop database if exists $SCRATCH" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -At -F '|')
counts() { # "table|rows" for every table in public
  "${PSQL[@]}" "$1" -c "select format('select %L, count(*) from public.%I;', tablename, tablename) from pg_tables where schemaname='public' order by tablename" | "${PSQL[@]}" "$1" -f -
}
scratch_url() { # same server as the admin URL, other database name
  local u="$SCRATCH_ADMIN_URL"; local base="${u%%\?*}"; local q=""; [ "$base" != "$u" ] && q="?${u#*\?}"
  echo "${base%/*}/$SCRATCH$q"
}

echo "1/5 counting and dumping"
counts "$SOURCE_DB_URL" >"$WORK/before.txt"
pg_dump "$SOURCE_DB_URL" -Fc --schema=public --no-owner --no-privileges -f "$WORK/public.dump"
HAS_IDENTITIES="$("${PSQL[@]}" "$SOURCE_DB_URL" -c "select count(*) from pg_tables where schemaname='auth' and tablename='identities'")"
AUTH_TABLES=(--table=auth.users); [ "$HAS_IDENTITIES" = "1" ] && AUTH_TABLES+=(--table=auth.identities)
pg_dump "$SOURCE_DB_URL" -Fc --data-only "${AUTH_TABLES[@]}" -f "$WORK/auth.dump"
counts "$SOURCE_DB_URL" >"$WORK/after.txt"
"${PSQL[@]}" "$SOURCE_DB_URL" -c "select id from auth.users order by id" >"$WORK/user_ids.txt"

echo "2/5 restoring into a throwaway database to prove the dump is usable"
psql "$SCRATCH_ADMIN_URL" -qAt -v ON_ERROR_STOP=1 -c "create database $SCRATCH"
SU="$(scratch_url)"
psql "$SU" -X -q -v ON_ERROR_STOP=1 -f "$SHIM" >/dev/null
while read -r id; do [ -n "$id" ] && echo "insert into auth.users (id) values ('$id');"; done <"$WORK/user_ids.txt" | psql "$SU" -X -q -v ON_ERROR_STOP=1 >/dev/null
pg_restore -l "$WORK/public.dump" | grep -v -E ' SCHEMA( -)? public( |$)' >"$WORK/restore.list" # the database already has its own public schema
pg_restore -L "$WORK/restore.list" -d "$SU" --no-owner --no-privileges --exit-on-error "$WORK/public.dump"
counts "$SU" >"$WORK/restored.txt"

python3 - "$WORK" <<'PY'
import sys, pathlib
w = pathlib.Path(sys.argv[1])
rd = lambda n: {l.split('|')[0]: int(l.split('|')[1]) for l in (w / n).read_text().split('\n') if l.strip()}
before, after, restored = rd('before.txt'), rd('after.txt'), rd('restored.txt')
bad = []
for t in sorted(set(before) | set(after) | set(restored)):
    if t not in restored: bad.append(f'{t}: missing after restore'); continue
    lo, hi = min(before.get(t, 0), after.get(t, 0)), max(before.get(t, 0), after.get(t, 0))
    if not (lo <= restored[t] <= hi): bad.append(f'{t}: restored {restored[t]} rows, expected {lo}..{hi}')
if bad:
    print('RESTORE CHECK FAILED:\n  ' + '\n  '.join(bad)); sys.exit(1)
print(f'   restore check passed: {len(restored)} tables, {sum(restored.values())} rows')
PY

echo "3/5 writing manifest"
python3 - "$WORK" "$STAMP" <<'PY'
import sys, json, hashlib, pathlib
w = pathlib.Path(sys.argv[1])
rd = lambda n: {l.split('|')[0]: int(l.split('|')[1]) for l in (w / n).read_text().split('\n') if l.strip()}
sha = lambda n: hashlib.sha256((w / n).read_bytes()).hexdigest()
json.dump({'format': 'shuvromed-db-backup', 'version': 1, 'createdAt': sys.argv[2], 'publicTableCounts': rd('restored.txt'),
           'files': {'public.dump': sha('public.dump'), 'auth.dump': sha('auth.dump')},
           'restoreVerified': True}, open(w / 'MANIFEST.json', 'w'), indent=2)
PY
tar -C "$WORK" -cf "$WORK/backup.tar" MANIFEST.json public.dump auth.dump

echo "4/5 encrypting"
FILE="$OUT/shuvromed-backup-$STAMP.tar.enc"
export BACKUP_PASSPHRASE
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$WORK/backup.tar" -out "$FILE"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" -out "$WORK/roundtrip.tar"
cmp -s "$WORK/backup.tar" "$WORK/roundtrip.tar" || { echo "Encrypted file does not decrypt back to the original." >&2; rm -f "$FILE"; exit 1; }
( cd "$OUT" && sha256sum "$(basename "$FILE")" >"$(basename "$FILE").sha256" )

echo "5/5 done: $(basename "$FILE") ($(du -k "$FILE" | cut -f1) KB, decrypts and restores)"
