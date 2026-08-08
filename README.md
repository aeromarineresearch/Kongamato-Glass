# Kongamato

*Named after the legendary creature said to rule the skies — because everyone has a
right to the sky.*

### ▶ [Live demo — the Glasswing glass cockpit](https://aeromarineresearch.github.io/Kongamato-Glass/)

A running G3X-style EFIS (PFD, moving map, engine strip) flying a synthetic demo
flight — **right in your browser, no install, no hardware, no login.**

**Kongamato is an open-source, full-stack avionics platform for experimental aviation:**
a glass cockpit, an AR smart-glasses HUD, and a full autopilot — auto takeoff,
auto land, nearest-airport diversion, wind-aware patterns, traffic and obstacle
awareness — commanded by simple voice or text, supervised from the panel or the HUD,
and **overridable by the Pilot in Command at all times**.

The goal: give homebuilders, STEM students, researchers, designers, and dreamers real,
affordable tools that were once reserved for big corporations and countries. Feature-rich
enough for academia and professionals — simple enough that a novice runs one command
and talks to the airplane. The heavy tech stays out of sight.

> ⚠️ **Experimental / E-AB use only.** Not certified avionics, not TSO'd, never a
> primary flight instrument. VFR-day. The certified panel remains the legal source of
> flight data, and the PIC is always the final authority. See
> [`Super AFCS AutoPilot/docs/SAFETY.md`](Super%20AFCS%20AutoPilot/docs/SAFETY.md).

---

## The three tracks

| Track | Directory | What it is |
|---|---|---|
| **1 — Glass Cockpit** | [`Project Glasswing/`](Project%20Glasswing/) | **[▶ Live demo](https://aeromarineresearch.github.io/Kongamato-Glass/).** Full EFIS (PFD, moving map, engine page) from open hardware: Raspberry Pi 5 + SpeedyBee/ArduPilot sensors + CAN-FIX engine nodes, built on the MakerPlane ecosystem (FIX-Gateway, pyEfis). Target BOM < $600 vs $5–15k for Dynon/Garmin — plus Chronos-2 predictive engine analytics the big guys don't ship. |
| **2 — AR HUD** | [`AR XR HUD Avionics/`](AR%20XR%20HUD%20Avionics/) | See-through smart-glasses HUD (Android/Kotlin): attitude, airspeed, altitude, heading — heads-up, eyes-out. An auxiliary mirror of the same data bus; if it dies, you lose nothing. |
| **3 — Super AFCS** | [`Super AFCS AutoPilot/`](Super%20AFCS%20AutoPilot/) | The autonomy brain. Full pilot-grade mission capability commanded by voice ("Glasswing, divert to the nearest airport"), with readback-and-confirm, five independent PIC override paths, and a shadow-mode trust ladder. |

**One integration contract** — FIX-Gateway is the data bus (NetFIX), MAVLink is the
control path, ROS2 actions are the autonomy API. Panel, HUD, and autopilot can never
disagree about what the airplane is doing, because they all read the same bus.

## Closing the simulation-to-reality gap

Principles adapted from NRC Canada's
[`aerial-autonomy-stack`](https://github.com/JacopoPan/aerial-autonomy-stack)
(ICUAS 2026, [arXiv:2602.07264](https://arxiv.org/abs/2602.07264)):

- **Code parity** — one Docker image for the autonomy stack runs in simulation
  (amd64, Gazebo + ArduPilot SITL) and on the aircraft (arm64, NVIDIA Jetson).
  Sim↔real differences are config, never code.
- **Faster-than-real-time CI** — the mission suite (crosswind autoland, engine-out
  divert, runway incursion, lost link, autonomy-computer-killed-mid-flight) flies in
  Gazebo on every pull request.
- **An evidence ladder, not vibes** — SITL → FTRT-CI → Jetson hardware-in-the-loop →
  subscale flight test → shadow mode aboard → phased authority. Each gate has hard
  exit criteria.
- **Standing on giants** — ArduPilot's 15+ years of flight-proven control laws do the
  flying; Kongamato adds judgment, perception, and the human interface.

## Quickstart (zero hardware)

```bash
git clone https://github.com/aeromarineresearch/Kongamato-Glass.git
cd Kongamato-Glass/Super\ AFCS\ AutoPilot
./scripts/afcs sim      # Gazebo + ArduPilot SITL + autonomy + glass cockpit + HUD bridge
./scripts/afcs test     # fly the CI mission suite faster-than-real-time
```

Then say: *"Glasswing, take me to the nearest airport."*

## Architecture at a glance

```
 VOICE / TEXT / TOUCH ──▶ human_interface ──▶ mission brain ──▶ executive ──▶ autopilot interface
                          (intent + readback)   (divert, wind,    (mode logic,  (ROS2 actions →
                                                 patterns,        PIC override  ArduPilot/PX4)
                                                 perception)      arbiter)
                                                        │
                          perception (YOLO runway/traffic detect, LiDAR odometry, ADS-B)
                                                        │
                     MAVLink (control) ◀──── FC ────▶ FIX-Gateway (data bus, NetFIX :3490)
                                                        │
              ┌───────────────────────┬─────────────────┴───┬────────────────┐
              ▼                       ▼                     ▼                ▼
        Glass cockpit           AR glasses HUD        Web UI (dev)     QGroundControl
        (pyEfis + FMA strip)    (conformal FMA,                          (supervision)
                                 traffic chevrons)
```

## What's inside

- **Docs first** — start with [`SESSION-STATE.md`](SESSION-STATE.md) (project status &
  handoff), then `Super AFCS AutoPilot/docs/`: ARCHITECTURE · SAFETY · SIM2REAL ·
  INTEGRATION · ROADMAP
- **Working code** — NetFIX↔ROS2 bridge, nearest-suitable-airport engine, voice intent
  grammar, ROS2 action definitions (`AutoTakeoff`, `LandAt`, `Divert`, `VoiceCommand`),
  pyEfis FMA strip, AR HUD renderer spec, multi-arch Dockerfiles, CI
- **Open data** — FAA CIFP/ARINC-424 + OurAirports for navigation and airport databases

## Contributing

Open source first, always (MIT — see `Super AFCS AutoPilot/LICENSE`). Whether you're an
aerospace engineer, an RC pilot, a designer, or a student who's never touched an
airplane: there's a lane for you, from Gazebo worlds and YOLO datasets to PCB design
and voice grammars. Read `SESSION-STATE.md` for the current next-actions list.

*Dream and design. Everyone has a right to the sky.*
