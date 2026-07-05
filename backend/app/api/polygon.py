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
    
    - ถ้า polygon เล็ก/เรียบง่าย → single tower (ใช้ centroid)
    - ถ้า polygon ใหญ่/รูปแปลก → multi-tower (hexagonal grid)
    """
    try:
        geojson = {
            "type": req.polygon.type,
            "coordinates": req.polygon.coordinates,
        }
        result = pack_circles(geojson, req.cell_radius_m)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Circle packing failed: {str(e)}")
