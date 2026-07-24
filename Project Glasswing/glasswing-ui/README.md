# glasswing-ui — G3X-style touch display (Milestone 2 redesign)

A reimagining of the Glasswing EFIS display in the Garmin G3X Touch idiom:
synthetic terrain PFD with airspeed/altitude **tapes**, VSI, HSI with inset
moving map, engine strip, radio/xpdr top bar, nearest-airport panel, and a
top-down map pane. Pure HTML5 canvas + WebSocket — runs great full-screen on
an iPad (Safari → Share → Add to Home Screen).

## Run

```bash
bash run-glasswing-ui.sh          # auto-detect: NetFIX if FIX-Gateway is up
bash run-glasswing-ui.sh sim      # synthetic demo flight (no hardware)
bash run-glasswing-ui.sh netfix   # live from FIX-Gateway (SITL or SpeedyBee)
bash run-glasswing-ui.sh msfs     # MSFS dev testing (adapter stub, sim fallback)
```

Open `http://localhost:8080` locally, or `http://<mac-ip>:8080` on the iPad.

## Touch interactions

- **Tap the map inset** (or the **Split** button, top right) → split screen:
  PFD on the left, expanded map on the right. Tap again to revert.
- **Tap a COM frequency** → swap active/standby.
- **IDENT** button → pulses green (~18 s), sends ident event to the bridge.
- All events go to `server.py:on_event()` — ready to be wired to FIX keys.

## Data architecture

```
 ArduPilot SITL ─┐
 SpeedyBee F405 ─┼─ MAVLink ─▶ FIX-Gateway ─▶ NetFIX :3490 ─▶ server.py ──ws :8760──▶ iPad/browser
 MSFS (SimConnect, planned) ──────────────────────────────────▶ server.py
 (nothing running) ─▶ built-in SimSource (synthetic flight) ──▶ server.py
```

- `server.py` — data bridge. `NetfixSource` subscribes to FIX-Gateway keys
  (PITCH/ROLL/HEAD/IAS/ALT/VS/GS/LAT/LONG/RPM/MAP/OILP/…). `MsfsSource` is the
  stub for Microsoft Flight Simulator dev testing — fill in SimConnect reads
  where marked `TODO(msfs)`. `SimSource` keeps the display alive with a
  synthetic flight when no real source is connected.
- `static/` — the display. No build step, no dependencies; one `<canvas>`
  per region, 60 fps render loop consuming 10 Hz telemetry with smoothing.

## Files

- `server.py` — WebSocket bridge + sources (sim / netfix / msfs-stub)
- `static/index.html` — layout shell (top bar, engine, PFD, right column, bottom bar)
- `static/style.css` — G3X dark-glass theme, split-screen mode
- `static/app.js` — canvas renderers (synthetic terrain PFD, tapes, HSI, map, engine)
- `run-glasswing-ui.sh` — one-command launcher

## Notes

- Colors are theme constants at the top of `app.js` (`MAG`, `CYN`, `GRN`, …)
  and in `style.css` — easy to restyle later.
- Synthetic terrain is procedural (fbm noise) — a placeholder until real
  elevation tiles (e.g. AWS terrain tiles / SRTM) are wired into `drawMap`
  and the PFD backdrop.
- This supplements, not replaces, the pyEfis stack: pyEfis remains the Pi
  cockpit display path; this is the sleek touch/tablet front end.
