#!/bin/sh
# Keeps the test stand on the tip of develop. Run from cron on the server:
#   */3 * * * * /srv/ev8-ops/deploy/follow-develop.sh >> /var/log/ev8-follow.log 2>&1
#
# Two people merge into develop (Mika and Kardu), and neither of them has to
# log into the server to see their work on test.ops.ev8.ge. Production is
# untouched: it lives in /srv/ev8-prod and moves only by a tag.
#
# Does nothing when develop has not moved. Never rebuilds twice at once: the
# server has two cores, and prod runs on the same machine.
set -eu

REPO=/srv/ev8-ops
LOCK=/tmp/ev8-follow-develop.lock

exec 9>"$LOCK"
flock -n 9 || exit 0

cd "$REPO"
git fetch -q origin develop
HERE=$(git rev-parse HEAD)
THERE=$(git rev-parse origin/develop)
[ "$HERE" = "$THERE" ] && exit 0

echo "$(date -Is) develop $(git rev-parse --short "$HERE") -> $(git rev-parse --short "$THERE")"
git merge -q --ff-only origin/develop
nice -n 10 docker compose -p ev8-test --env-file .env.test -f docker-compose.prod.yml up -d --build
echo "$(date -Is) test stand is on $(git log -1 --format='%h %s')"
