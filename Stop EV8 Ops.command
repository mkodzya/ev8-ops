#!/bin/bash
# Double-click me to stop EV8 Ops.
cd "$(dirname "$0")"
docker compose down
echo ""
echo "Stopped. Your data is kept — next start picks up where you left off."
echo "You can close this window."
