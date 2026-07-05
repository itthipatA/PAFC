"""
Polygon API — PAFC Phase 33
สร้าง polygon + circle packing endpoints
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

from app.services.circle_packing import pack_circles

router = APIRouter()


class PolygonGeoJSON(BaseModel):
    type: str = "Polygon"
    coordinates: List[List[List[float]]]  # [[[lon, lat], ...]]


class PackCirclesRequest(BaseModel):
    polygon: PolygonGeoJSON
    cell_radius_m: float  # รัศมี coverage ต่อ 1 เสา (เมตร)
    animate: bool = False  # return animation steps for frontend playback


class CirclePoint(BaseModel):
    lat: float
    lon: float
    type: str  # "packed" | "centroid"


class CentroidInfo(BaseModel):
    lat: float
    lon: float
    max_cover_radius_m: float


class PackCirclesResponse(BaseModel):
    points: List[CirclePoint]
    num_required: int
    coverage_pct: float
    cell_radius_m: float
    centroid: CentroidInfo
    centroid_coverage_pct: float
    recommendation: str  # "single" | "multi"


@router.post("/pack-circles", response_model=PackCirclesResponse)
async def pack_circles_endpoint(req: PackCirclesRequest):
    """
    คำนวณตำแหน่งวาง Base Station ให้ cover polygon ทั้งหมด
    
    Algorithm: "Hex-Init GRILS + SA"
    1. Auto-calculate cell_radius จากพื้นที่ polygon (Shoelace formula) 
       ถ้า cell_radius_m <= 0
    2. Hex Grid — วาง honeycomb pattern ครอบคลุม polygon
    3. Greedy Removal — ตัดจุดซ้ำซ้อนที่ coverage ลด <0.5%
    4. Gap Fill — revert ถ้า coverage ต่ำกว่า 99%
    5. Local Shift — ปรับตำแหน่ง 8 ทิศ 3 passes
    6. Simulated Annealing — หลุด local minima ด้วย Metropolis criterion
    
    Ref: Nurmela & Östergård (2000) "Covering a Polygon with Equal Circles"
    """
    try:
        geojson = {
            "type": req.polygon.type,
            "coordinates": req.polygon.coordinates,
        }
        result = pack_circles(geojson, req.cell_radius_m, animate=req.animate)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Circle packing failed: {str(e)}")
