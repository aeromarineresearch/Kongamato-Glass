#!/bin/bash
# ============================================================================
# Project Glasswing — Milestone 0: full EFIS data path, ZERO hardware
#
#   ArduPlane SITL  ──MAVLink/UDP──▶  FIX-Gateway  ──NetFIX──▶  pyEfis PFD
#   (the SpeedyBee's exact firmware, simulated)
#
# Run this on your Mac (NOT inside any container):
#     bash ~/DEV/Aviation/"Project Glasswing"/milestone0/run-glasswing-sim.sh
#
# Everything lives inside the project folder:
#   config/fixgw/   — FIX-Gateway runtime config (migrated from ~/makerplane)
#   config/pyefis/  — pyEfis runtime config      (migrated from ~/makerplane)
#
# First run creates two venvs and installs deps — takes a few minutes.
# Later runs start in seconds. Ctrl-C stops everything.
# ============================================================================
set -e
GW_DIR="$HOME/DEV/Aviation/Project Glasswing"
REPOS="$GW_DIR/vendor/makerplane/repos"
FIXGW="$REPOS/FIX-Gateway"
PYEFIS="$REPOS/pyEfis"
FIXGW_CFG="$GW_DIR/config/fixgw"
PYEFIS_CFG="$GW_DIR/config/pyefis"
OLD_CFG="$HOME/makerplane"
MAVLINK_PORT=14552          # UDP: SITL/MAVProxy --out  →  FIX-Gateway listens here
GCS_PORT=14550              # QGroundControl listens here (unchanged)

log() { printf '\033[1;36m[glasswing]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[glasswing] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# --- sanity checks ----------------------------------------------------------
[ -d "$FIXGW" ] || die "FIX-Gateway repo not found at $FIXGW"
[ -d "$PYEFIS" ] || die "pyEfis repo not found at $PYEFIS"
command -v python3 >/dev/null || die "python3 not found"
SIM_VEHICLE="$HOME/ardupilot/Tools/autotest/sim_vehicle.py"
[ -f "$SIM_VEHICLE" ] || die "SITL not found at $SIM_VEHICLE (see research/ArduPilot-SpeedyBee guide)"

# --- migrate legacy ~/makerplane configs into the project (one time) --------
if [ -d "$OLD_CFG/fixgw/config" ] && [ ! -d "$FIXGW_CFG" ]; then
  log "Migrating ~/makerplane/fixgw/config → $FIXGW_CFG"
  mkdir -p "$(dirname "$FIXGW_CFG")"
  mv "$OLD_CFG/fixgw/config" "$FIXGW_CFG"
fi
if [ -d "$OLD_CFG/pyefis/config" ] && [ ! -d "$PYEFIS_CFG" ]; then
  log "Migrating ~/makerplane/pyefis/config → $PYEFIS_CFG"
  mkdir -p "$(dirname "$PYEFIS_CFG")"
  mv "$OLD_CFG/pyefis/config" "$PYEFIS_CFG"
fi
# Remove the old tree if it is now empty (both apps were given --config-file,
# so nothing will write to ~/makerplane again)
if [ -d "$OLD_CFG" ] && [ -z "$(ls -A "$OLD_CFG" 2>/dev/null)" ]; then
  rmdir "$OLD_CFG" && log "Removed now-empty ~/makerplane"
fi

# --- one-time venv setup (idempotent — safe to re-run after a failure) ------
if [ ! -f "$FIXGW/init.marker" ]; then
  log "Setting up FIX-Gateway venv (first run or after a failed attempt)…"
  (cd "$FIXGW" && make venv && make init)
fi
if [ ! -f "$PYEFIS/init.marker" ]; then
  log "Setting up pyEfis venv (PyQt download is large)…"
  (cd "$PYEFIS" && make venv && make init)
fi

# --- seed configs into the project if absent --------------------------------
if [ ! -f "$FIXGW_CFG/default.yaml" ]; then
  log "Seeding FIX-Gateway config into $FIXGW_CFG"
  mkdir -p "$FIXGW_CFG"
  cp -R "$FIXGW/src/fixgw/config/"* "$FIXGW_CFG/"
fi
if [ ! -f "$PYEFIS_CFG/default.yaml" ]; then
  log "Seeding pyEfis config into $PYEFIS_CFG"
  mkdir -p "$PYEFIS_CFG"
  cp -R "$PYEFIS/src/pyefis/config/"* "$PYEFIS_CFG/"
fi
# The repo's main/default.yaml is our source of truth for the windowed-mode
# fix (screenFullSize: False) — keep the project copy in sync with it.
cp "$PYEFIS/src/pyefis/config/main/default.yaml" "$PYEFIS_CFG/main/default.yaml"

# --- FIX-Gateway config: enable mavlink(network) + netfix only --------------
cat > "$FIXGW_CFG/preferences.yaml.custom" <<'EOF'
# Project Glasswing milestone 0 — SITL demo: only mavlink + netfix on.
enabled:
  QUORUM: false
  DATA_RECORDER: false
  NETFIX: true
  COMMAND: false
  FLIGHT_GEAR: false
  XPLANE: false
  CANFIX: false
  MAVLINK: true
  DEMO: false
EOF
# Point the mavlink plugin at the SITL UDP stream (uses our network patch)
cat > "$FIXGW_CFG/connections/mavlink.yaml" <<EOF
# Project Glasswing milestone 0 — read ArduPilot SITL over UDP
# (requires patch 0001-mavlink-network-links, already applied in vendor tree)
mavlink:
  load: MAVLINK
  module: fixgw.plugins.mavlink
  type: network
  port: "udp:127.0.0.1:$MAVLINK_PORT"
  options:
    airspeed: true
    groundspeed: true
    gps: true
    ahrs: true
    accel: true
    pressure: true
    pascal_offset: 2800
EOF

# The stock logging config sends to syslog at /dev/log (Linux-only path) which
# spams non-fatal tracebacks on macOS — drop the syslog handler.
if grep -q "handlers: \[stderr, syslog\]" "$FIXGW_CFG/default.yaml"; then
  sed -i '' 's/handlers: \[stderr, syslog\]/handlers: [stderr]/' "$FIXGW_CFG/default.yaml"
  log "Patched FIX-Gateway logging for macOS (dropped /dev/log syslog handler)"
fi

# --- launch -----------------------------------------------------------------
PIDS=()
cleanup() {
  log "Shutting down…"
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  pkill -f "arducopter" 2>/dev/null || true
  pkill -f "mavproxy.py" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

log "Starting ArduPlane SITL (MAVLink out → udp $MAVLINK_PORT, QGC stays on $GCS_PORT)…"
(cd "$HOME/ardupilot" && python3 "$SIM_VEHICLE" -v ArduPlane \
    --out=udpout:127.0.0.1:$MAVLINK_PORT --no-rebuild) &
PIDS+=($!)
sleep 8   # let SITL boot and stream before the gateway connects

log "Starting FIX-Gateway (mavlink → FIX db → NetFIX :3490)…"
(cd "$FIXGW" && . venv/bin/activate && python3 fixGw.py -v --config-file "$FIXGW_CFG/default.yaml") &
PIDS+=($!)
sleep 3

log "Starting pyEfis PFD (floating window — closable/minimizable)…"
(cd "$PYEFIS" && . venv/bin/activate && python3 pyEfis.py --config-file "$PYEFIS_CFG/default.yaml") &
PIDS+=($!)

log "Up! You should see the pyEfis PFD come alive with simulated flight data."
log "Optional: launch QGroundControl too — it auto-connects on UDP $GCS_PORT."
log "Ctrl-C here stops everything."
wait
