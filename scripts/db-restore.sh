#!/usr/bin/env bash
# Restores an encrypted ShuvroMed backup into an EMPTY database.
#
#   TARGET_DB_URL=...  BACKUP_PASSPHRASE=...  scripts/db-restore.sh shuvromed-backup-<time>.tar.enc [--with-auth]
#
# Safety: refuses to run if the target already has any table in the public schema, so it can never
# overwrite a live database. Default: restores schema + data into a database whose public schema is empty. See docs/RESTORE.md.
set -euo pipefail
: "${TARGET_DB_URL:?TARGET_DB_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
FILE="${1:?usage: db-restore.sh BACKUP.tar.enc [--with-auth]}"
WITH_AUTH=0; [ "${2:-}" = "--with-auth" ] && WITH_AUTH=1
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 2; }
[ ! -f "$FILE.sha256" ] || ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" >/dev/null ) || { echo "Checksum does not match: the file is damaged." >&2; exit 1; }

N="$(psql "$TARGET_DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "select count(*) from pg_tables where schemaname='public'")"
[ "$N" = "0" ] || { echo "Refusing: the target database already has $N tables in public. Restore only into an empty database." >&2; exit 3; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
export BACKUP_PASSPHRASE
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" -out "$WORK/backup.tar" 2>/dev/null || { echo "Could not decrypt: wrong passphrase or damaged file." >&2; exit 1; }
tar -C "$WORK" -xf "$WORK/backup.tar"
python3 - "$WORK" <<'PY' || { echo "Files inside the backup do not match the manifest." >&2; exit 1; }
import sys, json, hashlib, pathlib
w = pathlib.Path(sys.argv[1]); m = json.loads((w / 'MANIFEST.json').read_text())
assert m['format'] == 'shuvromed-db-backup'
for n, h in m['files'].items(): assert hashlib.sha256((w / n).read_bytes()).hexdigest() == h, n
PY
pg_restore -l "$WORK/public.dump" | grep -v -E ' SCHEMA( -)? public( |$)' >"$WORK/restore.list" # the database already has its own public schema
pg_restore -L "$WORK/restore.list" -d "$TARGET_DB_URL" --no-owner --no-privileges --exit-on-error "$WORK/public.dump"
if [ "$WITH_AUTH" = "1" ]; then pg_restore -d "$TARGET_DB_URL" --no-owner --no-privileges --data-only --exit-on-error "$WORK/auth.dump"; fi
echo "Restored public schema$( [ "$WITH_AUTH" = 1 ] && echo ' and auth users')."
