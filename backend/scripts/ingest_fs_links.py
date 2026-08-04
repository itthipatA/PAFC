"""Ingest real AWN fixed-service links (60 links / 120 stations) into PAFC.

Reads the exported FS_Stations_Geocoded CSV (from the source Google Sheet:
19L21No7tBfcX7QrqezM-gAa-3CfGwbzzbBgI6eTdOUU tab FS_Stations_Geocoded),
pairs consecutive stations by path_no into links, generates ITU-R F.699-9
antenna patterns, clears existing (mock) rows, and bulk-inserts.

Usage (from backend/):
    .venv/bin/python scripts/ingest_fs_links.py --csv /tmp/fs_stations_geocoded.csv --clear
"""
import argparse
import asyncio
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text

from app.db.database import async_session
from app.models.fs_link import FSLink
from app.services.antenna_pattern import pattern_json


def read_stations(csv_path: str) -> list:
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        return [dict(r) for r in csv.DictReader(f)]


def group_paths(stations: list) -> list:
    """Pair consecutive station rows by path_no (2 stations per path)."""
    paths, cur = [], None
    for s in stations:
        if not any((s.get(k) or "").strip() for k in ("path_no", "station_code")):
            continue
        if s.get("path_no"):
            cur = [s]
            paths.append(cur)
        elif cur is not None:
            cur.append(s)
    bad = [p for p in paths if len(p) != 2]
    if bad:
        raise ValueError(f"{len(bad)} paths do not have exactly 2 stations: "
                         f"{[p[0].get('station_code') for p in bad]}")
    return paths


def polar_map(v) -> str:
    return "dual" if (v or "").strip().upper() == "V&H" else (v or "").strip()


def fnum(row, key):
    v = row.get(key)
    return float(v) if v not in (None, "") else None


def build_links(paths) -> list:
    links = []
    for p in paths:
        a, b = p  # a = TX (first station), b = RX
        f_lo = min(fnum(a, "freq_tx_mhz"), fnum(a, "freq_rx_mhz"))
        f_hi = max(fnum(a, "freq_tx_mhz"), fnum(a, "freq_rx_mhz"))
        pattern = json.loads(pattern_json(
            gmax_dbi=fnum(a, "antenna_gain_dbi"),
            D_m=fnum(a, "antenna_diam_m"),
            freq_mhz=fnum(a, "freq_tx_mhz"),
            step_deg=0.1,
        ))
        links.append(FSLink(
            name=f"{a['station_code'].strip()}-{b['station_code'].strip()}",
            operator=(a.get("operator") or "AWN").strip(),
            tx_lat=fnum(a, "lat_dec"), tx_lon=fnum(a, "lon_dec"),
            tx_altitude=fnum(a, "antenna_height_m"),
            rx_lat=fnum(b, "lat_dec"), rx_lon=fnum(b, "lon_dec"),
            rx_altitude=fnum(b, "antenna_height_m"),
            freq_low=f_lo, freq_high=f_hi,
            bandwidth=fnum(a, "bandwidth_mhz"),
            tx_power=fnum(a, "power_dbm"),
            tx_antenna_gain=fnum(a, "antenna_gain_dbi"),
            rx_antenna_gain=fnum(b, "antenna_gain_dbi"),
            beamwidth_deg=fnum(a, "beamwidth_deg") or 3.0,
            azimuth=fnum(a, "azimuth_deg"),
            polarization=polar_map(a.get("polarization")),
            class_of_emission=a.get("class_of_emission") or None,
            antenna_diameter=fnum(a, "antenna_diam_m"),
            eirp=fnum(a, "eirp_dbm"),
            quantity=int(fnum(a, "qty")) if fnum(a, "qty") else 1,
            tx_code=a["station_code"].strip(), rx_code=b["station_code"].strip(),
            distance_km=fnum(a, "distance_km"),
            tx_address=a.get("locality") or None, rx_address=b.get("locality") or None,
            antenna_pattern=pattern,
            status="active",
        ))
    return links


async def main(csv_path: str, clear: bool):
    stations = read_stations(csv_path)
    paths = group_paths(stations)
    links = build_links(paths)
    print(f"parsed {len(paths)} links from {len(stations)} stations")

    async with async_session() as session:
        if clear:
            await session.execute(text("TRUNCATE fs_links RESTART IDENTITY CASCADE"))
            print("truncated fs_links (mock data cleared)")
        session.add_all(links)
        await session.commit()
        print(f"inserted {len(links)} real AWN links")

    # quick read-back
    async with async_session() as session:
        from sqlalchemy import select, func
        cnt = (await session.execute(select(func.count()).select_from(FSLink))).scalar()
        print(f"fs_links total after ingest: {cnt}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="path to FS_Stations_Geocoded export CSV")
    ap.add_argument("--clear", action="store_true", help="TRUNCATE fs_links before insert")
    args = ap.parse_args()
    asyncio.run(main(args.csv, args.clear))
