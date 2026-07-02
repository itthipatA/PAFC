"""
IMT Allocations — CRUD API
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db
from app.models.imt import IMTAllocation

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
    return {"count": len(allocations), "allocations": [_imt_to_dict(a) for a in allocations]}


@router.get("/{allocation_id}")
async def get_imt_allocation(allocation_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single IMT allocation by ID."""
    result = await db.execute(select(IMTAllocation).where(IMTAllocation.id == allocation_id))
    alloc = result.scalar_one_or_none()
    if not alloc:
        raise HTTPException(status_code=404, detail="IMT Allocation not found")
    return _imt_to_dict(alloc)


@router.post("/")
async def create_imt_allocation(data: dict, db: AsyncSession = Depends(get_db)):
    """Create a new IMT allocation request."""
    # Convert center_lat/center_lon to area_wkt if not provided
    if "area_wkt" not in data and "center_lat" in data and "center_lon" in data:
        lat, lon = data["center_lat"], data["center_lon"]
        radius = data.get("cell_radius", 500)
        # Simple square WKT around center
        dlat = radius / 111320.0  # meters to degrees lat
        dlon = radius / (111320.0 * abs(lat / 90.0 + 1e-9)) if abs(lat) > 1e-6 else radius / 111320.0
        data["area_wkt"] = (
            f"POLYGON(({lon-dlon} {lat-dlat},{lon+dlon} {lat-dlat},"
            f"{lon+dlon} {lat+dlat},{lon-dlon} {lat+dlat},{lon-dlon} {lat-dlat}))"
        )
    
    alloc = IMTAllocation(**{k: v for k, v in data.items() if hasattr(IMTAllocation, k)})
    db.add(alloc)
    await db.commit()
    await db.refresh(alloc)
    return _imt_to_dict(alloc)


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
    return _imt_to_dict(alloc)


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


def _imt_to_dict(a: IMTAllocation) -> dict:
    # Extract center from WKT area_wkt
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
        "blocks": [],  # populated by spectrum_blocks query if needed
    }


def _extract_center_from_wkt(wkt: str) -> tuple:
    """Extract center lat/lon from WKT POLYGON string.
    Takes the centroid of the polygon as the center point."""
    try:
        # Simple WKT parser: "POLYGON((lon lat,lon lat,...))"
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
    return 13.75, 100.5  # default Bangkok
