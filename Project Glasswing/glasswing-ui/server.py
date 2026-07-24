#!/usr/bin/env python3
"""
Glasswing UI data bridge.

Serves the web display and pushes a unified telemetry JSON model at ~10 Hz
over WebSocket (port 8760).

Data sources (first one that connects wins, `--source` overrides):
  netfix  — FIX-Gateway NetFIX server (tcp 3490). Used with ArduPilot SITL
            today and the SpeedyBee F405 later (same MAVLink bytes either way).
  msfs    — Microsoft Flight Simulator via SimConnect (dev testing source).
            Requires the `simconnect` package on Windows, or MSFS 2024's
            WASM-free SimConnect TCP on port 500. Stub: falls back to sim.
  sim     — built-in synthetic flight (default when nothing else is up).

Run:  python3 server.py [--source sim|netfix|msfs] [--port 8760]
Then open http://<host>:8760/ on the iPad (same WiFi) and "Add to Home Screen".
"""

import asyncio
import json
import math
import time
import argparse
import random

try:
    import websockets
except ImportError:
    raise SystemExit("pip3 install websockets   (only dependency)")

# ---------------------------------------------------------------- telemetry model

def blank_state():
    return {
        # attitude / air data
        "pitch": 0.0, "roll": 0.0, "hdg": 104.0, "ias": 120.0, "tas": 131.0,
        "alt": 2440.0, "vs": -600.0, "gs": 121.0, "baro": 29.92,
        "sel_alt": 2000.0, "sel_alt_arm": True,
        "dtk": 104.0, "trk": 104.0, "xte_nm": 0.4,
        # nav
        "lat": 45.62, "lon": -122.60,
        "wpt_next": "BLAZR", "wpt_after": "TRAYL", "wpt_dist": 2.0,
        "ete_min": 1.0, "eta_utc": "21:41",
        "nav1_freq": 111.30, "nav1_id": "IVDG",
        "com1_act": 118.100, "com1_stby": 118.700,
        "com1_act_name": "PORTLAND AP", "com1_stby_name": "KPDX TOWER",
        "com2_act": 128.350, "com2_stby": 121.900,
        "com2_act_name": "KPDX ATIS", "com2_stby_name": "KPDX GROUND",
        "xpdr": 3422, "xpdr_mode": "ALT", "tail": "N675PD",
        "ap_modes": ["GPS", "AP", "YD", "GP"],
        # engine
        "rpm": 2300, "map": 24.5, "oil_psi": 89, "oil_f": 207,
        "fuel_gph": 17.5, "cht": [372, 368, 375, 371],
        "egt": [1540, 1528, 1546, 1539],
        "fuel_l": 20.0, "fuel_r": 21.0, "volts": 13.9,
        "oat_f": 59.0,
        # system
        "timer": 1800, "utc": "16:10:38",
        "nearest": [
            {"id": "KVUO", "name": "Pearson",   "brg": 103, "dist": 5.1},
            {"id": "KSPB", "name": "Scappoose", "brg": 313, "dist": 7.9},
            {"id": "KPDX", "name": "Portland Intl", "brg": 107, "dist": 8.2},
        ],
    }

# ---------------------------------------------------------------- sim source

class SimSource:
    """Synthetic flight — gentle orbits + climbs so every gauge moves."""
    def __init__(self):
        self.t0 = time.time()
        self.s = blank_state()

    async def tick(self, dt):
        s = self.s
        t = time.time() - self.t0
        s["roll"]  = 15.0 * math.sin(t / 9.0)
        s["pitch"] = 3.0 + 2.0 * math.sin(t / 7.0 + 1.0)
        s["hdg"]   = (s["hdg"] + s["roll"] * 0.06 * dt * 10) % 360
        s["trk"]   = s["hdg"]
        s["ias"]   = max(60, 120 + 12 * math.sin(t / 13.0))
        s["tas"]   = s["ias"] * 1.09
        s["gs"]    = s["tas"] - 10
        s["vs"]    = 500 * math.sin(t / 11.0)
        s["alt"]  += s["vs"] / 60.0 * dt
        # move ownship so the map slides
        r = math.radians(s["hdg"])
        s["lat"] += math.cos(r) * s["gs"] * dt / 3440.0 / 60.0
        s["lon"] += math.sin(r) * s["gs"] * dt / (3440.0 * math.cos(math.radians(s["lat"]))) / 60.0
        s["wpt_dist"] = max(0.2, s["wpt_dist"] - s["gs"] * dt / 3600.0)
        if s["wpt_dist"] < 0.25:
            s["wpt_next"], s["wpt_after"] = s["wpt_after"], "BUXOM"
            s["wpt_dist"] = 6.0
        s["rpm"] = 2300 + 30 * math.sin(t / 5.0)
        s["fuel_l"] = max(0, s["fuel_l"] - dt / 3600 * 8.5)
        s["fuel_r"] = max(0, s["fuel_r"] - dt / 3600 * 8.5)
        s["timer"] = max(0, s["timer"] - dt)
        s["utc"] = time.strftime("%H:%M:%S", time.gmtime())
        s["eta_utc"] = time.strftime("%H:%M", time.gmtime(time.time() + s["wpt_dist"] / max(s["gs"],1) * 3600))
        return s

# ---------------------------------------------------------------- netfix source

