#!/bin/sh
# Puts a released tag on production — when Mika says so.
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/deploy-prod.sh 1.0.3
#
# The same way of working as Self Platform (Mika, 28.09.2026): Claude merges
# into develop and puts it on the test stand at once; a release reaches prod
# only on Mika's word, and then Claude cuts it (main + an annotated tag) and
# runs exactly the line above.
#
# Only a tag that is on main goes out. The prod database is copied first,
# with the same restore check as the nightly copy; a copy that does not
# restore stops the release before anything changes. The script is read from
# the test checkout, but it works on /srv/ev8-prod alone.
set -eu

TAG="${1:-}"
case "$TAG" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "usage: deploy-prod.sh X.Y.Z (a release tag)"; exit 2 ;;
esac

PROD=/srv/ev8-prod
OPS=/srv/ev8-ops
LOCK=/tmp/ev8-deploy-prod.lock
LOG=/var/log/ev8-release.log

exec 9>"$LOCK"
flock -n 9 || { echo "a prod deploy is already running"; exit 1; }

cd "$PROD"
git fetch -q --tags origin main
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "no tag $TAG on GitHub"; exit 1; }
git merge-base --is-ancestor "$TAG" origin/main || { echo "tag $TAG is not on main — not a release"; exit 1; }
WAS=$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)
if [ "$WAS" = "$TAG" ]; then
  echo "prod is already on $TAG"
  exit 0
fi

echo "$(date -Is) prod $WAS -> $TAG: copying the database first" | tee -a "$LOG"
COPY=/tmp/ev8-prod-backup.log
if ! ( cd "$OPS" && BACKUP_DIR=/srv/ev8-backups deploy/backup.sh ev8-prod ) > "$COPY" 2>&1; then
  tail -5 "$COPY"
  echo "$(date -Is) the copy of prod did not restore; $TAG NOT released, prod stays on $WAS" | tee -a "$LOG"
  exit 1
fi
tail -1 "$COPY"

git checkout -q "$TAG"
BUILD=/tmp/ev8-prod-build.log
if ! nice -n 10 docker compose -p ev8-prod --env-file .env.prod -f docker-compose.prod.yml up -d --build > "$BUILD" 2>&1; then
  tail -20 "$BUILD"
  echo "$(date -Is) prod build of $TAG FAILED; roll back with: deploy-prod.sh $WAS" | tee -a "$LOG"
  exit 1
fi
tail -3 "$BUILD"
echo "$(date -Is) prod is on $TAG" | tee -a "$LOG"
