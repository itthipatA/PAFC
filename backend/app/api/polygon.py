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
    # Grid search: try multiple radii and pick best (min overspill, max coverage)
    grid_search: bool = False


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
        rf_mode = req.use_rf_radius
        
        # Grid search: try multiple radii, pick best 100% coverage with min overspill
        if req.grid_search:
            base_radius = cell_radius
            radii_to_try = [base_radius * 0.5, base_radius * 0.7, base_radius * 0.85,
                           base_radius, base_radius * 1.2, base_radius * 1.5, base_radius * 2.0]
            radii_to_try = [max(5, min(2000, r)) for r in radii_to_try]
            radii_to_try = sorted(set(radii_to_try))
            
            import time
            from app.services.circle_packing import _polygon_area_sqm, _extract_polygon_vertices
            vertices = _extract_polygon_vertices(geojson)
            poly_area = _polygon_area_sqm(vertices)
            
            best_score = -1
            best_result = result
            grid_log = []
            
            for r in radii_to_try:
                t0 = time.time()
                candidate = pack_circles(geojson, r, optimize=True, animate=False)
                elapsed = (time.time() - t0) * 1000
                
                cov = candidate["coverage_pct"] / 100
                num = candidate["num_required"]
                total_circle_area = num * 3.14159 * (r ** 2)
                overspill = max(0, (total_circle_area - poly_area) / poly_area) if poly_area > 0 else 1
                tower_score = 1.0 / max(num, 1)
                score = cov * 0.5 + (1 - min(overspill, 2)) * 0.3 + tower_score * 0.2
                
                entry = (
                    f"r={r:6.0f}m | {num:3d} ต้น | cov={cov*100:5.1f}% | "
                    f"overspill={overspill*100:4.0f}% | score={score:.3f} | {elapsed:.0f}ms"
                )
                grid_log.append(entry)
                
                # MUST have ≥99.5% coverage (essentially 100%)
                if cov >= 0.995 and score > best_score:
                    best_score = score
                    best_result = candidate
            
            # Re-run best with animation if needed
            if req.animate and best_result.get("cell_radius_m", 0) != cell_radius:
                best_result = pack_circles(geojson, best_result["cell_radius_m"], 
                                           optimize=True, animate=True)
            
            result = best_result
            result["grid_search"] = True
            result["grid_search_log"] = grid_log
            result["rf_radius"] = rf_mode  # preserve RF mode flag
            print(f"[grid_search] BEST: r={result['cell_radius_m']:.0f}m, {result['num_required']} towers, "
                  f"cov={result['coverage_pct']}%, score={best_score:.3f}")
        
        if not req.grid_search:
            result["rf_radius"] = rf_mode
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Circle packing failed: {str(e)}")
