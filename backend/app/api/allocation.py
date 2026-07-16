"""
Spectrum Allocation API — PAFC Phase 37

POST /api/allocate/analyze          → Full allocation analysis (FS -120dBm + IMT 100m + Frame Structure)
POST /api/allocate/save             → Save allocation with selected blocks + guard band
GET  /api/allocate/list             → List existing allocations
GET  /api/allocate/frame-options    → Available TDD frame structures
DELETE /api/allocate/{id}           → Delete allocation
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.db.database import get_db
from app.models.imt import IMTAllocation, SpectrumBlock
from app.services.allocation_engine import AllocationEngine
from app.services.frame_structure import get_frame_structure_options
from app.services.imt_buffer import parse_polygon_coords
import uuid
import json
from datetime import date

router = APIRouter()


@router.post("/analyze")
async def analyze_allocation(data: dict, db: AsyncSession = Depends(get_db)):
    """
    Full allocation analysis with Phase 37 engine.
    
    Request body:
    {
        "polygon_geojson": {...},          // GeoJSON Polygon — IMT land area
        "frame_structure": "DDDSU",        // TDD frame configuration
        "name": "โรงงาน A",               // site name (optional for preview)
        "operator": "บริษัท เอกชน จำกัด"  // operator name (optional for preview)
    }
    
    Response:
    {
        "blocks": [
            {
                "freq_low": 4800, "freq_high": 4810, "index": 0,
                "status": "available" | "blocked_by_fs" | "blocked_by_imt",
                "blocked_by": [...],
                "reason_th": "คำอธิบายภาษาไทย",
                "can_be_guard": false, "guard_reason_th": ""
            }
        ],
        "narrative_log": ["บรรทัดที่ 1", "บรรทัดที่ 2", ...],
        "summary": "สรุปผล",
        "existing_imt_count": 3,
        "existing_fs_count": 5,
        "selected_frame_structure": "DDDSU"
    }
    """
    polygon_geojson = data.get("polygon_geojson")
    if not polygon_geojson:
        raise HTTPException(status_code=400, detail="polygon_geojson is required")
    
    frame_structure = data.get("frame_structure", "DDDSU")
    name = data.get("name", "")
    operator = data.get("operator", "")
    
    # Validate polygon
    try:
        coords = parse_polygon_coords(polygon_geojson)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot parse polygon: {e}")
    
    if len(coords) < 3:
        raise HTTPException(status_code=400, detail="Polygon must have at least 3 vertices")
    
    # Run allocation engine
    engine = AllocationEngine(db)
    result = await engine.analyze(
        polygon_geojson=polygon_geojson,
        frame_structure=frame_structure,
        name=name,
        operator=operator,
    )
    
    return {
        "blocks": [
            {
                "freq_low": b.freq_low,
                "freq_high": b.freq_high,
                "index": b.index,
                "status": b.status,
                "blocked_by": b.blocked_by,
                "reason_th": b.reason_th,
                "can_be_guard": b.can_be_guard,
                "guard_reason_th": b.guard_reason_th,
            }
            for b in result.blocks
        ],
        "narrative_log": result.narrative_log,
        "summary": result.summary,
        "existing_imt_count": result.existing_imt_count,
        "existing_fs_count": result.existing_fs_count,
        "selected_frame_structure": result.selected_frame_structure,
    }


@router.post("/save")
async def save_allocation(data: dict, db: AsyncSession = Depends(get_db)):
    """
    Save an IMT allocation with selected blocks + guard band designation.
    
    Request body:
    {
        "name": "โรงงาน A",
        "operator": "บริษัท เอกชน จำกัด",
        "polygon_geojson": {...},
        "frame_structure": "DDDSU",
        "selected_blocks": [
            {"freq_low": 4800, "freq_high": 4810, "status": "allocated"},
            {"freq_low": 4810, "freq_high": 4820, "status": "guard"},
            {"freq_low": 4830, "freq_high": 4840, "status": "allocated"}
        ]
    }
    """
    name = data.get("name", "").strip()
    operator = data.get("operator", "").strip()
    polygon_geojson = data.get("polygon_geojson")
    frame_structure = data.get("frame_structure", "DDDSU")
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
            coords = parse_polygon_coords(polygon_geojson)
        except Exception:
            pass
    
    if coords:
        wkt_coords = ", ".join(f"{c[0]} {c[1]}" for c in coords)
        wkt_coords += f", {coords[0][0]} {coords[0][1]}"
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
        antenna_height=15,  # default metadata
        max_eirp=23,         # default metadata
        frame_structure=frame_structure,
        polygon_geojson=json.dumps(polygon_geojson) if isinstance(polygon_geojson, dict) else polygon_geojson,
        status="active",
        valid_from=date.today(),
    )
    db.add(imt)
    
    # Create spectrum blocks with status (allocated/guard)
    for blk in selected_blocks:
        sb = SpectrumBlock(
            allocation_id=allocation_id,
            freq_low=float(blk["freq_low"]),
            freq_high=float(blk["freq_high"]),
            status=blk.get("status", "allocated"),
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
    """List all IMT allocations with spectrum blocks + frame structure."""
    query = select(IMTAllocation).order_by(IMTAllocation.created_at.desc())
    result = await db.execute(query)
    allocations = result.scalars().all()
    
    items = []
    for imt in allocations:
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
            "frame_structure": imt.frame_structure,
            "blocks": [
                {
                    "freq_low": b.freq_low,
                    "freq_high": b.freq_high,
                    "status": b.status,
                }
                for b in blocks
            ],
            "polygon_geojson": imt.polygon_geojson,
            "created_at": str(imt.created_at) if imt.created_at is not None else None,
        })
    
    return {"allocations": items, "count": len(items)}


@router.get("/frame-options")
async def get_frame_options():
    """Get available TDD frame structure options for UI dropdown."""
    return {
        "patterns": get_frame_structure_options()
    }


@router.delete("/{allocation_id}")
async def delete_allocation(allocation_id: str, db: AsyncSession = Depends(get_db)):
    """Delete an IMT allocation and its spectrum blocks."""
    await db.execute(
        delete(SpectrumBlock).where(SpectrumBlock.allocation_id == uuid.UUID(allocation_id))
    )
    await db.execute(
        delete(IMTAllocation).where(IMTAllocation.id == uuid.UUID(allocation_id))
    )
    await db.commit()
    
    return {"status": "deleted", "allocation_id": allocation_id}
