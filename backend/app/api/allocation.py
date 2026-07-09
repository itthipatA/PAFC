"""
Spectrum Allocation API — PAFC Phase 36 (Simplified)

POST /api/allocate/check-availability → Channel availability (PN + FS LoS rules)
POST /api/allocate/save               → Save allocation with selected blocks
POST /api/allocate/list               → List existing allocations
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db
from app.models.imt import IMTAllocation, SpectrumBlock
from app.services.channel_checker import ChannelChecker, _parse_polygon_coords
import uuid
import json
from datetime import date

router = APIRouter()


@router.post("/check-availability")
async def check_availability(data: dict, db: AsyncSession = Depends(get_db)):
    """
    Check which 10 MHz blocks (4800-4990 MHz) are available.
    
    Request body:
    {
        "polygon_geojson": {...},       // GeoJSON Polygon
        "pn_buffer_km": 2.0             // optional, default 2.0 km
    }
    
    Response:
    {
        "blocks": [
            {"freq_low": 4800, "freq_high": 4810, "status": "available",
             "reason": "ว่าง — สามารถจัดสรรได้ (4800-4810 MHz)"},
            {"freq_low": 4810, "freq_high": 4820, "status": "blocked_by_fs",
             "blocked_by": ["FS: THAICOM-Link1 (THAICOM)"],
             "reason": "ไม่สามารถจัดสรร — FS Link ..."}
        ],
        "polygon_area_km2": 3.456,
        "pn_buffer_km": 2.0,
        "existing_imt_count": 3,
        "existing_fs_count": 5,
        "summary": "ตรวจสอบคลื่นความถี่ 4800-4990 MHz (19 ช่อง): ✅ ว่าง 15 ช่อง, 🔴 ติด PN 2 ช่อง, 🔴 ติด FS (LoS) 2 ช่อง"
    }
    """
    polygon_geojson = data.get("polygon_geojson")
    if not polygon_geojson:
        raise HTTPException(status_code=400, detail="polygon_geojson is required")
    
    pn_buffer_km = float(data.get("pn_buffer_km", 2.0))
    
    # Parse polygon coordinates
    try:
        coords = _parse_polygon_coords(polygon_geojson)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot parse polygon: {e}")
    
    if len(coords) < 3:
        raise HTTPException(status_code=400, detail="Polygon must have at least 3 vertices")
    
    # Run channel checker
    checker = ChannelChecker(db)
    result = await checker.check(
        polygon_coords=coords,
        pn_buffer_km=pn_buffer_km,
    )
    
    # Serialize
    return {
        "blocks": [
            {
                "freq_low": b.freq_low,
                "freq_high": b.freq_high,
                "status": b.status,
                "blocked_by": b.blocked_by,
                "reason": b.reason,
            }
            for b in result.blocks
        ],
        "polygon_area_km2": result.polygon_area_km2,
        "pn_buffer_km": result.pn_buffer_km,
        "existing_imt_count": result.existing_imt_count,
        "existing_fs_count": result.existing_fs_count,
        "summary": result.summary,
    }


@router.post("/save")
async def save_allocation(data: dict, db: AsyncSession = Depends(get_db)):
    """
    Save an IMT allocation with selected blocks.
    
    Request body:
    {
        "name": "โรงงาน A",
        "operator": "บริษัท เอกชน จำกัด",
        "polygon_geojson": {...},
        "selected_blocks": [
            {"freq_low": 4800, "freq_high": 4810},
            {"freq_low": 4820, "freq_high": 4830}
        ]
    }
    """
    name = data.get("name", "").strip()
    operator = data.get("operator", "").strip()
    polygon_geojson = data.get("polygon_geojson")
    selected_blocks = data.get("selected_blocks", [])
    
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not operator:
        raise HTTPException(status_code=400, detail="operator is required")
    if not selected_blocks:
        raise HTTPException(status_code=400, detail="selected_blocks is required")
    
    # Parse polygon for WKT
    coords = []
    if polygon_geojson:
        try:
            coords = _parse_polygon_coords(polygon_geojson)
        except Exception:
            pass
    
    # Create WKT from coords
    if coords:
        wkt_coords = ", ".join(f"{c[0]} {c[1]}" for c in coords)
        wkt_coords += f", {coords[0][0]} {coords[0][1]}"  # closing vertex
        area_wkt = f"POLYGON(({wkt_coords}))"
    else:
        area_wkt = "POLYGON((0 0, 0 0, 0 0, 0 0))"
    
    # Create IMT allocation
    allocation_id = uuid.uuid4()
    imt = IMTAllocation(
        id=allocation_id,
        name=name,
        operator=operator,
        area_wkt=area_wkt,
        cell_radius=500,  # default — not critical in simplified mode
        antenna_height=15,
        max_eirp=23,
        antenna_type="shape",
        polygon_geojson=json.dumps(polygon_geojson) if isinstance(polygon_geojson, dict) else polygon_geojson,
        status="active",
        valid_from=date.today(),
    )
    db.add(imt)
    
    # Create spectrum blocks
    for blk in selected_blocks:
        sb = SpectrumBlock(
            allocation_id=allocation_id,
            freq_low=float(blk["freq_low"]),
            freq_high=float(blk["freq_high"]),
            status="allocated",
        )
        db.add(sb)
    
    await db.commit()
    
    return {
        "status": "ok",
        "allocation_id": str(allocation_id),
        "name": name,
        "blocks_saved": len(selected_blocks),
    }


@router.get("/list")
async def list_allocations(db: AsyncSession = Depends(get_db)):
    """List all IMT allocations with their spectrum blocks."""
    query = select(IMTAllocation).order_by(IMTAllocation.created_at.desc())
    result = await db.execute(query)
    allocations = result.scalars().all()
    
    items = []
    for imt in allocations:
        # Get blocks for this allocation
        sb_query = select(SpectrumBlock).where(
            SpectrumBlock.allocation_id == imt.id
        )
        sb_result = await db.execute(sb_query)
        blocks = sb_result.scalars().all()
        
        items.append({
            "id": str(imt.id),
            "name": imt.name,
            "operator": imt.operator,
            "status": imt.status,
            "blocks": [
                {"freq_low": b.freq_low, "freq_high": b.freq_high}
                for b in blocks
            ],
            "polygon_geojson": imt.polygon_geojson,
            "created_at": str(imt.created_at) if imt.created_at is not None else None,
        })
    
    return {"allocations": items, "count": len(items)}


@router.delete("/{allocation_id}")
async def delete_allocation(allocation_id: str, db: AsyncSession = Depends(get_db)):
    """Delete an IMT allocation and its spectrum blocks."""
    from sqlalchemy import delete
    
    # Delete spectrum blocks first
    await db.execute(
        delete(SpectrumBlock).where(SpectrumBlock.allocation_id == uuid.UUID(allocation_id))
    )
    
    # Delete allocation
    result = await db.execute(
        delete(IMTAllocation).where(IMTAllocation.id == uuid.UUID(allocation_id))
    )
    await db.commit()
    
    return {"status": "deleted", "allocation_id": allocation_id}
