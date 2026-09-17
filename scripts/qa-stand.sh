#!/bin/bash
# The QA stand: a second EV8 Ops on this Mac with a copy of the laptop stand's
# database, where the tester may create, pay and return without touching the
# live data migrated from Odoo.
#
#   scripts/qa-stand.sh up        copy images and database, start the stand
#   scripts/qa-stand.sh refresh   rebuild from the laptop stand's images and data
#   scripts/qa-stand.sh images    take the laptop stand's current images, keep QA data
#   scripts/qa-stand.sh down      stop it (the QA database volume stays)
#   scripts/qa-stand.sh status    what is running
#
# It never builds: the laptop stand builds (docker compose up -d --build web api
# worker), and QA takes the same images under its own name. One heavy build on
# an 8 GB Mac instead of two.
#
# Open it at http://127.0.0.1:5185 — not localhost. Browsers keep cookies per
# host, not per port, so both stands on "localhost" would share one session
# cookie and a login on one would sign you out of the other.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIVE_PROJECT=ev8-ops-platform
QA_PROJECT=ev8-ops-qa
DB_USER=ev8ops
DB_NAME=ev8ops

live() { docker compose -p "$LIVE_PROJECT" -f "$ROOT/docker-compose.yml" "$@"; }
qa() { docker compose -p "$QA_PROJECT" -f "$ROOT/docker-compose.yml" --env-file "$ROOT/deploy/qa.env" "$@"; }

take_images() {
  for svc in api worker web; do
    docker image inspect "$LIVE_PROJECT-$svc" >/dev/null 2>&1 || {
      echo "No image $LIVE_PROJECT-$svc: start the laptop stand once with --build." >&2
      exit 1
    }
    docker tag "$LIVE_PROJECT-$svc" "$QA_PROJECT-$svc"
  done
}

copy_database() {
  live exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null || {
    echo "The laptop stand's database is not running: docker compose up -d db" >&2
    exit 1
  }
  qa stop api worker web >/dev/null 2>&1 || true
  qa up -d --wait db
  qa exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)" -c "CREATE DATABASE $DB_NAME"
  # Read-only on the live side: pg_dump takes a snapshot and writes nothing.
  live exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc |
    qa exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --exit-on-error
}

start() {
  qa up -d --no-build --wait api worker web
  echo "QA stand: http://127.0.0.1:5185  (api 8092, db 127.0.0.1:5443)"
}

case "${1:-}" in
  up)
    take_images
    if qa exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc "select 1 from users limit 1" 2>/dev/null | grep -q 1; then
      echo "QA database already has data; keeping it (use refresh to start over)."
    else
      copy_database
    fi
    start
    ;;
  refresh)
    take_images
    copy_database
    qa up -d --no-build --force-recreate --wait api worker web
    echo "QA stand refreshed: http://127.0.0.1:5185"
    ;;
  images)
    take_images
    qa up -d --no-build --force-recreate --wait api worker web
    echo "QA stand on the current images, data kept: http://127.0.0.1:5185"
    ;;
  down)
    qa stop
    ;;
  status)
    qa ps
    ;;
  *)
    sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
