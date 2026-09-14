#!/bin/bash
# Double-click me to WIPE the local database and restart with the DEMO
# dataset: 3 models, 10 mopeds, 6 customers, 6 rentals — every row marked
# DEMO, nothing real. For trying screens and wizards on a laptop only; the
# seed refuses to run this on a stand.
cd "$(dirname "$0")"

echo "This erases everything in the LOCAL EV8 Ops database and restarts it with DEMO data."
echo "Press Return to continue, or close this window to cancel."
read -r

open -a Docker 2>/dev/null
until docker info >/dev/null 2>&1; do sleep 2; done

docker compose down -v
echo ""
echo "Starting with DEMO data… when the text settles, open http://localhost:5175"
echo "Logins: the owner from .env, plus demo.director@ev8.test and demo.manager@ev8.test (same password)."
echo ""
SEED_MODE=demo docker compose up --build
