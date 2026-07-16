"""
IMT Allocations — CRUD API (Phase 37)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.db.database import get_db
from app.models.imt import IMTAllocation, SpectrumBlock

router = APIRouter()


@router.get("/")
async def list_imt_allocations(
    status: str = None,
    db: AsyncSession = Depends(get_db),
):
    """List all IMT allocations with their spectrum blocks."""
    query = select(IMTAllocation)
    if status:
        query = query.where(IMTAllocation.status == status)
    query = query.order_by(IMTAllocation.created_at.desc())
    
    result = await db.execute(query)
    allocations = result.scalars().all()
    
    # Pre-fetch blocks
    blocks_by_alloc = {}
    for a in allocations:
        sb_result = await db.execute(
            select(SpectrumBlock).where(SpectrumBlock.allocation_id == a.id)
        )
        blocks_by_alloc[str(a.id)] = sb_result.scalars().all()
    
    return {
        "allocations": [_imt_to_dict(a, blocks_by_alloc.get(str(a.id), [])) for a in allocations],
        "count": len(allocations),
    }


@router.delete("/{allocation_id}")
async def delete_imt(allocation_id: str, db: AsyncSession = Depends(get_db)):
    """Delete an IMT allocation and its blocks."""
    await db.execute(
        delete(SpectrumBlock).where(SpectrumBlock.allocation_id == allocation_id)
    )
    await db.execute(
        delete(IMTAllocation).where(IMTAllocation.id == allocation_id)
    )
    await db.commit()
    return {"status": "deleted"}


def _imt_to_dict(a: IMTAllocation, blocks: list) -> dict:
    return {
        "id": str(a.id),
        "name": a.name,
        "operator": a.operator,
        "area_wkt": a.area_wkt,
        "frame_structure": a.frame_structure,
        "polygon_geojson": a.polygon_geojson,
        "status": a.status,
        "blocks": [
            {
                "freq_low": b.freq_low,
                "freq_high": b.freq_high,
                "status": b.status,
            }
            for b in blocks
        ],
        "created_at": str(a.created_at) if a.created_at is not None else None,
    }
