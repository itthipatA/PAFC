"""Ingest military FS links from the PAFC_import_review sheet (append-only).

Reads review rows (exported to JSON), builds FSLink objects for one operator,
skips incomplete rows and existing (name, operator) duplicates. NEVER truncates.

Usage (from backend/):
    .venv/bin/python scripts/ingest_review_sheet.py --json /tmp/pafc_review.json --operator ทอ. --dry-run
    .venv/bin/python scripts/ingest_review_sheet.py --json /tmp/pafc_review.json --operator ทอ.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select, text

from app.db.database import async_session
from app.models.fs_link import FSLink
from app.services.antenna_pattern import pattern_json


def fnum(v):
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def polar_map(v) -> str:
    return "dual" if (v or "").strip().upper() == "V&H" else (v or "").strip()


REQUIRED = ("tx_lat", "tx_lon", "rx_lat", "rx_lon", "power", "gain_tx",
            "gain_rx", "freq_hi", "freq_lo", "diam_tx")


def build_link(r: dict):
    missing = [k for k in REQUIRED if fnum(r.get(k)) is None and not (k == "class" and r.get(k))]
    if r.get("class") in (None, ""):
        missing.append("class")
    missing = sorted(set(missing))
    if missing:
        return None, missing
    pwr, gtx = fnum(r["power"]), fnum(r["gain_tx"])
    fhi = fnum(r["freq_hi"])
    dtx = fnum(r["diam_tx"])
    assert pwr is not None and gtx is not None and fhi is not None and dtx is not None
    link = FSLink(
        name=f"{r['tx_code'].strip()}-{r['rx_code'].strip()}",
        operator=r["operator"].strip(),
        tx_lat=fnum(r["tx_lat"]), tx_lon=fnum(r["tx_lon"]),
        tx_altitude=fnum(r["height_tx"]),
        rx_lat=fnum(r["rx_lat"]), rx_lon=fnum(r["rx_lon"]),
        rx_altitude=fnum(r["height_rx"]),
        freq_low=fnum(r["freq_lo"]), freq_high=fhi,
        bandwidth=fnum(r["bandwidth"]),
        tx_power=pwr,
        tx_antenna_gain=gtx,
        rx_antenna_gain=fnum(r["gain_rx"]),
        beamwidth_deg=fnum(r["beam_tx"]) or 3.0,
        azimuth=fnum(r["azimuth"]),
        polarization=polar_map(r.get("polarization")),
        class_of_emission=r["class"].strip(),
        antenna_diameter=dtx,
        eirp=round(pwr + gtx, 2),
        quantity=1,
        tx_code=r["tx_code"].strip(), rx_code=r["rx_code"].strip(),
        distance_km=fnum(r["distance"]),
        tx_address=r.get("tx_addr") or None, rx_address=r.get("rx_addr") or None,
        antenna_pattern=json.loads(pattern_json(
            gmax_dbi=gtx, D_m=dtx, freq_mhz=fhi, step_deg=0.1)),
        status="active",
    )
    return link, []


async def main(json_path: str, operator: str, dry_run: bool):
    rows = json.load(open(json_path))
    rows = [r for r in rows if (r.get("operator") or "").strip() == operator]
    print(f"review rows for {operator}: {len(rows)}")

    async with async_session() as session:
        existing = set(map(tuple, (await session.execute(
            select(FSLink.name, FSLink.operator))).all()))
        before = int((await session.execute(
            select(func.count()).select_from(FSLink))).scalar() or 0)

        links, skipped = [], []
        for r in rows:
            key = (f"{r['tx_code'].strip()}-{r['rx_code'].strip()}", operator)
            if key in existing:
                skipped.append((r.get("id"), "duplicate"))
                continue
            link, missing = build_link(r)
            if link is None:
                skipped.append((r.get("id"), f"missing: {','.join(missing)}"))
                continue
            links.append(link)
            existing.add(key)

        print(f"ready: {len(links)}, skipped: {len(skipped)}")
        for sid, why in skipped:
            print(f"  SKIP {sid}: {why}")
        if dry_run:
            print("dry-run: no writes")
            return
        session.add_all(links)
        await session.commit()
        after = int((await session.execute(
            select(func.count()).select_from(FSLink))).scalar() or 0)
        print(f"fs_links {before} -> {after} (+{after - before})")
        sample = (await session.execute(
            select(FSLink.name, FSLink.freq_high, FSLink.freq_low,
                   FSLink.tx_power, FSLink.eirp)
            .where(FSLink.operator == operator).limit(3))).all()
        for s in sample:
            print("  sample:", list(s))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    ap.add_argument("--operator", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    asyncio.run(main(args.json, args.operator, args.dry_run))
