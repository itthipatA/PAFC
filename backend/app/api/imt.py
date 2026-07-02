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
    alloc = IMTAllocation(**data)
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
    return {
        "id": str(a.id),
        "name": a.name,
        "operator": a.operator,
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
    }
