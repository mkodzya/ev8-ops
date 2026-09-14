#!/bin/bash
# Double-click me to start EV8 Ops in DEVELOPMENT mode.
#
# Same stack, same database, same address — the difference is that the code
# is read from this folder instead of from inside the image, so an edit shows
# up straight away: the browser refreshes itself, the API restarts on save.
cd "$(dirname "$0")"

echo "Opening Docker Desktop (if it isn't already running)…"
open -a Docker 2>/dev/null

echo "Waiting for Docker to be ready — this can take a minute…"
until docker info >/dev/null 2>&1; do sleep 2; done

echo ""
echo "Starting in DEV mode. Open  http://localhost:5175  and leave it open."
echo "To stop: press Ctrl+C in this window, or double-click Stop EV8 Ops.command."
echo ""
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
