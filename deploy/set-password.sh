#!/bin/bash
# Set a stand user's password. Passwords are stored one-way, so a forgotten one
# is never recovered — it is replaced. The new password is typed here and goes
# nowhere else: it travels into the api container over standard input, comes
# back as a one-way digest, and only the digest reaches the database. It never
# appears in the shell history, the process list, or any log.
#
#   deploy/set-password.sh ev8-prod .env.prod mika@selfstudio.se
#
# Run it from the stand's directory — the one holding docker-compose.prod.yml.
set -euo pipefail

PROJECT="${1:?usage: set-password.sh <compose-project> <env-file> <email>}"
ENVF="${2:?usage: set-password.sh <compose-project> <env-file> <email>}"
EMAIL="${3:?usage: set-password.sh <compose-project> <env-file> <email>}"
[ -f docker-compose.prod.yml ] || { echo "Run this from the stand directory."; exit 1; }
[ -f "$ENVF" ] || { echo "No $ENVF here."; exit 1; }

dc() { docker compose -p "$PROJECT" --env-file "$ENVF" -f docker-compose.prod.yml "$@"; }

FOUND=$(dc exec -T db psql -U ev8ops -d ev8ops -tAc \
  "SELECT count(*) FROM users WHERE email = \$\$${EMAIL}\$\$")
[ "$FOUND" = "1" ] || { echo "No such login on this stand: $EMAIL"; exit 1; }

read -rsp "New password for $EMAIL (8 characters or more): " P; echo
read -rsp "Again: " P2; echo
[ "$P" = "$P2" ] || { echo "The two did not match."; exit 1; }
[ ${#P} -ge 8 ] || { echo "Too short."; exit 1; }

HASH=$(printf %s "$P" | dc exec -T api node -e '
  const c = require("node:crypto");
  let p = ""; process.stdin.on("data", d => p += d).on("end", () => {
    const salt = c.randomBytes(16).toString("hex");
    process.stdout.write("s2:" + salt + ":" + c.scryptSync(p, salt, 64).toString("hex"));
  });')
case "$HASH" in s2:*) ;; *) echo "Could not compute the digest."; exit 1;; esac

dc exec -T db psql -U ev8ops -d ev8ops -v ON_ERROR_STOP=1 -tAc \
  "UPDATE users SET password_hash = \$\$${HASH}\$\$, updated_at = now() WHERE email = \$\$${EMAIL}\$\$" >/dev/null
# A password change ends the old sessions: whoever knew the previous one is out.
dc exec -T db psql -U ev8ops -d ev8ops -tAc \
  "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = \$\$${EMAIL}\$\$)" >/dev/null
# The lockout counter is a defence against guessing, not against the owner.
dc exec -T db psql -U ev8ops -d ev8ops -tAc \
  "DELETE FROM login_attempts WHERE email = \$\$${EMAIL}\$\$" >/dev/null

echo "Password set for $EMAIL on $PROJECT. Other devices are signed out."
