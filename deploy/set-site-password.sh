#!/bin/bash
# Set the login for the previews of the new site (test.ops.ev8.ge/garage/).
# The password is typed here and goes nowhere else: it travels into the edge
# container over standard input and comes back as a one-way digest; only the
# digest is written to disk. It never appears in the shell history, the
# process list, or any log.
#
#   ssh -t root@204.168.149.105 /srv/ev8-ops/deploy/set-site-password.sh
#
# With --lock it sets a random password nobody knows: the previews stay
# closed until this script is run again without it.
set -euo pipefail

DIR=/srv/ev8-site-preview/auth
FILE="$DIR/garage.caddy"
EDGE=ev8-edge-edge-1
LOGIN=ev8

if [ "${1:-}" = "--lock" ]; then
  P=$(openssl rand -base64 32)
else
  read -rsp "New password for the site previews (8 characters or more): " P; echo
  read -rsp "Again: " P2; echo
  [ "$P" = "$P2" ] || { echo "The two did not match."; exit 1; }
  [ ${#P} -ge 8 ] || { echo "Too short."; exit 1; }
fi

HASH=$(printf '%s\n' "$P" | docker exec -i "$EDGE" caddy hash-password)
case "$HASH" in '$2'*) ;; *) echo "Could not compute the digest."; exit 1;; esac

mkdir -p "$DIR"
TMP=$(mktemp "$DIR/.garage.XXXXXX")
printf 'basic_auth {\n\t%s %s\n}\n' "$LOGIN" "$HASH" > "$TMP"
chmod 644 "$TMP"
mv "$TMP" "$FILE"

# The edge may not have the preview block yet (first install): then there is
# nothing to reload, and the next start reads the file.
if docker exec "$EDGE" test -d /srv/site-preview 2>/dev/null; then
  docker exec "$EDGE" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    || { echo "The digest is written, but the edge did not reload. Check: docker logs $EDGE"; exit 1; }
fi

if [ "${1:-}" = "--lock" ]; then
  echo "Previews are locked: nobody has the password."
else
  echo "Password set. Login: $LOGIN"
fi
