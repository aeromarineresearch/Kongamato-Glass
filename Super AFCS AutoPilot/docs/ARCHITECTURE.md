# Super AFCS — System Architecture

Status: master design doc · Compiled 2026-07-23
Companion docs: `SAFETY.md`, `SIM2REAL.md`, `AAS-PRINCIPLES.md`, `INTEGRATION.md`, `ROADMAP.md`

---

## 1. What "everything a pilot can do" means in software

A private pilot's cognitive loop: **perceive → decide → act → monitor → communicate**.
Super AFCS mirrors it with five subsystems, each independently testable in sim:

| Pilot function | AFCS subsystem | Package | Key capabilities |
|---|---|---|---|
| Eyes / ears | **Perception** | `afcs_perception` | YOLO runway/traffic/bird/obstacle detect, LiDAR KISS-ICP odometry, ADS-B traffic (GDL90), terrain database |
| Judgment | **Mission brain** | `afcs_mission` | Behavior-tree missions, nearest-airport diversion, wind-aware pattern entry, energy management, go-around logic |
| Hands / feet | **Autopilot interface** | `autopilot_interface` + `afcs_executive` | ROS2 actions (Takeoff/Land/Orbit/Goto/LandAt), ArduPilot Plane primary, PX4 secondary |
| Situation awareness | **Glasswing data bus** | `glasswing_bridge` | ROS2 ↔ NetFIX bridge; all state lands in FIX-Gateway → panel + HUD show identical data |
| Communication | **Human interface** | `afcs_human_interface` | Wake-word voice, text, touchscreen; intent parser with mandatory readback/confirmation |

Hard boundary (from AAS, kept religiously): **autonomy never speaks MAVLink directly.**
All control flows through `autopilot_interface` actions — that is what makes the stack
autopilot-agnostic and sim/real-identical.

## 2. The Dockerized three-image architecture (AAS pattern, adapted to GA)

```
┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
│ simulation-image   │  │ aircraft-image     │  │ ground-image       │
│ amd64 dev/CI only  │  │ amd64 == arm64     │  │ amd64              │
│ Gazebo Harmonic    │  │ ROS2 Jazzy         │  │ QGroundControl     │
│ ArduPilot SITL     │  │ MAVROS / XRCE-DDS  │  │ Zenoh bridge       │
│ GA aircraft SDFs   │  │ afcs_* packages    │  │ mission review     │
│ worlds (airports,  │  │ perception (ONNX   │  │ flight_review      │
│  terrain, wind)    │  │  CUDA/TensorRT)    │  │ PlotJuggler        │
└───────┬────────────┘  └───────┬────────────┘  └───────┬────────────┘
        │ SIM_SUBNET (UDP: Gazebo↔SITL, GStreamer cam, LiDAR, MAVLink)
        │ AIR_SUBNET  (TCP: Zenoh ROS2 bridge, voice uplink, NetFIX)
```

**Code parity (the whole ballgame):** `aircraft-image` builds from ONE Dockerfile,
`TARGETARCH` parameterized. On your Mac/CI it runs amd64 against SITL; on the Jetson
Orin in the airplane it runs arm64 against `/dev/ttyTHS1`. Bit-for-bit the same ROS2
packages, the same behavior trees, the same ONNX model. The only things that change are
three YAML connection strings. This is AAS's central sim2real weapon and we inherit it
wholesale (`docker/aircraft.Dockerfile`).

