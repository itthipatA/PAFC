"""
Spectrum Allocation Engine — API endpoint
POST /api/allocate/analyze
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db
from app.models.fs_link import FSLink
from app.models.imt import IMTAllocation
from app.services.interference import (
    InterferenceEngine, FSLinkData, IMTNeighborData
)

router = APIRouter()


@router.post("/analyze")
async def analyze_allocation(data: dict, db: AsyncSession = Depends(get_db)):
    """
    Run interference analysis for a proposed IMT allocation.
    
    Request body:
    {
        "center_lat": 13.75,
        "center_lon": 100.5,
        "cell_radius": 500,
        "antenna_height": 15,
        "antenna_gain": 12,
        "max_eirp": 23,
        "model": "free_space"  // optional
    }
    """
    center_lat = float(data["center_lat"])
    center_lon = float(data["center_lon"])
    cell_radius = float(data["cell_radius"])
    antenna_height = float(data["antenna_height"])
    antenna_gain = float(data.get("antenna_gain", 0))
    max_eirp = float(data["max_eirp"])
    model_name = data.get("model", "free_space")

    # Query active FS links
    fs_query = select(FSLink).where(FSLink.status == "active")
    fs_result = await db.execute(fs_query)
    fs_links_raw = fs_result.scalars().all()

    fs_links = [
        FSLinkData(
            id=str(fs.id),
            name=fs.name,
            tx_lat=fs.tx_lat, tx_lon=fs.tx_lon,
            tx_altitude=fs.tx_altitude or 0,
            rx_lat=fs.rx_lat, rx_lon=fs.rx_lon,
            rx_altitude=fs.rx_altitude or 0,
            freq_low=fs.freq_low, freq_high=fs.freq_high,
            bandwidth=fs.bandwidth,
            tx_power=fs.tx_power,
            tx_antenna_gain=fs.tx_antenna_gain,
            rx_antenna_gain=fs.rx_antenna_gain or 0,
        )
        for fs in fs_links_raw
    ]

    # Query active IMT neighbors
    imt_query = select(IMTAllocation).where(IMTAllocation.status == "active")
    imt_result = await db.execute(imt_query)
    imt_raw = imt_result.scalars().all()

    # Get blocks for each neighbor IMT (simplified — per allocation, assume full block range for now)
    neighbor_imts = []
    for imt in imt_raw:
        # Parse area_wkt for center (simplified: use first coordinate)
        center = _parse_wkt_center(imt.area_wkt)
        if center is None:
            continue
        neighbor_imts.append(
            IMTNeighborData(
                id=str(imt.id),
                name=imt.name,
                center_lat=center["lat"],
                center_lon=center["lon"],
                cell_radius=imt.cell_radius,
                freq_low=4800,   # Simplified — would query spectrum_blocks
                freq_high=4990,  # In production: per-block neighbor check
            )
        )

    # Run interference analysis
    engine = InterferenceEngine(propagation_model=model_name)
    result = engine.analyze(
        center_lat=center_lat,
        center_lon=center_lon,
        cell_radius=cell_radius,
        antenna_height=antenna_height,
        antenna_gain=antenna_gain,
        max_eirp=max_eirp,
        fs_links=fs_links,
        neighbor_imts=neighbor_imts,
    )

    return {
        "blocks": [
            {
                "freq_low": b.freq_low,
                "freq_high": b.freq_high,
                "status": b.status,
                "max_eirp": b.max_eirp,
                "reason": b.reason,
            }
            for b in result.blocks
        ],
        "summary": result.summary,
        "model_used": model_name,
    }


def _parse_wkt_center(wkt: str) -> dict | None:
    """Parse WKT POLYGON and return approximate center from first point."""
    try:
        # "POLYGON((lon lat, lon lat, ...))"
        inner = wkt.replace("POLYGON", "").replace("(", "").replace(")", "").strip()
        coords = [c.strip().split() for c in inner.split(",") if c.strip()]
        if coords:
            lons = [float(c[0]) for c in coords]
            lats = [float(c[1]) for c in coords]
            return {"lat": sum(lats) / len(lats), "lon": sum(lons) / len(lons)}
    except Exception:
        pass
    return None
