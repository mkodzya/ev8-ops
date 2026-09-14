#!/bin/bash
# Double-click me to start EV8 Ops on this Mac.
# (First time on a new Mac: right-click → Open, because macOS warns about
# files downloaded from the internet.)
cd "$(dirname "$0")"

echo "Opening Docker Desktop (if it isn't already running)…"
open -a Docker 2>/dev/null

echo "Waiting for Docker to be ready — this can take a minute…"
until docker info >/dev/null 2>&1; do sleep 2; done

echo ""
echo "Starting EV8 Ops. The very first start builds everything (5–15 min)."
echo "When the text settles down, open  http://localhost:5175  in your browser."
echo "To stop: press Ctrl+C in this window, or double-click Stop EV8 Ops.command."
echo ""
docker compose up --build
