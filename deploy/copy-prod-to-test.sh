#!/bin/bash
# Put production's data on the test stand (Mika, 14.10.2026: «давай на тест
# заселим реальную информацию»). Since 11.10.2026 production is the stand the
# business works on; the test stand still held the state of 08.10. New work is
# tried on the real rentals, money and fleet, so the test stand takes a copy of
# production's database as it is this minute. Mika runs it:
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/copy-prod-to-test.sh
#
# Production is only read: pg_dump takes a snapshot and writes nothing. The
# rows go from production's database container to the test stand's through a
# pipe on this server; they are not stored in a file, an argument or a log.
#
# Before anything changes, the test stand's own database is copied and the copy
# is proven to restore (deploy/backup.sh); a copy that does not restore stops
# the run. The previous test database also stays beside the new one, as
# ev8ops_prev, until the next run; a failed run puts it back by itself.
#
# Logins stay the test stand's: a person on both stands keeps the test stand's
# password and stays signed in there. A person only on production arrives with
# production's password; a login only on the test stand is not carried.
#
# Nothing is sent to anyone afterwards: the test stand's worker only rolls
# rental weeks and reads Kommo and Bank of Georgia, and production's notices
# still waiting for Telegram come over given up (ADR-0038 §7) — production
# sends them, the test stand never again. A Claude session does not run this
# script on the server: the owner does.
set -euo pipefail

OPS=/srv/ev8-ops
LOCK=/tmp/ev8-follow-develop.lock   # the test deploy's lock: never both at once
LOG=/var/log/ev8-follow.log
DB_USER=ev8ops
DB_NAME=ev8ops
PREV="${DB_NAME}_prev"

cd "$OPS"
exec 9>"$LOCK"
flock -n 9 || { echo "a test deploy is running — try again in a few minutes" >&2; exit 1; }

stand() { docker compose -p ev8-test --env-file .env.test -f docker-compose.prod.yml "$@"; }
PROD_DB=$(docker compose -p ev8-prod ps -q db)
TEST_DB=$(docker compose -p ev8-test ps -q db)
[ -n "$PROD_DB" ] || { echo "no database container for production — is it up?" >&2; exit 1; }
[ -n "$TEST_DB" ] || { echo "no database container for the test stand — is it up?" >&2; exit 1; }
sql() { local c=$1 d=$2; shift 2; docker exec -i "$c" psql -U "$DB_USER" -d "$d" -v ON_ERROR_STOP=1 -qAt "$@"; }

COUNTS="select (select count(*) from rentals)||' rentals, '||(select count(*) from customers)||' customers, '||(select count(*) from vehicles)||' mopeds, '||(select count(*) from payments)||' payments, '||(select count(*) from statement_lines)||' statement lines'"
echo "copy: production now  — $(sql "$PROD_DB" "$DB_NAME" -c "$COUNTS")"
echo "copy: test stand now  — $(sql "$TEST_DB" "$DB_NAME" -c "$COUNTS")"

echo "copy: 1/4 a proven copy of the test stand's database"
BACKUP_DIR=/srv/ev8-backups deploy/backup.sh ev8-test | tail -1

echo "copy: 2/4 the test stand stops writing; its database steps aside as $PREV"
stand stop api worker >/dev/null 2>&1
sql "$TEST_DB" postgres \
  -c "DROP DATABASE IF EXISTS $PREV WITH (FORCE)" \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid()" >/dev/null
sql "$TEST_DB" postgres -c "ALTER DATABASE $DB_NAME RENAME TO $PREV" -c "CREATE DATABASE $DB_NAME"

back() {
  echo "copy: FAILED — the test stand goes back to its own database" >&2
  sql "$TEST_DB" postgres -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)" -c "ALTER DATABASE $PREV RENAME TO $DB_NAME" || true
  stand up -d --no-build api worker >/dev/null 2>&1 || true
}
trap back ERR

echo "copy: 3/4 production's snapshot goes in"
docker exec "$PROD_DB" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc |
  docker exec -i "$TEST_DB" pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --exit-on-error

echo "copy: 4/4 the test stand's logins come back"
{
  echo "CREATE TEMP TABLE keep_users (email text, password_hash text);"
  echo "COPY keep_users FROM STDIN;"
  sql "$TEST_DB" "$PREV" -c "COPY (SELECT email, password_hash FROM users) TO STDOUT"
  echo '\.'
  echo "CREATE TEMP TABLE keep_sessions (token text, email text, created_at timestamptz, last_seen_at timestamptz, expires_at timestamptz);"
  echo "COPY keep_sessions FROM STDIN;"
  # Password sign-ins only: a PIN session belongs to a workshop tablet whose
  # registration production does not have, and carried over it would come
  # back as an ordinary session (ADR-0033). The tablet is registered again.
  sql "$TEST_DB" "$PREV" -c "COPY (SELECT s.token, u.email, s.created_at, s.last_seen_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.expires_at > now() AND s.kind = 'password') TO STDOUT"
  echo '\.'
  echo "DELETE FROM sessions;"
  # Production's notices that had not gone yet are production's to send.
  echo "DO \$\$ BEGIN IF to_regclass('public.notices') IS NOT NULL THEN UPDATE notices SET gave_up_at = now(), last_failure = 'copied' WHERE sent_at IS NULL AND gave_up_at IS NULL; END IF; END \$\$;"
  echo "UPDATE users u SET password_hash = k.password_hash FROM keep_users k WHERE u.email = k.email;"
  echo "INSERT INTO sessions (token, user_id, created_at, last_seen_at, expires_at)
          SELECT k.token, u.id, k.created_at, k.last_seen_at, k.expires_at FROM keep_sessions k JOIN users u ON u.email = k.email;"
  echo "SELECT 'copy: logins kept '||(SELECT count(*) FROM users WHERE email IN (SELECT email FROM keep_users))
          ||', only on production '||(SELECT count(*) FROM users WHERE email NOT IN (SELECT email FROM keep_users))
          ||', only on test, not carried '||(SELECT count(*) FROM keep_users WHERE email NOT IN (SELECT email FROM users));"
} | sql "$TEST_DB" "$DB_NAME"

stand up -d --no-build --wait api worker >/dev/null 2>&1
trap - ERR

echo "copy: test stand after — $(sql "$TEST_DB" "$DB_NAME" -c "$COUNTS")"
echo "$(date -Is) test stand data: a copy of production" >> "$LOG"
echo "copy: done — https://test.ops.ev8.ge holds production's data as of $(date '+%d.%m.%Y %H:%M')"