class NetfixSource:
    """Bridges FIX-Gateway's NetFIX ASCII protocol into the telemetry model.

    Works unchanged for ArduPilot SITL (UDP 14552 -> FIX-Gateway) today and
    the SpeedyBee F405 on the Pi later — only FIX-Gateway's connection string
    changes, per milestone0/README.md.
    """
    def __init__(self, host="127.0.0.1", port=3490):
        self.addr = (host, port)
        self.s = blank_state()
        self.keys = ["PITCH","ROLL","HEAD","IAS","TAS","ALT","VS","GS","LAT","LONG",
                     "COURSE","OAT","RPM","MAP","OILP","OILT","FFLOW","VOLT"]
        self.wanted = set(self.keys)

    async def run(self, broadcast):
        while True:
            try:
                r, w = await asyncio.open_connection(*self.addr)
                for k in self.wanted:
                    w.write(f"@s{k}\n".encode())
                await w.drain()
                print(f"[netfix] connected {self.addr}")
                while True:
                    line = await asyncio.wait_for(r.readline(), 30)
                    if not line:
                        break
                    self._parse(line.decode(errors="ignore").strip())
                    await broadcast(self.s)
            except Exception as e:
                print(f"[netfix] {e} — retrying in 3 s")
                await asyncio.sleep(3)

    def _parse(self, line):
        if not line or line[0] in "@!":
            return
        parts = line.split(";")
        if len(parts) < 2:
            return
        key, val = parts[0], parts[1]
        s = self.s
        try:
            v = float(val)
        except ValueError:
            return
        m = {"PITCH":"pitch","ROLL":"roll","HEAD":"hdg","IAS":"ias","TAS":"tas",
             "ALT":"alt","VS":"vs","GS":"gs","LAT":"lat","LONG":"lon",
             "COURSE":"trk","RPM":"rpm","MAP":"map","OILP":"oil_psi","OILT":"oil_f",
             "FFLOW":"fuel_gph","VOLT":"volts"}
        if key in m:
            s[m[key]] = v
        elif key == "OAT":
            s["oat_f"] = v * 9/5 + 32

# ---------------------------------------------------------------- msfs source (stub)

class MsfsSource:
    """Microsoft Flight Simulator dev-testing source.

    Plan: MSFS 2020/2024 SimConnect exposes PITCH BANK, HEADING, AIRSPEED,
    ALTITUDE, GPS LAT/LON etc. On the sim PC run a tiny adapter
    (pip install simconnect) that re-publishes to this bridge, or have this
    bridge open SimConnect TCP directly (MSFS listens on :500 when configured
    in SimConnect.xml). Until an adapter is wired up, falls back to SimSource
    so the UI is always demoable.
    """
    def __init__(self):
        self.fallback = SimSource()

    async def tick(self, dt):
        # TODO(msfs): read SimConnect vars when running on the sim PC:
        #   PLANE_PITCH_DEGREES, PLANE_BANK_DEGREES, HEADING_INDICATOR,
        #   AIRSPEED_INDICATED, PLANE_ALTITUDE, VERTICAL_SPEED,
        #   GPS_POSITION_LAT/LON, RPM, MANIFOLD_PRESSURE, ...
        return await self.fallback.tick(dt)

# ---------------------------------------------------------------- server

class Bridge:
    def __init__(self, source):
        self.source = source
        self.clients = set()

    async def handler(self, ws):
        self.clients.add(ws)
        print(f"[ws] client connected ({len(self.clients)})")
        try:
            async for msg in ws:  # touch inputs / button events from the UI
                try:
                    ev = json.loads(msg)
                    self.on_event(ev)
                except Exception:
                    pass
        finally:
            self.clients.discard(ws)

    def on_event(self, ev):
        # Button/touch events land here (IDENT, split toggle is client-side,
        # HDG SYNC, baro set, com swap, ...). Wire to FIX keys / SimConnect
        # events when the sources are live.
        print(f"[ui-event] {ev}")

    async def broadcast(self, state):
        if not self.clients:
            return
        msg = json.dumps(state)
        dead = []
        for ws in self.clients:
            try:
                await ws.send(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def ticker(self):
        last = time.time()
        while True:
            now = time.time()
            dt = now - last
            last = now
            state = await self.source.tick(dt)
            await self.broadcast(state)
            await asyncio.sleep(0.1)  # 10 Hz

    async def serve_static(self, ws):
        path = ws.path if hasattr(ws, "path") else "/"
        # websockets>=12: use process_request instead; keep ws-only for clarity
        await ws.close()

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="auto", choices=["auto","sim","netfix","msfs"])
    ap.add_argument("--port", type=int, default=8760)
    ap.add_argument("--netfix", default="127.0.0.1:3490")
    args = ap.parse_args()

    src_name = args.source
    if src_name == "auto":
        # try netfix quickly; fall back to sim
        host, port = args.netfix.split(":")
        try:
            r, w = await asyncio.wait_for(asyncio.open_connection(host, int(port)), 2)
            w.close()
            src_name = "netfix"
        except Exception:
            src_name = "sim"
    print(f"[glasswing-ui] source = {src_name}")

    if src_name == "netfix":
        host, port = args.netfix.split(":")
        source = NetfixSource(host, int(port))
        bridge = Bridge(source)
        await websockets.serve(bridge.handler, "0.0.0.0", args.port)
        print(f"[glasswing-ui] ws://0.0.0.0:{args.port}")
        await source.run(bridge.broadcast)
    else:
        source = MsfsSource() if src_name == "msfs" else SimSource()
        bridge = Bridge(source)
        async with websockets.serve(bridge.handler, "0.0.0.0", args.port):
            print(f"[glasswing-ui] ws://0.0.0.0:{args.port}")
            await bridge.ticker()

if __name__ == "__main__":
    asyncio.run(main())
