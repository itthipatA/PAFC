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
    cell_radius_m: float = 0  # รัศมี coverage ต่อ 1 เสา (เมตร). 0 = auto from geometry
    animate: bool = False  # return animation steps for frontend playback
    # RF-aware mode: calculate radius from link budget instead of geometry
    use_rf_radius: bool = False
    eirp_dbm: float = 23        # EIRP for RF radius calculation
    model_name: str = "free_space"
    antenna_height_m: float = 15
    indoor_pct: float = 0       # 0-100


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
    
    Two modes:
    - Geometry mode (default): cell_radius_m = auto from polygon area (Shoelace)
    - RF mode (use_rf_radius=True): cell_radius = achievable radius from link budget
    
    Ref: Nurmela & Östergård (2000) "Covering a Polygon with Equal Circles"
    """
    try:
        geojson = {
            "type": req.polygon.type,
            "coordinates": req.polygon.coordinates,
        }
        
        cell_radius = req.cell_radius_m
        
        # RF-aware mode: calculate achievable radius from link budget
        if req.use_rf_radius:
            from app.services.coverage import CoverageEngine
            building_loss_db = (req.indoor_pct / 100) * 20  # Phase 29
            
            engine = CoverageEngine(propagation_model=req.model_name)
            cell_radius = engine.calculate_achievable_radius(
                eirp_dbm=req.eirp_dbm,
                bs_antenna_height_m=req.antenna_height_m,
                bs_antenna_gain_dbi=0,  # already in EIRP
                building_loss_db=building_loss_db,
            )
            print(f"[pack_circles] RF mode: EIRP={req.eirp_dbm}dBm, model={req.model_name}, "
                  f"height={req.antenna_height_m}m, indoor={req.indoor_pct}% → radius={cell_radius:.1f}m")
        
        result = pack_circles(geojson, cell_radius, animate=req.animate)
        result["rf_radius"] = req.use_rf_radius
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Circle packing failed: {str(e)}")
