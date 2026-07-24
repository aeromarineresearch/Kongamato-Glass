# Super AFCS — Safety Architecture

Non-negotiable. Every design review, every PR, every release checklist refers to this file.

---

## 0. Posture

- ⚠️ **Not certified avionics.** Experimental/E-AB, VFR-day, pilot-aboard-always.
- ⚠️ **The Pilot in Command is the final authority at all times, in all modes.**
- ⚠️ Autonomy failure must never make the aircraft less controllable than the same
  aircraft without the system installed.

## 1. The five override paths (defense in depth)

| # | Path | Latency | Notes |
|---|---|---|---|
| 1 | **Guarded physical AFCS DISENGAGE switch** (panel, red, covered) | <100 ms | Wired into FC RC channel → instant ArduPilot mode change to MANUAL/FBWA. Does not transit the Jetson at all. |
| 2 | **Stick/throttle breakout** — sustained control input beyond threshold | <200 ms | ArduPilot `STICK_MIXING` / override detection at the FC. |
| 3 | **Voice** — "Glasswing, disengage" / "my aircraft" | ~1 s | Wake-word independent hot-word, works with ASR degraded. |
| 4 | **Touch panel big red button** (Track 1 pyEfis, always-visible) | ~1 s | NetFIX `AFCS_CMD=DISENGAGE` → executive + FC. |
| 5 | **HUD gesture/voice** (Track 2) | ~1 s | Same `DISENGAGE` command path. |

Paths 1–2 are **hardware-level and Jetson-independent** — they work even if every
computer in the airplane is on fire. This mirrors AAS's RC-override model (RadioMaster
→ receiver → FC), adapted from RC transmitter to cockpit controls.

## 2. Layered containment

```
Layer 0  ArduPilot Plane: geofence, RTL, stall protection, terrain following,
         autoland envelope — flight-proven, onboard, never bypassed.
Layer 1  afcs_executive: deterministic state machine; validates every mission
         command against envelope, fuel, terrain, geofence BEFORE issuing.
Layer 2  afcs_mission: behavior trees with abort gates at every phase
         (e.g. stabilized-approach gate → auto go-around).
Layer 3  afcs_perception: advisory veto ("runway occupied") — can trigger
         go-around/abort but cannot fly outside envelope to avoid.
Layer 4  Human: sees everything on FMA strip + HUD, hears readbacks, overrides.
```

## 3. Failure-mode matrix (design requirement per row)

| Failure | Required behavior |
|---|---|
| Jetson dies / AFCS container crashes | FC continues last safe mode (AUTO continues or RTL per fence config); panel+HUD still live (they read FC MAVLink via FIX-Gateway directly) |
| FIX-Gateway dies | Autonomy unaffected (its data path is MAVROS, not NetFIX); displays degrade with "NO DATA" — HUD rule: lose nothing essential |
| Camera/perception dies | DEGRADED mode: perception advisories drop out, flight autonomy continues, PIC informed |
| Voice ASR dies | Touch + text + physical controls unaffected |
| GPS lost | KISS-ICP/airspeed dead-reckoning advisory → divert-or-land decision offered to PIC; FC EKF handles short-term |
| Data-link to ground lost | Aircraft is autonomous-by-design; ground is supervision only |
| Conflicting sensors (AHRS vs AHRS) | Disagreement flag on panel+HUD (Glasswing master-plan risk #2); autonomy trusts FC EKF only |

## 4. Envelope & phase-of-flight authority ladder

Autonomy authority is granted **per phase of flight, per airframe, per pilot**, and
stored in `config/aircraft/<profile>.yaml`. Default ladder for a new install:

1. Advisory only (FMA shows what AFCS *would* do — shadow mode)
2. Enroute segments (heading/alt/waypoint following), pilot flies TO/LD
3. Auto takeoff (pilot throttle guard)
4. Auto land (crosswind limit 5 kt, widening with logged evidence)
5. Full mission

**Shadow mode is the killer feature for trust:** the system flies the airplane in its
head for N hours, the pilot watches its intentions on the FMA/HUD, and only then do
you close the loop. Every install starts here.

## 5. Voice command protocol

- Every command → readback → explicit confirm ("confirm" / "negative") → execute.
- Safety-critical commands (land, divert, disengage) require confirm; information
  requests do not.
- All intents + executions are logged with timestamps to the flight log.
- "Say intentions" is always available and always honest.

## 6. Logging & evidence

- Every flight: full ROS2 bag + ArduPilot .bin + NetFIX log, auto-uploaded post-flight
  to the Glasswing ground tier (Chronos-2 trend pipeline — predictive maintenance
  *and* autonomy behavior trending).
- CI gate: no release without the full FTRT mission suite green (see `tests/`).
- Phase gates (sim→HITL→subscale→E-AB) require logged-hours evidence; the ladder in
  §4 is enforced by config, not by discipline.