Glasswing additions AAS doesn't have:
- **FIX-Gateway runs in the aircraft container** (it's lightweight Python) — the EFIS
  data bus is onboard, so panel + HUD work identically in sim and flight.
- **A `glasswing` world/vehicle model in Gazebo**: a Cessna-172-class fixed-wing with
  realistic powerplant, plus an `airports` world built from real runway geometry
  (CIFP/OurAirports data we already vendor in Glasswing).

## 3. ROS2 action interface (from AAS, extended for GA)

AAS ships `Takeoff`, `Land`, `Orbit`, `Offboard` actions (`autopilot_interface_msgs`).
We keep those and add the GA-specific layer (`afcs_msgs`):

| Action | Semantics |
|---|---|
| `AutoTakeoff` | Line up, power, rotate at Vr, climb at Vy, gear/flaps schedule, abort logic |
| `LandAt` | Full auto-land at named airport/runway: wind check, pattern entry, final, flare, rollout, brakes |
| `Divert` | Nearest suitable airport given fuel/wind/runway-length/suitability constraints |
| `Hold`, `Goto`, `ChangeAlt`, `ChangeHdg` | Enroute primitives |
| `VoiceCommand` | One intent slot the human interface fills; executive validates + confirms |
| `Abort` / `GoAround` | Always preemptible, always available, instant |

Every action reports **feedback** (phase, distance-to-go, ETA, energy state) — that
feedback stream is what `glasswing_bridge` republishes to NetFIX, so the panel and HUD
show "what is the airplane doing and why" in real time. **Explainability is a safety
feature.**

## 4. The executive and the override arbiter

`afcs_executive` is a deterministic state machine (no ML in this loop):

```
DISCONNECTED → PREFLIGHT → READY → AUTO_ENGAGED ⇄ MANUAL
                      │              │
                      │              ├── PIC override (switch/stick/throttle) → MANUAL
                      │              ├── lost-link / geofence / low-fuel → FAILSAFE
                      │              └── perception disagree → DEGRADED (advise PIC)
```

Rules (details in `SAFETY.md`):
1. Physical guarded AFCS switch + control-input detection beats everything, in hardware
   where possible (ArduPilot `RC_OVERRIDE`/mode change at the FC level, not in ROS2).
2. Autonomy *requests* modes; the FC *owns* them. ArduPilot Plane's own AUTO/RTL/fence
   logic is the last safety net and is never bypassed.
3. Any single computer/Jetson/bridge failure degrades to: ArduPilot flies the last
   safe mode (RTL/fence), panel + HUD keep working off the FC's own MAVLink. The
   airplane must never depend on the Jetson to stay controllable.

## 5. Mission brain — the "pilot skills" library

`afcs_mission` (behavior trees, following AAS's `mission/` package pattern):

- **Airport database**: CIFP/ARINC-424 (already vendored in Glasswing `vendor/makerplane/
  repos/faa-cifp-data`) + OurAirports fallback → nearest-suitable-airport query with
  runway length/surface/wind-alignment scoring.
- **Wind model**: FC-reported wind + GPS-vs-airspeed triangle → pattern-side selection,
  crab angle, stabilized approach gate (e.g. "on final, 500 ft AGL, ±5 kt, on glideslope"
  else auto go-around).
- **Auto takeoff/landing**: ArduPilot Plane already has proven `TKOFF`/`LAND` mission
  items and autoland — we *orchestrate and supervise* them (wind check, runway
  alignment via perception, abort gates) rather than re-implementing control laws.
  Principle: **stand on ArduPilot's 15 years of flight-proven code; add judgment,
  not new PID loops.**
- **Obstacle/traffic avoidance**: perception detections → local replan (climb/turn
  command within envelope limits), ADS-B traffic via GDL90 → traffic advisories on HUD.
- **Terrain**: SRTM tile database for terrain-awareness warnings (TAWS-lite).

## 6. Perception (AAS stack, GA-tuned)

- Camera: IMX219-class CSI cam in sim (GStreamer UDP from Gazebo `gz_gst_bridge`) and
  on Jetson (CSI + DeepStream) — **identical pipeline both sides**.
- YOLO nano via ONNX Runtime: CUDA in sim, TensorRT FP16 on Jetson. Custom GA dataset:
  runways, aircraft, vehicles-on-runway, birds. This is where academia plugs in.
- LiDAR (optional): Livox Mid-360 + KISS-ICP → GNSS-denied odometry + obstacle volume.
- All models swappable via `config/perception.yaml`.

## 7. Human interface — "occasional voice prompts"

`afcs_human_interface`:
- Wake word ("Glasswing") → on-device ASR (whisper.cpp on Jetson; pluggable) →
  intent grammar (small, aviation-shaped: *divert, land at, climb to, hold, resume,
  go around, say intentions*).
- **Readback protocol (non-negotiable):** every command is read back and executed only
  on confirm, shown simultaneously on panel + HUD FMA. Voice is an *input*, never a
  black box.
- The same intents arrive from touchscreen buttons and text — one code path
  (`VoiceCommand` action), three front-ends.
- "Say intentions": the system speaks its current plan in plain pilot language.

## 8. The data contract with Tracks 1 & 2

New NetFIX keys (published by `glasswing_bridge`, consumed by panel + HUD):

```
AFCS_MODE      e.g. "MANUAL|ARMED|AUTO_TAKEOFF|ENROUTE|APPROACH|AUTOLAND|GO_AROUND"
AFCS_TARGET    free text: "KSQL RWY 30" / "KPAO" — current objective
AFCS_PHASE     action feedback phase string
AFCS_DTG_NM    distance-to-go
AFCS_ETA_S     seconds to target
AFCS_WIND      "270@12G18"
AFCS_ADVISORY  latest plain-language advisory ("Traffic 2 o'clock, 1 mile, same altitude")
TRAFFIC_*      bearing/dist/rel-alt of nearest ADS-B/perception traffic
```

Panel renders these as a proper **FMA strip** (like an Airbus/Boeing mode annunciator);
HUD renders them conformally. One source of truth → no possibility of panel and HUD
disagreeing about what the autopilot is doing.

## 9. Sim → real pipeline (full loop)

```
code ──▶ CI: FTRT mission suite (takeoff, crosswind land, engine-out divert,
         traffic conflict, lost-link) on Gazebo + ArduPilot SITL, >20× realtime
   ──▶ HITL: same aircraft-image on a bench Jetson, simulated sensors over Ethernet
   ──▶ subscale: RC-scale test aircraft (ArduPilot quadplane) with real Jetson+cam
   ──▶ E-AB: pilot-aboard supervised autonomy, authority expanded phase by phase
```

Gates between phases are defined in `ROADMAP.md`; each gate requires the full CI suite
green plus N logged hours at the previous phase. Details in `SIM2REAL.md`.

## 10. What we deliberately do NOT build (v1)

- IFR/IMC autonomy — VFR-day envelope only (matches Glasswing's safety posture).
- Certified anything. Experimental market, explicitly.
- New flight-control laws — ArduPilot's are flight-proven; we add judgment on top.
- A custom GCS — QGroundControl exists; Glasswing panel is the in-cockpit GCS.
