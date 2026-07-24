# Project Glasswing — Master Integration Plan
*Open, affordable, sleek EFIS for the sport/hobby pilot — "glass cockpit + AI flight engineer for the price of a radio"*

Working dir: `~/DEV/Aviation` · Compiled 2026-07-18 · Status: **architecture validated, zero code written yet**

---

## 1. The one-paragraph vision

A full glass cockpit (PFD + moving map + engine page + waypoint nav) built from proven open
source — **MakerPlane** (displays, data broker, CAN-FIX sensor bus, FAA nav data), **ArduPilot
on a SpeedyBee FC** (flight-dynamics sensors: attitude, GPS, baro, airspeed), **custom CAN-FIX
PCB sensor nodes** (engine monitoring), and a **Chronos-2 advisory engine** (predictive
analytics the big guys don't ship). Target BOM: **< $600** vs $5k–$15k for Dynon/Garmin G3X.

---

## 2. How the three research threads converge

| Thread (your research) | What it gives the product | What it does NOT do (and who covers it) |
|---|---|---|
| **MakerPlane** (`vendor/makerplane`, see DIGEST.md) | pyEfis PFD screens (YAML-configured), pyAvMap moving map (FAA sectionals), FIX-Gateway data broker, CAN-FIX bus spec + Arduino libs, CIFP/ARINC-424 nav database | No flight sensors of its own; no flight-plan sequencer; dated UI aesthetics |
| **SpeedyBee + ArduPilot** (`ArduPilot-SpeedyBee/`) | AHRS-grade PITCH/ROLL/YAW, GPS position, baro altitude, pitot airspeed, VIBE — from a **$60–120 board** running flight-proven EKF sensor fusion | It's a drone FC — needs an air data + attitude *source* role only; NOT the display, NOT the pilot interface |
| **Chronos-2 engine** (`DIY ... Chronos-2/`, `chronos2-starter/`) | The differentiator: predictive telemetry analytics, anomaly flagging vs forecast quantile band — "AI flight engineer" | Not real-time, not onboard-critical (advisory only — per your own §4 safety analysis) |

**The convergence trick:** FIX-Gateway already ships a **`mavlink` plugin** that maps ArduPilot
telemetry straight into EFIS database keys — verified in source:
`VFR_HUD → IAS/GS/TAS/ALT`, `ATTITUDE → PITCH/ROLL/YAW + ROT`, `GPS_RAW_INT → LAT/LONG/COURSE/fix`,
accel → `ALAT/ALONG/ANORM` (`vendor/makerplane/repos/FIX-Gateway/src/fixgw/plugins/mavlink/Mav.py`).

→ **The SpeedyBee becomes the EFIS's "AHRS + ADC + GPS" module with zero new code.**

---

## 3. Product architecture (the full stack)

```
┌──────────────────────── AIRCRAFT ────────────────────────────────────────┐
│                                                                          │
│  SENSING TIER                                                            │
│  ┌──────────────────────┐      ┌────────────────────────────────────┐    │
│  │ SpeedyBee F405 WING   │      │ Custom CAN-FIX PCB nodes (ours)    │    │
│  │ (ArduPilot) = AHRS    │      │  • EIS node: EGT×6 CHT×6 RPM      │    │
│  │  • IMU→PITCH/ROLL/YAW │      │    fuel flow, oil P/T, MAP        │    │
│  │  • GPS→LAT/LONG/GS    │      │    (EIS-R1 firmware as template)  │    │
│  │  • baro→ALT, pitot→IAS│      │  • later: fuel level, trim/flap   │    │
│  │  • VIBE vibration     │      │    position, AoA vane, door/gear  │    │
│  └──────────┬────────────┘      └───────────────┬────────────────────┘    │
│             │ MAVLink2 (UART, 921600)           │ CAN-FIX (CAN 2.0B)      │
│             ▼                                   ▼                         │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │ COMPUTE TIER — Raspberry Pi 5 (8GB) + custom HAT PCB             │    │
│  │  FIX-Gateway:  mavlink plugin ◀── SpeedyBee                      │    │
│  │                canfix plugin  ◀── sensor PCBs (MCP2515/TWAI HAT) │    │
│  │                compute plugin (TAS, density alt, fuel remaining) │    │
│  │                netfix plugin  ──▶ secondary displays / tablets   │    │
│  │  Advisory engine (Python): light anomaly model (IsolationForest/ │    │
│  │   autoencoder) reading NetFIX; alerts → annunciate plugin        │    │
│  │  Nav engine (to be written): CIFP waypoints, Direct-To, legs,    │    │
│  │   XTE sequencing → publishes NAV keys to FIX db                  │    │
│  └──────────┬───────────────────────────────────────────────────────┘    │
│             │ local Qt                                                   │
│             ▼                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │ DISPLAY TIER — 7–10" sunlight-readable touchscreen               │    │
│  │  pyEfis (custom sleek theme): PFD screen (AI+VirtualVfr, ASI,   │    │
│  │  ALT, VSI, HSI) / EMS screen (engine gauges) / MAP screen       │    │
│  │  (pyAvMap sectionals + waypoint overlay) — swipe or bezel btn   │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
                 │ WiFi (post-flight / in-flight advisory)
                 ▼
┌──────── GROUND TIER — Mac (or cloud) ────────────────────────────────────┐
│  Chronos-2 forecasting on flight logs (chronos2-starter pipeline)        │
│  Streamlit dashboard: actual-vs-predicted, engine trend monitoring,      │
│  "your CHT#3 is drifting 0.4σ/hotter per 10h" — predictive maintenance   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Why this beats the big guys' architecture (for our market)
- **Dynon/Garmin:** proprietary everything, $5–15k, locked ecosystem.
- **Ours:** every layer is replaceable; a homebuilder can start with just PFD (Pi + SpeedyBee +
  screen ≈ $350) and add engine PCBs later. CAN-FIX is an *open* bus — third parties can join.
- **The moat:** Chronos-2 predictive analytics + sleek modern UI (the two things MakerPlane
  lacks and the big guys overcharge for).

---

## 4. Build order (validated against all three research docs)

| # | Milestone | Hardware needed | Proves |
|---|---|---|---|
| 0 | **SITL end-to-end**: ArduPilot SITL (`sim-copter -v ArduPlane`) → FIX-Gateway mavlink plugin → pyEfis PFD on this Mac | none | The entire data path works before spending a dollar |
| 1 | Fly SITL mission → capture `.bin` log → run `chronos2-starter/parse_log.py` + `forecast.py` | none | Advisory pipeline (your §7 steps 1–3 — still pending; QGC Telemetry/ is empty) |
| 2 | Custom pyEfis screen theme ("sleek" UI pass) | none | Product look & feel |
| 3 | SpeedyBee F405 WING on bench → Pi 5 over UART → FIX-Gateway → pyEfis | FC + Pi ≈ $150 | Real sensors feeding real EFIS |
| 4 | First custom PCB: EIS engine node (ESP32 or ATmega + MCP2515, CAN-FIX) — prototype on dev boards first, spin PCB after | ≈ $50 proto | Custom hardware joins the bus |
| 5 | Nav engine plugin: CIFP waypoints + Direct-To + XTE on pyAvMap | none | Waypoint navigation story complete |
| 6 | Enclosure + touchscreen + Pi HAT PCB (CAN transceiver, power, RTC) → integrated unit | ≈ $120 | First "product-shaped" prototype |
| 7 | Chronos-2 ground dashboard GA; light onboard anomaly model on Pi | none | The differentiator ships |

---

## 5. Custom PCB plan (the hardware we'll design)

| PCB | MCU | Talks via | Reads | Template |
|---|---|---|---|---|
| **EIS-1 engine node** | ESP32 (native TWAI CAN) + SN65HVD230 transceiver | CAN-FIX | 6×EGT + 6×CHT (MAX31855 SPI), RPM (2 tach inputs), fuel flow (pulse), oil P/T, MAP (analog) | MakerPlane `EIS-R1` firmware + `CAN-FIX-ArduinoLib` |
| **Pi HAT** | — (Pi carrier) | MCP2515+2551 CAN, 5V/5A buck from 12/28V bus, TVS protection, RTC | joins CAN-FIX bus; clean power | FIX-Gateway canfix plugin (SocketCAN) |
| *(later)* **AUX-1** | ESP32 | CAN-FIX | fuel level (resistive/cap), flap/trim position, AoA vane | same firmware skeleton |
| *(option)* **AHRS-2 redundant** | ESP32 + BNO055 + BMP390 | CAN-FIX | backup attitude/altitude | `rpi_bno055`/`rpi_bmp085` plugin key names |

ESP32 confirmed as the node MCU (native CAN = fewer parts than Mega+MCP2515; CAN-FIX Arduino
lib API ports cleanly — only the low-level `writeFrame` needs a TWAI shim).

---

## 6. Positioning vs the incumbents

| | Dynon SkyView | Garmin G3X | **Glasswing** |
|---|---|---|---|
| Entry PFD price | ~$3–5k | ~$5k+ | **~$350** (Pi+screen+SpeedyBee) |
| Engine monitoring | +$1–2k probes/box | +$2k | **+$100** (our EIS PCB) |
| Moving map + plates | subscription | subscription | **free** (FAA open data, CIFP) |
| Predictive analytics | ✗ | ✗ (Garmin *PlaneSync* is fleet telemetry, not predictive) | **✓ Chronos-2 engine trends** |
| Open ecosystem | ✗ | ✗ | ✓ CAN-FIX + NetFIX + MAVLink all open |
| Repair/replace cost | send-in | send-in | swap a $60 board |

Honest risks to manage: (1) **not certified** — E-AB and LSA/ultralight market only, and even
there we say "VFR-day advisory, keep your steam gauges/legal minimums"; (2) ArduPilot's attitude
solution is drone-grade — good, but we should cross-check against a second source before claiming
IFR-anything; (3) sunlight-readable display is the hardest single BOM item to source cheaply.

---

## 7. File map

**`~/DEV/Aviation/Project Glasswing/`** — EVERYTHING project-related lives here:
- `MASTER-PLAN.md` — this doc (load first in future sessions)
- `milestone0/` — zero-hardware SITL→FIX-Gateway→pyEfis launcher (`run-glasswing-sim.sh`, README)
- `config/fixgw/` + `config/pyefis/` — runtime configs (migrated from `~/makerplane`;
  apps run with `--config-file` so nothing writes outside the project)
- `patches/0001-mavlink-network-links.patch` — UDP/TCP + macOS-deps fixes for FIX-Gateway (applied in vendor tree; upstream PR candidate)
- `patches/0002-weston-graceful-degradation.patch` — Weston no-crash fix for pyEfis (same)
- `research/ArduPilot-SpeedyBee/` — SITL/QGC/SpeedyBee setup guide
- `research/DIY Open-Source Aviation Telemetry Engine with Chronos-2/` — Chronos-2 spec + `chronos2-starter/` code (parse_log.py, forecast.py)
- `vendor/makerplane/DIGEST.md` — full MakerPlane ecosystem digest
- `vendor/makerplane/repos/` — all 11 MakerPlane repos (pyEfis, FIX-Gateway, pyAvMap, pyAvTools, canfix-spec, CAN-FIX-ArduinoLib, CAN-ArduinoLib, EIS-R1, EFIS-Hardware-7-inch, faa-cifp-data, Documentation)

**Track 2 — auxiliary AR HUD:** lives in `~/DEV/Aviation/AR XR HUD Avionics/AR_HUD_AVIONICS.md`.
Android/Kotlin see-through-glasses HUD that mirrors the primary glass. It is a **NetFIX client
of FIX-Gateway (tcp:3490)** — same protocol + key set as `glasswing-ui/server.py:NetfixSource`
(`@sKEY` subscribe, `KEY;value` lines). Do NOT give the HUD its own sim/GDL90 data path as
primary; its dev path is milestone0's SITL→FIX-Gateway and the flight path is the SpeedyBee —
identical to Track 1. (Stratux GDL90 retained there as backup/independent attitude cross-check
only, per §6 risk #2.)

**Track 3 — Super AFCS autonomy:** lives in `~/DEV/Aviation/Super AFCS AutoPilot/`
(read its `README.md` + `docs/ARCHITECTURE.md` after this doc). The full-stack
autopilot: auto takeoff/land, nearest-airport diversion, wind-aware patterns,
perception, voice/text commands — ROS2 + ArduPilot, Dockerized with sim/real code
parity (principles adapted from JacopoPan/aerial-autonomy-stack, arXiv:2602.07264).
**Data contract:** AFCS controls the aircraft via MAVLink (through a ROS2 action
interface, never directly), and annunciates via FIX-Gateway using the `AFCS_*` /
`TRAFFIC_*` NetFIX keys defined in `Super AFCS AutoPilot/docs/INTEGRATION.md` — the
panel must render these as an FMA strip (see below). The FC's own MAVLink feed stays
the primary flight-data source, so the panel keeps working if the autonomy computer
dies (AFCS safety architecture, `docs/SAFETY.md`).

**Left outside on purpose:**
- `~/ardupilot` — SITL tool install (on PATH via ~/.zshrc, huge, its own git repo — a tool, not project files)
- `~/DEV/Aviation/QGroundControl/` — QGroundControl app's own data dirs (QGC owns/recreates these; currently empty — milestone 1's logs land here or in `~/ardupilot/logs`)

## 8. Next actions (pick one and we go)
0. **Track-3 sync** — add the FMA strip (`AFCS_MODE/PHASE/TARGET` NetFIX keys) to the
   pyEfis PFD screen YAML + a big red `AFCS_CMD=DISENGAGE` button (contract:
   `Super AFCS AutoPilot/docs/INTEGRATION.md`)
1. **Milestone 0** — wire SITL → FIX-Gateway → pyEfis on this Mac (all software, ~1 session)
2. Spec the **EIS-1 engine PCB** (schematic: ESP32 + MAX31855×6 + tach conditioning + CAN)
3. **Sleek UI** mockup pass on pyEfis (custom Qt theme + screen YAML)
4. Create the **GitHub repo** (your Chronos-2 doc flagged this as overdue) — init `glasswing-avionics` with this plan + starter code
