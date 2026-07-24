# Integration Contract — Glasswing Tracks 1 + 2 + Super AFCS (Track 3)

The one rule: **FIX-Gateway is the data bus (state), MAVLink is the control path
(commands), ROS2 actions are the autonomy API (judgment).** Three tracks, three
protocols, one source of truth each.

```
                 ┌─────────────────── Track 3 ───────────────────┐
                 │  afcs_mission → afcs_executive → autopilot_if │
                 └──────┬───────────────────────────┬────────────┘
              commands  │ MAVLink (MAVROS)          │ ROS2
                        ▼                           ▼
              ArduPilot FC (SpeedyBee/Pixhawk)   glasswing_bridge
                        │ MAVLink                       │ NetFIX client
                        ▼                               ▼
                 ┌───────────── FIX-Gateway (Pi 5, data system of record) ─┐
                 │   mavlink plugin → IAS/ALT/PITCH/ROLL/... (existing)    │
                 │   AFCS_* keys ← glasswing_bridge (new, below)           │
                 └──┬──────────────┬───────────────┬──────────────────────┘
        NetFIX :3490│              │NetFIX :3490   │NetFIX :3490
                    ▼              ▼               ▼
        Track 1: pyEfis panel   Track 2: AR HUD   glasswing-ui web
        (FMA strip + map)       (conformal FMA,   (dev mirror)
                                 traffic chevrons)
```

## New NetFIX keys (owned by Track 3, consumed by 1 & 2)

Published via FIX-Gateway `command` plugin (client→server `KEY;value` writes) or a
dedicated `afcs` plugin — see `glasswing_bridge`:

| Key | Type | Meaning |
|---|---|---|
| `AFCS_MODE` | str | `OFF / SHADOW / ARMED / AUTO_TAKEOFF / ENROUTE / APPROACH / AUTOLAND / GO_AROUND / DEGRADED / FAILSAFE` |
| `AFCS_TARGET` | str | current objective, e.g. `KSQL RWY30` |
| `AFCS_PHASE` | str | fine-grained action feedback phase |
| `AFCS_INTENT` | str | plain-language plan ("Downwind entry 45°, land RWY30, wind 280@12") |
| `AFCS_DTG_NM`, `AFCS_ETA_S` | float | distance/time to go |
| `AFCS_WIND` | str | `280@12G18` |
| `AFCS_ENERGY` | float | energy state vs approach gate (−1..+1) |
| `AFCS_ADVISORY` | str | latest advisory, auto-expiring |
| `AFCS_CMD` | str (write) | panel/HUD → AFCS commands (`DISENGAGE`, `GO_AROUND`, `CONFIRM`) |
| `TRAFFIC_BRG/DIST/RELALT/ID` | float/str | nearest traffic (ADS-B or perception) |

## Track 1 (panel) changes required

- pyEfis screen YAML: add **FMA strip** at top of PFD bound to `AFCS_MODE/PHASE/TARGET`.
- Big red DISENGAGE button writing `AFCS_CMD=DISENGAGE`.
- Moving map: draw `AFCS_TARGET` + DTG/ETA readout.
- Effort: small — pyEfis is YAML-configured gauges; no core changes.

## Track 2 (HUD) changes required

- Subscribe to the 4 new keys in `NetfixClient.keys` list (one line).
- `HudView`: slim FMA line top-center (mode + target), intent ticker bottom,
  traffic chevron at `TRAFFIC_BRG` when within declutter threshold.
- Voice via phone mic → `afcs_human_interface` (Track 2 supplies the mic front-end;
  Track 3 owns the intent grammar).
- Declutter rule preserved: FMA is 1 line; advisories replace symbology only when
  safety-relevant. See the new "Track 3 sync" section appended to `AR_HUD_AVIONICS.md`.

## Failure isolation (matches SAFETY.md)

- AFCS dead → Tracks 1&2 keep full flight data (they read FC keys, not AFCS keys);
  FMA shows `OFF`.
- FIX-Gateway dead → AFCS keeps flying (its data path is MAVROS/MAVLink); displays
  degrade gracefully per each track's existing stale-data rules.
