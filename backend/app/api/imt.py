"""
IMT Allocations — CRUD API
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db
from app.models.imt import IMTAllocation, SpectrumBlock

router = APIRouter()


@router.get("/")
async def list_imt_allocations(
    status: str = None,
    db: AsyncSession = Depends(get_db),
):
    """List IMT allocations, optional filter by status."""
    query = select(IMTAllocation)
    if status:
        query = query.where(IMTAllocation.status == status)
    query = query.order_by(IMTAllocation.created_at.desc())

    result = await db.execute(query)
    allocations = result.scalars().all()

    # Batch query all blocks for these allocations
    alloc_ids = [str(a.id) for a in allocations]
    blocks_by_alloc = {}
    if alloc_ids:
        block_query = select(SpectrumBlock).where(
            SpectrumBlock.allocation_id.in_(alloc_ids)
        )
        block_result = await db.execute(block_query)
        for block in block_result.scalars().all():
            aid = str(block.allocation_id)
            if aid not in blocks_by_alloc:
                blocks_by_alloc[aid] = []
            blocks_by_alloc[aid].append(_block_to_dict(block))

    return {
        "count": len(allocations),
        "allocations": [_imt_to_dict(a, blocks_by_alloc.get(str(a.id), [])) for a in allocations],
    }


@router.get("/{allocation_id}")
async def get_imt_allocation(allocation_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single IMT allocation by ID."""
    result = await db.execute(select(IMTAllocation).where(IMTAllocation.id == allocation_id))
    alloc = result.scalar_one_or_none()
    if not alloc:
        raise HTTPException(status_code=404, detail="IMT Allocation not found")

    # Query blocks
    block_query = select(SpectrumBlock).where(SpectrumBlock.allocation_id == allocation_id)
    block_result = await db.execute(block_query)
    blocks = [_block_to_dict(b) for b in block_result.scalars().all()]

    return _imt_to_dict(alloc, blocks)


@router.post("/")
async def create_imt_allocation(data: dict, db: AsyncSession = Depends(get_db)):
    """Create a new IMT allocation request."""
    # Convert center_lat/center_lon to area_wkt if not provided
    if "area_wkt" not in data and "center_lat" in data and "center_lon" in data:
        lat, lon = data["center_lat"], data["center_lon"]
        radius = data.get("cell_radius", 500)
        dlat = radius / 111320.0
        dlon = radius / (111320.0 * abs(lat / 90.0 + 1e-9)) if abs(lat) > 1e-6 else radius / 111320.0
        data["area_wkt"] = (
            f"POLYGON(({lon-dlon} {lat-dlat},{lon+dlon} {lat-dlat},"
            f"{lon+dlon} {lat+dlat},{lon-dlon} {lat+dlat},{lon-dlon} {lat-dlat}))"
        )
    
    alloc = IMTAllocation(**{k: v for k, v in data.items() if hasattr(IMTAllocation, k)})
    db.add(alloc)
    await db.flush()  # Get alloc.id without committing yet

    # Save blocks to spectrum_blocks table
    blocks_data = data.get("blocks", [])
    saved_blocks = []
    for b in blocks_data:
        block = SpectrumBlock(
            allocation_id=str(alloc.id),
            freq_low=float(b["freq_low"]),
            freq_high=float(b["freq_high"]),
            status=b.get("status", "allocated"),
            max_eirp=b.get("max_eirp"),
        )
        db.add(block)
        saved_blocks.append(block)

    await db.commit()
    await db.refresh(alloc)

    return _imt_to_dict(alloc, [_block_to_dict(b) for b in saved_blocks])


@router.put("/{allocation_id}")
async def update_imt_allocation(allocation_id: str, data: dict, db: AsyncSession = Depends(get_db)):
    """Update an IMT allocation."""
    result = await db.execute(select(IMTAllocation).where(IMTAllocation.id == allocation_id))
    alloc = result.scalar_one_or_none()
    if not alloc:
        raise HTTPException(status_code=404, detail="IMT Allocation not found")

    for key, value in data.items():
        if hasattr(alloc, key) and key not in ("id", "created_at"):
            setattr(alloc, key, value)

    await db.commit()
    await db.refresh(alloc)

    # Query blocks
    block_query = select(SpectrumBlock).where(SpectrumBlock.allocation_id == allocation_id)
    block_result = await db.execute(block_query)
    blocks = [_block_to_dict(b) for b in block_result.scalars().all()]

    return _imt_to_dict(alloc, blocks)


@router.delete("/{allocation_id}")
async def delete_imt_allocation(allocation_id: str, db: AsyncSession = Depends(get_db)):
    """Soft-delete (status=expired)."""
    result = await db.execute(select(IMTAllocation).where(IMTAllocation.id == allocation_id))
    alloc = result.scalar_one_or_none()
    if not alloc:
        raise HTTPException(status_code=404, detail="IMT Allocation not found")

    alloc.status = "expired"
    await db.commit()
    return {"message": f"IMT Allocation {allocation_id} expired"}


def _imt_to_dict(a: IMTAllocation, blocks: list) -> dict:
    center_lat, center_lon = _extract_center_from_wkt(str(a.area_wkt))
    return {
        "id": str(a.id),
        "name": a.name,
        "operator": a.operator,
        "center_lat": center_lat,
        "center_lon": center_lon,
        "area_wkt": a.area_wkt,
        "cell_radius": a.cell_radius,
        "antenna_height": a.antenna_height,
        "max_eirp": a.max_eirp,
        "antenna_gain": a.antenna_gain,
        "status": a.status,
        "approved_by": a.approved_by,
        "valid_from": str(a.valid_from) if a.valid_from else None,
        "valid_until": str(a.valid_until) if a.valid_until else None,
        "created_at": str(a.created_at),
        "blocks": blocks,
    }


def _block_to_dict(b: SpectrumBlock) -> dict:
    return {
        "freq_low": b.freq_low,
        "freq_high": b.freq_high,
        "status": b.status,
        "max_eirp": b.max_eirp,
    }


def _extract_center_from_wkt(wkt: str) -> tuple:
    """Extract center lat/lon from WKT POLYGON string."""
    try:
        coords_str = wkt.replace("POLYGON", "").replace("(", "").replace(")", "").strip()
        pairs = coords_str.split(",")
        lons, lats = [], []
        for pair in pairs:
            parts = pair.strip().split()
            if len(parts) >= 2:
                lons.append(float(parts[0]))
                lats.append(float(parts[1]))
        if lats and lons:
            return sum(lats) / len(lats), sum(lons) / len(lons)
    except Exception:
        pass
    return 13.75, 100.5
