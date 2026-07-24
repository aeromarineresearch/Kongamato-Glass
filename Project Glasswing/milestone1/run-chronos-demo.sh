#!/bin/bash
# ============================================================================
# Project Glasswing — Milestone 1: Chronos-2 "actual vs predicted" demo
#
#   Fly SITL (or use the offline demo) → parse the .BIN log → Chronos-2
#   forecast → chart with anomaly flags. The differentiator, zero hardware.
#
# Usage (on your Mac):
#   bash milestone1/run-chronos-demo.sh              # offline demo, real model
#   bash milestone1/run-chronos-demo.sh --fake       # offline plumbing test (no download)
#   bash milestone1/run-chronos-demo.sh /path/to/00000001.BIN   # real flight log
#
# First run creates a venv and pip-installs torch + chronos-forecasting
# (large). First REAL forecast downloads ~0.5 GB of model weights.
# ============================================================================
set -e
GW_DIR="$HOME/DEV/Aviation/Project Glasswing"
STARTER="$GW_DIR/research/DIY Open-Source Aviation Telemetry Engine with Chronos-2/chronos2-starter"
OUT_DIR="$GW_DIR/milestone1/output"

log() { printf '\033[1;36m[glasswing-m1]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[glasswing-m1] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ -d "$STARTER" ] || die "chronos2-starter not found at $STARTER"
command -v python3 >/dev/null || die "python3 not found"
mkdir -p "$OUT_DIR"

# --- venv (idempotent) -------------------------------------------------------
if [ ! -f "$STARTER/.venv/bin/activate" ]; then
  log "Creating Chronos venv (torch is a large download — be patient)…"
  (cd "$STARTER" && python3 -m venv .venv && . .venv/bin/activate \
      && pip install --upgrade pip && pip install -r requirements.txt)
fi
. "$STARTER/.venv/bin/activate"

# --- find or use a log -------------------------------------------------------
LOG=""
FAKE=0
for arg in "$@"; do
  case "$arg" in
    --fake) FAKE=1 ;;
    *) [ -f "$arg" ] && LOG="$arg" ;;
  esac
done

if [ -z "$LOG" ] && [ "$FAKE" -eq 0 ]; then
  # try the newest SITL dataflash log written in the last 24 h
  LOG=$(find "$HOME/ardupilot/logs" "$HOME/ardupilot" -maxdepth 2 -iname '*.BIN' \
        -newermt '-24 hours' 2>/dev/null | sort | tail -1 || true)
fi

cd "$STARTER"

if [ -n "$LOG" ]; then
  log "Parsing log: $LOG"
  python3 parse_log.py "$LOG" -o "$OUT_DIR/attitude.csv"
  log "Forecasting with Chronos-2 (first time downloads ~0.5 GB of weights)…"
  python3 forecast.py --csv "$OUT_DIR/attitude.csv" --targets pitch roll yaw --horizon 48
else
  log "No flight log — running the synthetic demo flight."
  EXTRA=""
  [ "$FAKE" -eq 1 ] && EXTRA="--fake-forecast" && log "(persistence baseline — no model download)"
  python3 forecast.py --demo $EXTRA
fi

# forecast.py writes forecast.png in cwd — keep a copy with the project
[ -f forecast.png ] && cp forecast.png "$OUT_DIR/forecast-$(date +%Y%m%d-%H%M%S).png" \
  && cp forecast.png "$OUT_DIR/forecast-latest.png"

log "Done. Chart saved to: $OUT_DIR/forecast-latest.png"
command -v open >/dev/null && open "$OUT_DIR/forecast-latest.png" || true
