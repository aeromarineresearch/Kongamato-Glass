# Super AFCS — Open Full-Stack Autonomy for Experimental Aviation

*A plug-and-play Automatic Flight Control System that thinks like a pilot, flies like a
machine, and answers to the human in the left seat — always.*

**Track 3 of Project Glasswing** · Open source (MIT) · Experimental/E-AB use only — **not certified avionics**

---

## The one-paragraph vision

Super AFCS is the autonomy brain that sits on top of the Glasswing avionics stack
(Track 1: glass cockpit EFIS) and the AR HUD (Track 2: see-through smart-glasses HUD).
It gives any experimental aircraft a full pilot-grade capability set — **auto takeoff,
enroute navigation, wind-aware pattern entry, auto land, nearest-airport diversion,
traffic/obstacle detection and avoidance, and predictive system monitoring** — commanded
by simple voice or text ("Glasswing, take me to the nearest airport"), supervised through
the panel *and* the HUD, and **overridable instantly by the Pilot in Command at all times**.

Everything is designed in simulation first, flown thousands of times faster-than-real-time
in CI, and deployed to the aircraft with **zero code changes** — the same container image
that runs against Gazebo runs on the onboard Jetson.

## Design philosophy (Apple principle for aviation)

- **The heavy tech stays out of sight.** A novice runs `./afcs up` and talks to the
  airplane. An academic can swap the planner, the perception model, or the autopilot
  backend by editing one YAML and one Python module. Same stack.
- **Open source first, always.** MIT license. Every dependency is open (ArduPilot, ROS2,
  Gazebo, FIX-Gateway, Ultralytics, KISS-ICP). Where something isn't open, we build our own.
- **The PIC is the final authority.** A physical guarded switch and stick/throttle
  motion always wins over the autonomy. See `docs/SAFETY.md`.
- **Everyone has a right to the sky.** Target audience: E-AB builders, STEM students,
  industrial designers, researchers. BOM in the hundreds, not tens of thousands.

## Architecture at a glance

```
 HUMAN          "Glasswing, divert to nearest airport"  (voice / text / touch)
   │
   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ AIRCRAFT CONTAINER  (same image in sim and on the Jetson — AAS principle)│
│                                                                          │
│  human_interface ──▶ mission ──▶ afcs_executive ──▶ autopilot_interface  │
│  (voice/text→intent)  (BT plans,  (state machine,   (ROS2 actions →      │
│                        nearest-    mode logic,       ArduPilot/PX4       │
│                        airport,    PIC-override      via MAVROS/DDS)     │
│                        wind,       arbiter)                              │
│                        patterns)         │                               │
│  perception (YOLO detect, LiDAR KISS-ICP, obstacle/traffic avoidance)    │
│         │                                                                │
│         ▼                                                                │
│  glasswing_bridge  ◀── NetFIX tcp:3490 ──▶ FIX-Gateway (data bus)        │
└──────────────────────────────────────────┬───────────────────────────────┘
                                           │ same bytes in sim & flight
              ┌────────────────────────────┼─────────────────────────────┐
              ▼                            ▼                             ▼
     Track 1: pyEfis panel      Track 2: AR HUD glasses        QGroundControl
     (FMA strip, map, EMS)      (conformal symbology,          (operator
                                mode annunciations)            supervision)
```

Ground truth and principles adapted from
[`JacopoPan/aerial-autonomy-stack`](https://github.com/JacopoPan/aerial-autonomy-stack)
(ICUAS 2026, arXiv:2602.07264) — see `docs/AAS-PRINCIPLES.md`.

## Quickstart (zero hardware)

```bash
./afcs sim          # Gazebo + ArduPilot Plane SITL + full autonomy + Glasswing EFIS + HUD bridge
./afcs test         # fly the full CI mission suite faster-than-real-time
./afcs up           # on the aircraft: same containers, real serial links
```

## Repo layout

| Path | What |
|---|---|
| `docs/` | Architecture, safety case, sim2real method, AAS principle mapping, roadmap |
| `autonomy_ws/` | ROS2 workspace: messages, executive, mission, perception, human interface, bridge |
| `simulation/` | Gazebo worlds, GA aircraft models (Cessna-class), SITL launch |
| `docker/` | The three images: `simulation`, `aircraft`, `ground` (+ compose) |
| `scripts/` | `afcs` CLI — the one command users ever learn |
| `config/` | Aircraft profiles, voice grammar, airport database seed |
| `tests/` | Faster-than-real-time CI mission suite |
| `.github/workflows/` | CI that flies the airplane on every PR |

## The three tracks, synced

| | Track 1 | Track 2 | Track 3 (this repo) |
|---|---|---|---|
| Project | Glass cockpit EFIS | AR glasses HUD | **Super AFCS autonomy** |
| Dir | `Project Glasswing/` | `AR XR HUD Avionics/` | `Super AFCS AutoPilot/` |
| Role | Eyes-down glass | Eyes-out glass | The brain |
| Talks via | NetFIX :3490 | NetFIX :3490 | MAVLink (commands) + NetFIX (annunciation) |

The single integration contract: **FIX-Gateway is the data bus; MAVLink is the control
path; the same ROS2 action interface fronts every autopilot.** See `docs/INTEGRATION.md`.
