# Sim2Real Method — Super AFCS

Adapted from AAS §IV–V (arXiv:2602.07264). The promise we make to users:
**"design in sim, test in sim, deploy to the real world — and it just works."**
This doc is how we keep that promise honest.

## 1. The code-parity rule

- One `aircraft.Dockerfile`, `TARGETARCH=amd64|arm64`. CI builds both on every PR.
- Identical ROS2 launch files in sim and deployment; only `config/env/*.yaml` differs
  (serial device vs SITL UDP, CSI camera vs GStreamer-from-Gazebo, ONNX provider
  TensorRT vs CUDA).
- **Forbidden:** any `#ifdef SIM`, any code path that exists only on one side.
  Environment differences are *data*, never *code*.

## 2. The evidence ladder (gates, not vibes)

| Phase | Environment | Gate to exit |
|---|---|---|
| P0 SITL | Gazebo + ArduPilot SITL, full stack, dev laptop | CI mission suite green 50× consecutive, incl. fault injection |
| P1 FTRT-CI | Same, >20× realtime, headless | Nightly 500 randomized missions (wind/traffic/failures), ≥99% safe outcomes |
| P2 HITL | Bench Jetson running the arm64 image, simulated sensors over Ethernet, real serial to FC | Full suite + 24h soak, zero unexplained behavior |
| P3 Subscale | RC-scale ArduPilot quadplane + Jetson + camera, pilot with RC override | 20 logged flights, every override event root-caused |
| P4 E-AB shadow | Installed, pilot aboard, AFCS shadow-mode (advises, doesn't act) | 25 h shadow, intent-accuracy reviewed |
| P5 E-AB active | Authority ladder per `SAFETY.md` §4 | Phase-by-phase sign-off, pilot-logged consent |

Rollback rule: any phase may be re-entered at any time; the config makes it a
one-line change.

## 3. Fault injection (the CI suite must include)

- GPS degradation/loss mid-approach → KISS-ICP/dead-reckoning advisory path
- Crosswind gusts (Gazebo wind plugin) at autoland limits → go-around
- Runway incursion (spawn obstacle on final) → perception abort
- Traffic conflict (ADS-B or camera) → avoidance + advisory
- Lost ground link, lost FIX-Gateway, killed Jetson container (literally `docker kill`
  in test) → each must produce its SAFETY.md matrix behavior
- Voice ASR garbage input → no unintended action (confirmation protocol)

## 4. Faster-than-real-time discipline (from AAS)

- Gazebo `RTF=0` (as-fast-as-possible) with synthetic clock; **all** ROS2 nodes run
  `use_sim_time` — wall-clock dependence is a CI failure.
- Deterministic seeds for wind/traffic randomization; failures reproducible from seed.
- AAS demonstrates 20×+ end-to-end with perception; GA fixed-wing is cheaper to
  simulate, we should exceed it.

## 5. Domain randomization & model realism

- Camera: match sim intrinsics/FOV/noise to the real IMX219-200 pipeline (AAS does
  exactly this with the dewarped CSI model — copy the approach).
- Aircraft dynamics: ArduPilot's SITL plane model is flight-validated; still, fly P3
  subscale before trusting any envelope edge.
- Wind: Gazebo wind plugin with gust spectra; validate against logged real wind at P3.

## 6. What the average user sees

None of this. They run `./afcs sim`, watch their airplane fly a crosswind circuit in
Gazebo with the Glasswing panel live next to it, say *"Glasswing, go around"* into the
mic, and watch it happen. The ladder above is the maintainers' burden — the omakase.
