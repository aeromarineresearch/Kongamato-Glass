"""airport_db — nearest-suitable-airport engine for the AFCS mission brain.

Data sources (open, redistributable):
  * FAA CIFP / ARINC-424  (already vendored in Project Glasswing:
    vendor/makerplane/repos/faa-cifp-data)  — US, authoritative runway data
  * OurAirports CSV (https://ourairports.com/data/, public domain) — global

The mission brain asks one question: "given where I am, my fuel, the wind, and
what my airplane needs — where can I land?" This module answers it, fast,
with no network dependency (the DB is loaded at startup, works GNSS-denied
relative to last known position).
"""
from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Runway:
    ident: str            # e.g. "30"
    length_ft: float
    width_ft: float
    surface: str          # "ASP", "TURF", ...
    heading_deg: float    # magnetic


@dataclass
class Airport:
    ident: str
    name: str
    lat: float
    lon: float
    elev_ft: float
    runways: list[Runway] = field(default_factory=list)
    towered: bool = False


@dataclass
class Suitability:
    airport: Airport
    runway: Runway
    dist_nm: float
    crosswind_kt: float
    headwind_kt: float
    score: float          # lower is better


def haversine_nm(lat1, lon1, lat2, lon2) -> float:
    r_nm = 3440.065
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r_nm * math.asin(math.sqrt(a))


def wind_components(rwy_hdg: float, wind_dir: float, wind_kt: float):
    """Return (headwind, crosswind) in knots. Positive headwind = on the nose."""
    ang = math.radians(wind_dir - rwy_hdg)
    return wind_kt * math.cos(ang), wind_kt * math.sin(ang)


class AirportDB:
    def __init__(self, ourairports_csv: Path | None = None,
                 runways_csv: Path | None = None):
        self.airports: dict[str, Airport] = {}
        if ourairports_csv:
            self._load_ourairports(ourairports_csv, runways_csv)

    def _load_ourairports(self, airports_csv: Path, runways_csv: Path | None):
        with open(airports_csv, newline="") as f:
            for row in csv.DictReader(f):
                if row.get("type") not in ("small_airport", "medium_airport",
                                           "large_airport"):
                    continue
                try:
                    self.airports[row["ident"]] = Airport(
                        ident=row["ident"], name=row["name"],
                        lat=float(row["latitude_deg"]),
                        lon=float(row["longitude_deg"]),
                        elev_ft=float(row.get("elevation_ft") or 0),
                        towered=bool(row.get("tower")),
                    )
                except (ValueError, KeyError):
                    continue
        if runways_csv and Path(runways_csv).exists():
            with open(runways_csv, newline="") as f:
                for row in csv.DictReader(f):
                    ap = self.airports.get(row.get("airport_ident", ""))
                    if not ap:
                        continue
                    try:
                        le = row.get("le_ident") or "?"
                        ap.runways.append(Runway(
                            ident=le,
                            length_ft=float(row.get("length_ft") or 0),
                            width_ft=float(row.get("width_ft") or 0),
                            surface=row.get("surface", "UNK"),
                            heading_deg=float(row.get("le_heading_degT") or 0),
                        ))
                    except ValueError:
                        continue

    def nearest_suitable(self, lat: float, lon: float,
                         min_runway_ft: float = 2000.0,
                         max_crosswind_kt: float = 10.0,
                         wind_dir: float = 0.0, wind_kt: float = 0.0,
                         paved_only: bool = False,
                         max_results: int = 5) -> list[Suitability]:
        """Rank airports by suitability: reachable, long enough, into the wind."""
        out: list[Suitability] = []
        for ap in self.airports.values():
            dist = haversine_nm(lat, lon, ap.lat, ap.lon)
            best: Suitability | None = None
            for rw in ap.runways or []:
                if rw.length_ft < min_runway_ft:
                    continue
                if paved_only and not rw.surface.upper().startswith(("ASP", "CON")):
                    continue
                hw, xw = wind_components(rw.heading_deg, wind_dir, wind_kt)
                if abs(xw) > max_crosswind_kt:
                    continue
                # score: distance dominates, headwind helps, long runway helps a bit
                score = dist - 0.05 * max(hw, 0) - 0.001 * rw.length_ft
                cand = Suitability(ap, rw, dist, abs(xw), hw, score)
                if best is None or cand.score < best.score:
                    best = cand
            if best is None and not ap.runways:
                # no runway data — keep as last resort with penalty
                best = Suitability(ap, Runway("?", 0, 0, "UNK", 0), dist, 0, 0,
                                   dist + 50)
            if best:
                out.append(best)
        out.sort(key=lambda s: s.score)
        return out[:max_results]
