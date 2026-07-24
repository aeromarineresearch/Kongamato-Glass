# Milestone 1 — Chronos-2 "actual vs predicted" demo (zero hardware)

**Goal:** prove the differentiator story on the Mac: fly a simulated plane, let
Chronos-2 forecast its attitude, and flag where reality leaves the predicted
10–90% band. This is the seed of the onboard advisory monitor (advisory only —
it will never touch a control surface).

## Run it

```bash
bash ~/DEV/Aviation/"Project Glasswing"/milestone1/run-chronos-demo.sh --fake
```

- `--fake` — offline plumbing test, no model download (30 seconds)
- *(no args, no recent log)* — synthetic flight through the **real** Chronos-2
  model (downloads ~0.5 GB of weights once)
- *(no args, recent .BIN found)* — auto-detects your newest SITL log from the
  last 24 h and forecasts it
- `…/run-chronos-demo.sh /path/to/00000001.BIN` — explicit log

Output lands in `milestone1/output/` (`forecast-latest.png` opens automatically).

## Getting a real flight log (10 min)

1. Terminal 1: `bash ~/DEV/Aviation/"Project Glasswing"/milestone0/run-glasswing-sim.sh`
   (SITL + PFD running — you get to watch the EFIS while you fly)
2. Open **QGroundControl** (auto-connects on UDP 14550)
3. Fly: takeoff → a few turns/climbs/descents → land. 3–5 minutes is plenty.
4. Ctrl-C the launcher. SITL writes the `.BIN` into `~/ardupilot/logs/`.
5. Run the demo script with no args — it finds the log.

## The money step — inject a fault

In the MAVProxy console that SITL opens (or via QGC parameters):

```
param set SIM_ENGINE_FAIL 1        # or a servo failure
```

Re-run the forecast — the affected channel should blow out of the band and get
flagged. **That's the pitch deck screenshot**: "Glasswing saw it before the
gauges did."

## Files

- `run-chronos-demo.sh` — venv + parse + forecast + chart, one command
- `output/` — CSVs and charts (gitignore later)
- Working code lives in `research/…/chronos2-starter/` (parse_log.py, forecast.py)
