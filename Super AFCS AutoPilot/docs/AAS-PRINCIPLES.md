# Principles inherited from aerial-autonomy-stack (AAS)

Source: [JacopoPan/aerial-autonomy-stack](https://github.com/JacopoPan/aerial-autonomy-stack) —
*"aerial-autonomy-stack — a Faster-than-real-time, Autopilot-agnostic, ROS2 Framework to
Simulate and Deploy Perception-based Drones"*, Panerati et al., ICUAS 2026, arXiv:2602.07264
(NRC Canada). MIT-licensed. We adopt its systems principles; we do **not** fork the repo
(it's drone/VTOL-focused); we re-implement the pattern for GA fixed-wing.

## The paper's argument (why this matters to us)

The sim2real gap is mostly a **system-engineering gap**, not an aerodynamics gap:
failures happen at the *interfaces* between simulator, middleware, autopilot, ML
runtime, and edge hardware. The fix is vertical, end-to-end integration with one
codebase that runs in both worlds.

## Principle → how Super AFCS applies it

| AAS principle | Super AFCS application |
|---|---|
| **Simplicity** ("no fat software") | Few moving parts: ROS2 + MAVROS + Gazebo + FIX-Gateway + ONNX. No custom middleware, no custom GCS, no new control laws. |
| **おまかせ end-to-endness** | One `afcs` command brings up the whole stack; one Dockerfile per target; CI flies real missions end-to-end. |
| **Recentness** | ROS2 Jazzy, Gazebo Harmonic, ArduPilot stable, current ONNX Runtime/TensorRT. Pin versions, upgrade deliberately. |
| **Deployment focus: 3 dockerized images** | Same split: `simulation` / `aircraft` / `ground`. Aircraft image is multi-arch (amd64 sim, arm64 Jetson) from ONE Dockerfile. |
| **Autopilot-agnostic ROS2 action interface** | `autopilot_interface` actions (`Takeoff/Land/Orbit/Offboard` pattern) + our GA layer (`LandAt/Divert/...`). Autonomy never touches MAVLink. |
| **GStreamer camera pipeline identical sim↔real** | Sim: Gazebo camera → gz_gst_bridge UDP → YOLO. Real: CSI cam → DeepStream → same YOLO node. Same bytes, same code. |
| **Dual network SIM_SUBNET / AIR_SUBNET** | Kept: sensor-side UDP vs inter-system TCP/Zenoh — network topology is tested from day one, not discovered in the field. |
| **Zenoh ROS2 bridging over lossy links** | Air↔ground and aircraft↔cockpit-displays bridge. |
| **Faster-than-real-time, pauseable sim + Gymnasium** | FTRT CI (>20×) flies the mission suite per PR; `aas_gym`-style steppable env for RL/planner research later. |
| **HITL with real edge compute before flight** | Bench Jetson-in-the-loop gate before subscale flight; phase gates in `SAFETY.md` §6. |
| **Multi-target inference (CUDA sim / TensorRT FP16 edge)** | Same ONNX model, two execution providers. |
| **Logs: flight_review, MAVExplorer, PlotJuggler** | Adopted as-is, plus Glasswing's Chronos-2 trend pipeline on top. |

## Where we deliberately diverge from AAS

- **Fixed-wing GA, not multirotor/VTOL swarm** — single vehicle, deep pilot-function
  coverage (auto TO/LD, diversion, wind-aware patterns) instead of multi-drone swarming.
- **FIX-Gateway/NetFIX data bus** — AAS has no cockpit display bus; Glasswing does.
- **Human-in-the-loop voice/touch interface + PIC override** — AAS assumes an operator
  with QGC; we assume a pilot in the seat with a guarded switch.
- **ArduPilot-first** (GA fixed-wing maturity, SpeedyBee/Pixhawk hardware already in
  Glasswing BOM); PX4 supported through the same action interface, second priority.
