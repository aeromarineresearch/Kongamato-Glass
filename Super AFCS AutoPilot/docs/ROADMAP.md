# Super AFCS — Roadmap

| # | Milestone | Hardware | Proves |
|---|---|---|---|
| A0 | Repo scaffold: 3 Dockerfiles, `afcs` CLI, SITL bring-up (Gazebo + ArduPilot Plane SITL + MAVROS + FIX-Gateway + glasswing_bridge), hello-world `AutoTakeoff` action in sim | none | Skeleton end-to-end |
| A1 | FMA strip in pyEfis + HUD FMA line; `AFCS_*` keys flowing; shadow-mode intent ticker | none | Track 1/2/3 sync |
| A2 | Mission brain v1: airport DB (CIFP+OurAirports), nearest-airport divert, wind-aware pattern entry, ArduPilot autoland orchestration in sim | none | "Take me to KSQL" works in sim |
| A3 | Perception v1: GStreamer pipeline + YOLO runway/traffic detect in sim; runway-incursion abort; ADS-B traffic from GDL90 | none | Eyes in the loop |
| A4 | Voice interface: whisper.cpp wake-word + grammar + readback/confirm; "say intentions" | none | The wow demo |
| A5 | FTRT CI suite + fault injection nightly (SIM2REAL P0–P1) | none | Trustworthy releases |
| A6 | HITL bench: arm64 image on Jetson Orin, real serial to SpeedyBee/Pixhawk | Jetson ≈ $500 | P2 gate |
| A7 | Subscale quadplane flight test campaign | ≈ $1.5k airframe | P3 gate |
| A8 | E-AB install, shadow mode → authority ladder | aircraft | The dream, responsibly |

Parallel Glasswing tracks continue per `Project Glasswing/MASTER-PLAN.md` (milestones
0–7); AFCS milestones assume Glasswing M0 (SITL→FIX-Gateway→pyEfis) as the dev bus.

First PRs (good-first-issue shaped):
1. `docker/` three images + compose (A0)
2. `afcs_msgs` action definitions (A0)
3. `glasswing_bridge` NetFIX↔ROS2 node (A0/A1)
4. Airport DB loader + nearest-suitable query (A2)
5. pyEfis FMA strip YAML + HUD FMA line (A1)
