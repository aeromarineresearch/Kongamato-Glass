# Glasswing / Super AFCS — Session Handoff

*Read this first in any new session. Last updated: 2026-07-23.*

---

## The project in one breath

Three synced tracks of one open-source experimental-aviation stack — a glass
cockpit, an AR glasses HUD, and a full autopilot (auto takeoff/land, nearest-airport
divert, wind-aware patterns, perception, voice commands) with the PIC always able to
override. Everything open source, sim-first with sim/real code parity.

| Track | Directory | Role | Master doc |
|---|---|---|---|
| 1 | `~/DEV/Aviation/Project Glasswing/` | Glass cockpit EFIS (FIX-Gateway + pyEfis + SpeedyBee/ArduPilot sensors, Chronos-2 analytics) | `MASTER-PLAN.md` |
| 2 | `~/DEV/Aviation/AR XR HUD Avionics/` | Android/Kotlin see-through glasses HUD, NetFIX client | `AR_HUD_AVIONICS.md` |
| 3 | `~/DEV/Aviation/Super AFCS AutoPilot/` | **Autonomy brain** (ROS2 + ArduPilot, Dockerized, AAS-pattern) | `README.md` → `docs/ARCHITECTURE.md` |

**The integration contract** (`Super AFCS AutoPilot/docs/INTEGRATION.md`):
FIX-Gateway = data bus (NetFIX tcp:3490), MAVLink = control path, ROS2 actions =
autonomy API. New `AFCS_*` / `TRAFFIC_*` NetFIX keys are registered in
`Project Glasswing/config/fixgw/database/custom.yaml`.

External foundation: `JacopoPan/aerial-autonomy-stack` (arXiv:2602.07264) — we adopt
its principles (3 dockerized images, one aircraft Dockerfile for sim+Jetson, ROS2
action interface, FTRT CI, HITL gates) but re-implement for GA fixed-wing; we do NOT
fork it. Mapping: `Super AFCS AutoPilot/docs/AAS-PRINCIPLES.md`.

## What exists right now

**Working/tested code:**
- `Super AFCS AutoPilot/autonomy_ws/src/glasswing_bridge/…/bridge_node.py` — ROS2↔NetFIX bridge (the Track 3↔1/2 sync point)
- `…/afcs_mission/…/airport_db.py` — nearest-suitable-airport engine (wind/runway scoring; tested)
- `…/afcs_human_interface/…/intent_parser.py` — voice grammar w/ readback-confirm (tested, incl. pilot-speak altitudes)
- `…/afcs_msgs/` — ROS2 actions: `AutoTakeoff`, `LandAt`, `Divert`, `VoiceCommand`; msg `FmaState`
- `Super AFCS AutoPilot/docker/` — multi-arch `aircraft.Dockerfile` (amd64-sim/arm64-Jetson, one file), `compose.sim.yaml` (dual SIM/AIR networks)
- `Super AFCS AutoPilot/scripts/afcs` — the one-command CLI (`sim|test|up|logs|build`)
- `.github/workflows/ci.yml` — builds both arches + FTRT mission suite on PRs
- `config/aircraft/c172_dev.yaml` — aircraft profile; authority ladder enforced in config (all rungs false, shadow_mode true)

**Track 1 (done this session):**
- `config/fixgw/database/custom.yaml` — all `AFCS_*`/`TRAFFIC_*` keys registered
- `config/pyefis/includes/afcs/fma-strip.yaml` — FMA strip (mode/target/wind, phase/intent lines)
- `config/pyefis/buttons/afcs-disengage.yaml` — big red DISENGAGE (writes `AFCS_CMD=DISENGAGE`)
- `config/pyefis/screens/pfd.yaml` — FMA strip included LAST (paints on top of VirtualVFR)
- All YAML validated with pyyaml

**Track 2 (done this session):**
- `AR_HUD_AVIONICS.md` §15 + §15.1 — Track-3 sync spec + ready-to-paste Kotlin:
  `PfdData` AFCS fields, `NetfixClient` key list + string-key parsing,
  `HudView.drawFmaStrip()` + `drawTrafficChevron()`

**Docs (the design brain — read these):**
- `Super AFCS AutoPilot/docs/`: ARCHITECTURE, SAFETY (5 override paths, failure matrix, shadow mode), SIM2REAL (evidence ladder P0–P5), AAS-PRINCIPLES, INTEGRATION, ROADMAP (A0–A8)

## Safety posture (never negotiate)

Experimental/E-AB, VFR-day, not certified. PIC override at all times: guarded switch +
stick breakout are hardware-level (Jetson-independent). Panel/HUD keep full flight data
if the autonomy computer dies. New installs start in shadow mode (advise-only).
Details: `Super AFCS AutoPilot/docs/SAFETY.md`.

## Where we left off / next actions (in order)

1. **Glasswing Milestone 0** — run SITL → FIX-Gateway → pyEfis on this machine
   (`Project Glasswing/milestone0/run-glasswing-sim.sh`) and **verify the FMA strip
   renders** with the new AFCS keys (publish test values: `AFCS_MODE;APPROACH` etc.
   to NetFIX). This is the immediate next session task.
2. **AFCS A0 bring-up** — `docker/` images build + Gazebo + ArduPilot Plane SITL +
   MAVROS + glasswing_bridge alive under `./afcs sim` (ROS2 Jazzy env needed)
3. `afcs_executive` state machine node (DISCONNECTED→PREFLIGHT→READY→AUTO_ENGAGED⇄MANUAL)
   consuming `/afcs/cmd` from glasswing_bridge
4. Package.xml/CMakeLists for the ROS2 packages (currently Python modules + action
   definitions only — they don't build with colcon yet)
5. KSQL Gazebo world + C172-class SDF model (`simulation/`)
6. Git init + push (user will create the repo; LICENSE MIT is already in place)

## Open decisions for the user

- ROS2 distro: docs say Jazzy (AAS used Humble) — pick at A0; both fine, Jazzy preferred
- Voice ASR: whisper.cpp on-device planned; HUD phone may be the actual mic (Track 2 §15)
- Ground tier: reuse Chronos-2 pipeline for autonomy behavior trending (planned, not built)

## House rules for future sessions

- Update this file at the end of every work session ("where we left off" section)
- Every cross-track change must stay consistent with `docs/INTEGRATION.md`
- Don't add NetFIX keys without registering them in `config/fixgw/database/custom.yaml`
- Sim↔real differences are config (YAML), never code — see `docs/SIM2REAL.md` §1
