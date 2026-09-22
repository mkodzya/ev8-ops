#!/bin/sh
# EV8 Ops — a copy of a stand's database, and the proof that it restores.
#
#   deploy/backup.sh ev8-ops            # the production compose project
#   deploy/backup.sh ev8-ops-test
#
# Practices §2: a copy nobody has restored is not a copy. This one restores
# every dump it takes into a throwaway database and counts the rows before it
# calls the file good — the lesson of 07.09.2026, when a provider's balance ran
# out and prod went down together with dev.
#
# The file holds customers' names, phones and personal numbers. It is written
# to BACKUP_DIR, which belongs outside the repository and outside any cloud
# folder that syncs by itself.
set -eu

PROJECT="${1:?which compose project: ev8-ops or ev8-ops-test}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/ev8-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
DB_USER="${POSTGRES_USER:-ev8ops}"
DB_NAME="${POSTGRES_DB:-ev8ops}"

stamp=$(date +%Y%m%d%H%M)
name="${stamp}_EV8_${PROJECT}.dump"
mkdir -p "$BACKUP_DIR"

db=$(docker compose -p "$PROJECT" ps -q db)
[ -n "$db" ] || { echo "backup: no db container in project $PROJECT — is it up?" >&2; exit 1; }

echo "backup: dumping $PROJECT → $BACKUP_DIR/$name"
docker exec "$db" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$BACKUP_DIR/$name"

# --- the part that makes it a backup rather than a file -------------------
echo "backup: restoring it into a throwaway database to prove it can be"
probe="ev8_restore_probe_$$"
docker exec "$db" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $probe" >/dev/null
docker exec "$db" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE $probe" >/dev/null
# `pg_restore` warns about ownership on a fresh database; the exit code of the
# restore is what matters, and the row count after it is what settles it.
if ! docker exec -i "$db" pg_restore -U "$DB_USER" -d "$probe" --no-owner < "$BACKUP_DIR/$name" >/dev/null 2>&1; then
  docker exec "$db" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $probe" >/dev/null
  echo "backup: the dump does not restore — the file is NOT a backup" >&2
  exit 1
fi
rows=$(docker exec "$db" psql -U "$DB_USER" -d "$probe" -tAc \
  "select (select count(*) from rentals) || '/' || (select count(*) from customers) || '/' || (select count(*) from payments)")
docker exec "$db" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $probe" >/dev/null

( cd "$BACKUP_DIR" && shasum -a 256 "$name" >> SHA256SUMS )
echo "backup: ok — restored, rentals/customers/payments = $rows"

# A month of dailies is enough on the server; the monthly copy on an external
# disk is a separate, human step (practices §2).
find "$BACKUP_DIR" -name '*_EV8_*.dump' -mtime "+$KEEP_DAYS" -print -delete
