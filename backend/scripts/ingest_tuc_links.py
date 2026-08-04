"""Ingest TUC offshore-platform FS links (ชีต2 of the PAFC source sheet) into PAFC.

Filter: only paths whose หมายเหตุ contains the confirmation marker (default
"แจ้งยืนยันการใช้งาน") — cancelled paths and duplicates are skipped.
Appends to fs_links (does NOT truncate the AWN data).

Usage:
  .venv/bin/python scripts/ingest_tuc_links.py --json /tmp/tuc_raw.json [--remark "แจ้งยืนยันการใช้งาน"] [--operator TUC]
"""
import argparse
import asyncio
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.database import async_session
from app.models.fs_link import FSLink
from app.services.antenna_pattern import pattern_json


def dms_to_dec(d, m, s):
    try:
        return float(d) + float(m) / 60.0 + float(s) / 3600.0
    except (TypeError, ValueError):
        return None


def estimate_diam_m(gain_dbi, freq_mhz):
    """Estimate antenna diameter from gain (ITU-R F.699-9 note: D/λ ≈ 10^((G−7.7)/20))."""
    lam = 299.792458 / freq_mhz
    d_l = 10 ** ((gain_dbi - 7.7) / 20.0)
    return lam * d_l


def group_paths(rows):
    paths, cur = {}, None
    for r in rows:
        pno = (r[0] or "").strip() if len(r) > 0 else ""
        code = (r[1] or "").strip() if len(r) > 1 else ""
        if pno:
            cur = pno
            paths.setdefault(pno, [])
        if cur and code:
            paths[cur].append(r)
    return paths


def main_sync(json_path, remark_filter, operator):
    data = json.load(open(json_path))
    data_rows = data[2:]  # skip 2 header rows
    paths = group_paths(data_rows)

    def remark(r):
        return (r[22] or "").strip() if len(r) > 22 else ""

    def num(r, i):
        try:
            return float(r[i])
        except (TypeError, ValueError, IndexError):
            return None

    selected = []
    for pno in sorted(paths, key=lambda x: int(x) if x.isdigit() else 999):
        entries = paths[pno]
        # dedupe: keep first occurrence of each (code, freq_tx)
        seen = set()
        uniq = []
        for r in entries:
            key = ((r[1] or "").strip(), (r[11] if len(r) > 11 else None))
            if key in seen:
                continue
            seen.add(key)
            uniq.append(r)
        if len(uniq) != 2:
            print(f"path {pno}: SKIP ({len(uniq)} unique stations, not 2)")
            continue
        a, b = uniq  # a = TX (first station), b = RX
        ra, rb = remark(a), remark(b)
        if remark_filter not in ra or remark_filter not in rb:
            print(f"path {pno}: SKIP (remark: {ra[:30]} / {rb[:30]})")
            continue
        lat_a = dms_to_dec(*[num(a, i) for i in (5, 6, 7)])
        lon_a = dms_to_dec(*[num(a, i) for i in (8, 9, 10)])
        lat_b = dms_to_dec(*[num(b, i) for i in (5, 6, 7)])
        lon_b = dms_to_dec(*[num(b, i) for i in (8, 9, 10)])
        f_tx = num(a, 11) or 0
        f_rx = num(a, 12) or 0
        gain = num(a, 16) or 0
        freq_for_pattern = f_tx or f_rx
        d_est = estimate_diam_m(gain, freq_for_pattern) if freq_for_pattern else None
        pattern = None
        if freq_for_pattern and gain:
            pattern = json.loads(pattern_json(
                gmax_dbi=gain, D_m=d_est or 0.001, freq_mhz=freq_for_pattern, step_deg=0.1,
            ))
            pattern["D_est_from_gain"] = True
        selected.append({
            "path": pno, "operator": operator,
            "tx_code": (a[1] or "").strip(), "rx_code": (b[1] or "").strip(),
            "tx_addr": (a[2] or "").strip(), "rx_addr": (b[2] or "").strip(),
            "tx_lat": lat_a, "tx_lon": lon_a, "rx_lat": lat_b, "rx_lon": lon_b,
            "freq_low": min(f_tx, f_rx), "freq_high": max(f_tx, f_rx),
            "bandwidth": num(a, 13), "coe": (a[14] or "").strip() if len(a) > 14 else "",
            "power": num(a, 15), "gain": gain, "eirp": num(a, 17),
            "beamwidth": num(a, 18), "azimuth": num(a, 19),
            "polarization": (a[20] or "").strip() if len(a) > 20 else "",
            "qty": num(a, 21), "distance_km": num(a, 4),
            "pattern": pattern,
        })
        print(f"path {pno}: SELECT {selected[-1]['tx_code']} <-> {selected[-1]['rx_code']} "
              f"({selected[-1]['distance_km']} km, {selected[-1]['freq_low']}-{selected[-1]['freq_high']} MHz)")

    return selected


async def insert(selected, operator):
    async with async_session() as session:
        for s in selected:
            link = FSLink(
                name=f"{s['tx_code']}-{s['rx_code']}",
                operator=operator,
                tx_lat=s["tx_lat"], tx_lon=s["tx_lon"],
                tx_altitude=None,
                rx_lat=s["rx_lat"], rx_lon=s["rx_lon"],
                rx_altitude=None,
                freq_low=s["freq_low"], freq_high=s["freq_high"],
                bandwidth=s["bandwidth"] or 28,
                tx_power=s["power"], tx_antenna_gain=s["gain"],
                rx_antenna_gain=s["gain"],
                beamwidth_deg=s["beamwidth"] or 3.0,
                azimuth=s["azimuth"],
                polarization="dual" if (s["polarization"] or "").upper() in ("V/H", "V&H") else (s["polarization"] or "V"),
                class_of_emission=s["coe"] or None,
                antenna_diameter=None,
                eirp=s["eirp"],
                quantity=int(s["qty"]) if s["qty"] else 1,
                tx_code=s["tx_code"], rx_code=s["rx_code"],
                distance_km=s["distance_km"],
                tx_address=s["tx_addr"], rx_address=s["rx_addr"],
                antenna_pattern=s["pattern"],
                status="active",
            )
            session.add(link)
        await session.commit()
        print(f"inserted {len(selected)} TUC links")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True, help="raw sheet JSON export (google_api.py sheets get)")
    ap.add_argument("--remark", default="แจ้งยืนยันการใช้งาน")
    ap.add_argument("--operator", default="TUC")
    args = ap.parse_args()
    sel = main_sync(args.json, args.remark, args.operator)
    print(f"--- selected {len(sel)} links ---")
    asyncio.run(insert(sel, args.operator))
