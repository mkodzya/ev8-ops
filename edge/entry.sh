#!/bin/sh
# What the door's container runs (docker-compose.edge.yml): Caddy, and beside
# it a look every fifteen seconds at the settings the site ships for its own
# address.
#
# Why. The site ev8.ge is Kardu's to run without anybody else (Mika,
# 11.10.2026: "по сайту все задачи он должен без меня делать"), and where an
# old address leads or how long a browser keeps a picture is the site's
# business — but it is the door that does it. So those settings travel with
# the site: every release carries /_edge/*.caddy (edge/site.caddy in
# mkodzya/ev8-site), and the Caddyfile beside this script imports them into
# the ev8.ge block.
#
# How it stays safe. The door never reads the release's files directly. It
# keeps its own copy, /data/site-edge/current, and replaces it only with
# settings that pass `caddy validate` together with the whole Caddyfile. So:
#   - settings with a mistake are refused, the ones in force stay, and the
#     door's log says why (the site's release checks for it and fails);
#   - a restart of the door starts from the last settings that were accepted,
#     never from a file somebody has just shipped — the site cannot keep
#     ops.ev8.ge from coming up;
#   - a release with no settings file in it changes nothing;
#   - a reload is graceful: nobody on ops.ev8.ge notices it.
# What the settings can reach is the ev8.ge block they are imported into;
# deploy/README.md says what that means.
set -u

CONF=/etc/caddy/Caddyfile
SRC=/srv/site/prod/current/_edge
DIR=/data/site-edge

mkdir -p "$DIR/current"

mark() { cat "$1"/*.caddy 2>/dev/null | sha256sum | cut -d' ' -f1; }

# Take the site's settings if they changed and the whole config validates
# with them. 0: taken, the door should load its config again. 1: nothing to do.
take() {
  # A release that carries no settings at all changes nothing: the ones in
  # force stay. That is a build that lost the file far more often than a site
  # that wants no rules — and a site that does ships a file with no rules in it.
  ls "$SRC"/*.caddy > /dev/null 2>&1 || return 1
  new=$(mark "$SRC")
  [ "$new" = "$(mark "$DIR/current")" ] && return 1
  [ "$new" = "$(cat "$DIR/refused" 2>/dev/null)" ] && return 1
  rm -rf "$DIR/candidate"
  mkdir -p "$DIR/candidate"
  cp "$SRC"/*.caddy "$DIR/candidate"/ 2>/dev/null
  if SITE_EDGE_DIR="$DIR/candidate" caddy validate --config "$CONF" --adapter caddyfile > "$DIR/validate.log" 2>&1; then
    rm -rf "$DIR/previous"
    mv "$DIR/current" "$DIR/previous"
    mv "$DIR/candidate" "$DIR/current"
    rm -f "$DIR/refused"
    return 0
  fi
  # Remembered, so the same text is not tried again every fifteen seconds.
  echo "$new" > "$DIR/refused"
  echo "edge: the site's settings do not pass caddy validate; the ones in force stay. The reason:"
  grep '^Error' "$DIR/validate.log" | tail -n 2 | grep . || tail -n 1 "$DIR/validate.log"
  return 1
}

take && echo "edge: the site's settings taken at start"
rm -f "$DIR/pending"

(
  while sleep 15; do
    take && : > "$DIR/pending"
    [ -e "$DIR/pending" ] || continue
    if caddy reload --config "$CONF" --adapter caddyfile > "$DIR/reload.log" 2>&1; then
      rm -f "$DIR/pending"
      echo "edge: the site's new settings are in force"
    else
      echo "edge: the door did not load its config again; it will be asked once more. The reason:"
      tail -n 2 "$DIR/reload.log"
    fi
  done
) &

exec caddy run --config "$CONF" --adapter caddyfile
