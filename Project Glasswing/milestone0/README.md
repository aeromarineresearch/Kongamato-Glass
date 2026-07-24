# Milestone 0 — The whole EFIS, zero hardware

Proves the complete Project Glasswing data path **before buying the SpeedyBee**:

```
ArduPlane SITL ──MAVLink/UDP :14552──▶ FIX-Gateway ──NetFIX :3490──▶ pyEfis PFD
(the SpeedyBee's        (data broker, mavlink plugin)        (attitude, tapes,
 exact firmware)                                              HSI, gauges)
```

SITL compiles the *same ArduPilot source* that runs on the F405 chip. The MAVLink
bytes are identical — when the real board arrives, only the `port:` string in
`~/makerplane/fixgw/config/connections/mavlink.yaml` changes
(`type: serial`, `port: /dev/tty.usbserial-…`, `baud: 921600`).

## Run it (on the Mac, one command)

```bash
bash ~/DEV/Aviation/"Project Glasswing"/milestone0/run-glasswing-sim.sh
```

- First run builds two Python venvs (FIX-Gateway + pyEfis) — a few minutes, once.
- Then: SITL boots, the gateway connects, and the pyEfis PFD appears showing
  live simulated attitude/airspeed/altitude/heading.
- Optional: open **QGroundControl** alongside (auto-connects on UDP 14550) to
  fly the plane with missions; or let SITL sit on the ground and watch the
  EFIS show stationary data.
- Ctrl-C in the terminal stops everything.

## What makes SITL→UDP work (the patch)

`patches/0001-mavlink-network-links.patch` (applied in the vendor tree) makes
two fixes, both good **upstream PR candidates** to MakerPlane:

1. **mavlink plugin was serial-only** — it now accepts pymavlink connection
   strings (`udp:`, `tcp:`, …) via `type: network`. This is what lets the
   gateway read ArduPilot SITL (and later, the SpeedyBee's WiFi link).
2. **RPi-only deps broke macOS installs** — `rpi-lgpio`/`smbus` (Linux/RPi-only)
   moved from hard dependencies to an `rpi` extra in `pyproject.toml`
   (`make init` on a real Pi installs `.[rpi]`, unchanged behavior there).

## Files — everything lives inside the project

- `run-glasswing-sim.sh` — the launcher (setup + migrate + start + cleanup)
- `../config/fixgw/` — FIX-Gateway runtime config (migrated from `~/makerplane`
  on first run after the move; apps are launched with `--config-file` so
  nothing is ever written outside the project again)
- `../config/pyefis/` — pyEfis runtime config (same migration)
- `../patches/0001-mavlink-network-links.patch` — the UDP/TCP + macOS-deps patch
- `../patches/0002-weston-graceful-degradation.patch` — Weston no-crash patch
- Config the launcher maintains on each run:
  - `config/fixgw/preferences.yaml.custom` (mavlink+netfix on, rest off)
  - `config/fixgw/connections/mavlink.yaml` (UDP 14552)
  - `config/pyefis/main/default.yaml` (synced from repo: windowed mode)

## Success checklist → then Milestone 1

- [ ] PFD attitude moves when the sim plane is flown
- [ ] Airspeed/altitude/heading tapes live, GPS position on the map screen
- [ ] No red failure flags while SITL runs
- [ ] Then: fly a SITL mission, grab the `.bin` log from `~/ardupilot/logs`
      (or QGC Telemetry dir) → run `research/DIY Open-Source Aviation Telemetry
      Engine with Chronos-2/chronos2-starter/parse_log.py` + `forecast.py`
      → Milestone 1 (the Chronos-2 "actual vs predicted" demo)
