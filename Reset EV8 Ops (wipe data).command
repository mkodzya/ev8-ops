#!/bin/bash
# Double-click me to WIPE the local database and restart empty: no fleet, no
# customers, no rentals — one owner login (see OWNER_* in .env or the compose
# defaults). Real data comes back through tools/migrate_stage1.py.
cd "$(dirname "$0")"

echo "This erases everything in the LOCAL EV8 Ops database and restarts it empty."
echo "Press Return to continue, or close this window to cancel."
read -r

open -a Docker 2>/dev/null
until docker info >/dev/null 2>&1; do sleep 2; done

docker compose down -v
echo ""
echo "Starting empty… when the text settles, open http://localhost:5175"
echo ""
docker compose up --build
