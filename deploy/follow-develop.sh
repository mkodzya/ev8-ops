#!/bin/sh
# Puts the tip of develop on the test stand — when Mika says so.
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/follow-develop.sh --now
#
# From 28.09.2026 the test stand moves on Mika's word, not by itself: Mika
# writes "на тест" and Claude runs exactly the line above, the one command
# on this server Claude is allowed. Production is untouched: it lives in
# /srv/ev8-prod and moves only by a tag Mika checks out.
#
# For a few hours this script ran from cron every three minutes. Without
# --now it does nothing, so that cron line is harmless; --now removes it.
# Never rebuilds twice at once: the server has two cores, and prod runs on
# the same machine.
set -eu

[ "${1:-}" = "--now" ] || exit 0

REPO=/srv/ev8-ops
LOCK=/tmp/ev8-follow-develop.lock
LOG=/var/log/ev8-follow.log
DEPLOYED=/srv/ev8-test.deployed

# The automatic days are over: drop their cron line if it is still there.
if crontab -l 2>/dev/null | grep -q follow-develop; then
  crontab -l | grep -v follow-develop | crontab - || true
fi

exec 9>"$LOCK"
flock -n 9 || { echo "a test deploy is already running"; exit 1; }

cd "$REPO"
git fetch -q origin develop
git merge -q --ff-only origin/develop
# What is running, not what is checked out: a pull without a rebuild once
# left the code new and the stand old (28.09.2026). The stand's commit is
# written only after a build that succeeded.
NOW=$(git rev-parse HEAD)
RUNNING=$(cat "$DEPLOYED" 2>/dev/null || echo none)
if [ "$NOW" = "$RUNNING" ]; then
  echo "test stand is already on $(git log -1 --format='%h %s')"
  exit 0
fi

echo "$(date -Is) test stand $(printf %.7s "$RUNNING") -> $(git rev-parse --short "$NOW")" | tee -a "$LOG"
BUILD=/tmp/ev8-test-build.log
if ! nice -n 10 docker compose -p ev8-test --env-file .env.test -f docker-compose.prod.yml up -d --build > "$BUILD" 2>&1; then
  tail -20 "$BUILD"
  echo "$(date -Is) build FAILED, test stand stays on $(printf %.7s "$RUNNING")" | tee -a "$LOG"
  exit 1
fi
tail -3 "$BUILD"
echo "$NOW" > "$DEPLOYED"
echo "$(date -Is) test stand is on $(git log -1 --format='%h %s')" | tee -a "$LOG"
