#!/bin/bash
# Glasswing UI launcher — data bridge (ws :8760) + static display (http :8080)
# Usage:
#   bash run-glasswing-ui.sh            # auto: NetFIX if gateway is up, else sim
#   bash run-glasswing-ui.sh sim        # force synthetic flight
#   bash run-glasswing-ui.sh netfix     # force FIX-Gateway (SITL / SpeedyBee)
#   bash run-glasswing-ui.sh msfs       # MSFS dev testing (SimConnect stub → sim fallback)
set -e
cd "$(dirname "$0")"
SRC="${1:-auto}"

# venv for the one dependency (websockets) — Homebrew python is externally managed
if [ ! -f .venv/bin/activate ]; then
  echo "creating venv (one-time)…"
  python3 -m venv .venv
  ./.venv/bin/pip install -q websockets
fi
source .venv/bin/activate
python3 -c "import websockets" 2>/dev/null || pip install -q websockets

echo "┌──────────────────────────────────────────────────────┐"
echo "│ Glasswing G3X-style display                          │"
echo "│  source : $SRC                                       "
echo "│  local  : http://localhost:8080                      │"
echo "│  iPad   : http://$(ipconfig getifaddr en0 2>/dev/null || echo '<this-mac-ip>'):8080 (same WiFi)      "
echo "└──────────────────────────────────────────────────────┘"

python3 -m http.server 8080 --directory static &
HTTP_PID=$!
trap 'kill $HTTP_PID 2>/dev/null' EXIT

python3 server.py --source "$SRC"
