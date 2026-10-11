#!/bin/bash
# Receive a build of the site ev8.ge from GitHub Actions and put it live.
#
# Not run by people. It is the forced command of the one SSH key GitHub holds
# (deploy/site-deploy-setup.sh installs it as /usr/local/bin/ev8-site-receive
# for the user ev8site): whatever the key asks to run, this runs instead, with
# the request in SSH_ORIGINAL_COMMAND. The key can do exactly this and nothing
# else — no shell, no forwarding, no other directory.
#
#   tar -czf - -C dist . | ssh ev8site@204.168.149.105 prod     # from main
#   tar -czf - -C dist . | ssh ev8site@204.168.149.105 test     # from develop
#   ssh ev8site@204.168.149.105 rollback prod                   # previous release
#   ssh ev8site@204.168.149.105 status
#
# Each build lands in its own directory, releases/<UTC time>, and goes live by
# swapping the `current` link in one rename: a visitor gets the old site or
# the new one, never half of each. The last five releases stay for rollback.
set -euo pipefail
set -f   # the request is split into words below; no globbing of them

ROOT=${EV8_SITE_ROOT:-/srv/ev8-site}
KEEP=5
MAX_BYTES=$((200 * 1024 * 1024))
LOG="$ROOT/deploy.log"

# shellcheck disable=SC2206 # the request is two plain words at most
REQ=(${SSH_ORIGINAL_COMMAND:-${*:-}})
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; echo "$*"; }
die() { echo "site-receive: $*" >&2; exit 1; }
target_ok() { case "${1:-}" in test | prod) return 0 ;; *) return 1 ;; esac; }

releases_of() { find "$ROOT/$1/releases" -mindepth 1 -maxdepth 1 -type d -name '2*' -printf '%f\n' 2>/dev/null | sort; }
current_of() { readlink "$ROOT/$1/current" 2>/dev/null | sed 's#^releases/##'; }

point_at() { # target release
  local base="$ROOT/$1"
  ln -sfn "releases/$2" "$base/.current.new"
  mv -T "$base/.current.new" "$base/current"
}

case "${REQ[0]:-}" in
  test | prod)
    T=${REQ[0]}
    BASE="$ROOT/$T"
    mkdir -p "$BASE/releases"
    STAMP=$(date -u +%Y%m%dT%H%M%SZ)
    NEW="$BASE/releases/$STAMP"
    TMP="$BASE/releases/.incoming-$STAMP"
    mkdir "$TMP"
    trap 'rm -rf "$TMP"' EXIT
    # A build larger than this is a mistake, not a site: the stream is cut
    # there and the truncated archive fails tar below.
    if ! head -c "$MAX_BYTES" | tar -xzf - -C "$TMP" --no-same-owner --no-same-permissions; then
      die "the archive did not unpack; nothing changed"
    fi
    # Links could point anywhere on the host; a static site has no use for them.
    find "$TMP" -type l -delete
    [ -f "$TMP/index.html" ] || die "no index.html at the top of the archive; nothing changed"
    chmod -R a+rX,go-w "$TMP"
    mv "$TMP" "$NEW"
    trap - EXIT
    PREV=$(current_of "$T" || true)
    point_at "$T" "$STAMP"
    log "$T: live $STAMP (was ${PREV:-none})"
    releases_of "$T" | head -n -"$KEEP" | while read -r old; do
      [ "$old" = "$STAMP" ] || rm -rf "${BASE:?}/releases/$old"
    done
    ;;
  rollback)
    T=${REQ[1]:-}
    target_ok "$T" || die "rollback test|prod"
    CUR=$(current_of "$T") || die "$T has no live release"
    PREV=$(releases_of "$T" | awk -v c="$CUR" '$0 < c' | tail -n 1)
    [ -n "$PREV" ] || die "$T: nothing older than $CUR to go back to"
    point_at "$T" "$PREV"
    log "$T: rolled back to $PREV (was $CUR)"
    ;;
  status)
    for T in test prod; do
      echo "$T: live $(current_of "$T" || true)"
      releases_of "$T" | sed 's/^/  /'
    done
    ;;
  *)
    die "expected: test | prod (archive on stdin) · rollback test|prod · status"
    ;;
esac
