#!/bin/bash
# One-time setup on the server so GitHub Actions can put the site ev8.ge live
# on every push: `develop` → test.ops.ev8.ge/garage/site/, `main` → ev8.ge.
# Mika runs it from his Mac, and the key goes straight into the site
# repository's secrets without ever being shown on a screen:
#
#   ssh root@204.168.149.105 /srv/ev8-ops/deploy/site-deploy-setup.sh \
#     | gh secret set SITE_DEPLOY_KEY -R mkodzya/ev8-site
#   ssh-keyscan -t ed25519 204.168.149.105 2>/dev/null \
#     | gh secret set SITE_DEPLOY_KNOWN_HOSTS -R mkodzya/ev8-site
#
# What it does:
#   - a user ev8site with no password and no sudo, owning /srv/ev8-site only;
#   - /usr/local/bin/ev8-site-receive, a root-owned copy of site-receive.sh, so
#     a merge into develop cannot change what the key is allowed to run;
#   - a fresh key pair whose public half may run that command and nothing else
#     (`restrict`: no shell, no port forwarding); the private half goes to
#     standard output, is not kept on the server, and replaces any earlier key;
#   - the preview that is on the server today (/srv/ev8-site-preview/www/garage/site)
#     becomes the first test release, so test.ops.ev8.ge/garage/site/ keeps
#     working until the first build arrives.
#
# It does not restart the edge: the new mount (/srv/ev8-site) and the ev8.ge
# block arrive with `docker compose -p ev8-edge -f docker-compose.edge.yml up -d`,
# which closes the stands for a few seconds — on Mika's word.
#
# Re-running it is safe; it only issues a new key.
set -euo pipefail

USER_NAME=ev8site
HOME_DIR=/var/lib/ev8site
ROOT=/srv/ev8-site
RECEIVE=/usr/local/bin/ev8-site-receive
PREVIEW=/srv/ev8-site-preview/www/garage/site
HERE=$(cd "$(dirname "$0")" && pwd)

say() { echo "$*" >&2; }
[ "$(id -u)" = 0 ] || { say "Run as root."; exit 1; }
[ -t 1 ] && { say "The private key goes to standard output: pipe it into 'gh secret set', see the top of this file."; exit 1; }

if ! id "$USER_NAME" >/dev/null 2>&1; then
  # A real shell is needed: sshd starts the forced command through it.
  useradd --system --create-home --home-dir "$HOME_DIR" --shell /bin/bash "$USER_NAME"
  passwd -l "$USER_NAME" >/dev/null
  say "User $USER_NAME created."
fi

install -o root -g root -m 755 "$HERE/site-receive.sh" "$RECEIVE"

install -d -o "$USER_NAME" -g "$USER_NAME" -m 755 "$ROOT" "$ROOT/test" "$ROOT/prod" "$ROOT/test/releases" "$ROOT/prod/releases"

if [ ! -e "$ROOT/test/current" ] && [ -f "$PREVIEW/index.html" ]; then
  FIRST=$(date -u +%Y%m%dT%H%M%SZ)
  cp -a "$PREVIEW" "$ROOT/test/releases/$FIRST"
  chown -R "$USER_NAME:$USER_NAME" "$ROOT/test/releases/$FIRST"
  ln -s "releases/$FIRST" "$ROOT/test/current"
  chown -h "$USER_NAME:$USER_NAME" "$ROOT/test/current"
  say "Today's preview is test release $FIRST."
fi

KEYDIR=$(mktemp -d)
trap 'rm -rf "$KEYDIR"' EXIT
ssh-keygen -q -t ed25519 -N '' -C "github-actions@mkodzya/ev8-site" -f "$KEYDIR/key"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 700 "$HOME_DIR/.ssh"
printf 'restrict,command="%s" %s\n' "$RECEIVE" "$(cat "$KEYDIR/key.pub")" > "$HOME_DIR/.ssh/authorized_keys"
chown "$USER_NAME:$USER_NAME" "$HOME_DIR/.ssh/authorized_keys"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"

# sshd may admit only listed users; then ev8site must be listed too.
if sshd -T 2>/dev/null | grep -qiE '^allowusers '; then
  sshd -T | grep -qiE "^allowusers .*\b$USER_NAME\b" \
    || say "WARNING: sshd has AllowUsers without $USER_NAME — add it, or GitHub will be refused."
fi

cat "$KEYDIR/key"
say "Key issued; the private half went to standard output only. Check from the Mac:"
say "  ssh ev8site@204.168.149.105 status   (refused: the key is not yours — that is the point)"
say "  after the first push: ssh root@204.168.149.105 \"sudo -u $USER_NAME $RECEIVE status\""
