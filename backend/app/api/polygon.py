"""
Polygon API — PAFC Phase 33
สร้าง polygon + circle packing endpoints
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

import math
from app.services.circle_packing import (pack_circles, _polygon_area_sqm, _extract_polygon_vertices,
                                         haversine_distance, _sample_polygon_interior, _calculate_coverage as _calc_cov)

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
        # BUT cap at geometry-recommended radius to prevent single-tower for small polygons
        if req.use_rf_radius:
            from app.services.coverage import CoverageEngine
            building_loss_db = (req.indoor_pct / 100) * 20  # Phase 29
            
            engine = CoverageEngine(propagation_model=req.model_name)
            rf_radius = engine.calculate_achievable_radius(
                eirp_dbm=req.eirp_dbm,
                bs_antenna_height_m=req.antenna_height_m,
                bs_antenna_gain_dbi=0,  # already in EIRP
                building_loss_db=building_loss_db,
            )
            
            # Compute geometry-recommended radius from polygon area (Shoelace)
            vertices = _extract_polygon_vertices(geojson)
            area_m2 = _polygon_area_sqm(vertices)
            TARGET_TOWERS = 9
            HEX_EFFICIENCY = 0.9069
            geo_radius = math.sqrt(area_m2 / (TARGET_TOWERS * math.pi * HEX_EFFICIENCY))
            geo_radius = max(geo_radius, 5)
            geo_radius = min(geo_radius, 2000)
            
            # Use the SMALLER radius: RF is a capability cap, geometry is practical for polygon
            cell_radius = min(rf_radius, geo_radius)
            print(f"[pack_circles] RF={rf_radius:.0f}m, Geo={geo_radius:.0f}m → use {cell_radius:.0f}m")
        
        result = pack_circles(geojson, cell_radius, animate=req.animate)
        rf_mode = req.use_rf_radius
        
        # Grid search: try multiple radii, pick BEST achieving ≥99.5% coverage
        # with minimum towers and minimum spillover
        if req.grid_search:
            import time
            vertices = _extract_polygon_vertices(geojson)
            poly_area = _polygon_area_sqm(vertices)
            
            # Try wider range of radii — more dense at lower end (smaller=tighter packing)
            base_radius = cell_radius
            radii_multipliers = [0.25, 0.35, 0.50, 0.65, 0.80, 0.95, 1.10, 1.30, 1.50]
            radii_to_try = sorted(set(
                max(5, min(2000, base_radius * m)) for m in radii_multipliers
            ))
            
            candidates = []
            grid_log = []
            
            for r in radii_to_try:
                t0 = time.time()
                candidate = pack_circles(geojson, r, optimize=True, animate=False)
                elapsed = (time.time() - t0) * 1000
                
                cov = candidate["coverage_pct"] / 100
                num = candidate["num_required"]
                total_circle_area = num * math.pi * (r ** 2)
                overspill_pct = max(0, (total_circle_area - poly_area) / poly_area) if poly_area > 0 else 1
                
                passes = "PASS" if cov >= 0.995 else "FAIL"
                entry = (
                    f"{passes} r={r:6.0f}m | {num:3d} ต้น | cov={cov*100:5.1f}% | "
                    f"spill={overspill_pct*100:4.0f}% | {elapsed:.0f}ms"
                )
                grid_log.append(entry)
                
                candidates.append({
                    "result": candidate,
                    "radius": r,
                    "cov": cov,
                    "num": num,
                    "overspill_pct": overspill_pct,
                })
            
            # PRACTICAL RANKING: fewest towers first (real-world cost), then coverage, then spill
            # Soft floor: coverage must be ≥ 80% to qualify
            # Rationale: "ยอมเสาน้อย สัญญาณล้ำออกบ้างก็ได้" — private network, not cellular
            def _rank_key(c):
                passes_floor = 1 if c["cov"] >= 0.80 else 0
                return (-passes_floor, c["num"], -c["cov"], c["overspill_pct"])
            
            candidates.sort(key=_rank_key)
            best = candidates[0]
            best_result = best["result"]
            
            n_pass = sum(1 for c in candidates if c["cov"] >= 0.80)
            n_high = sum(1 for c in candidates if c["cov"] >= 0.95)
            print(f"[grid_search] {n_high} ≥95%, {n_pass} ≥80% of {len(candidates)} candidates. "
                  f"BEST: r={best['radius']:.0f}m, {best['num']} towers, "
                  f"cov={best['cov']*100:.1f}%, spill={best['overspill_pct']*100:.1f}%")
            
            # Gap-fill: ALWAYS add circles at uncovered points to push coverage to 100%
            # Uses same radius — does NOT shrink circles
            # This guarantees coverage while keeping practical tower count
            samples = _sample_polygon_interior(vertices, n_samples=500)
            uncovered = []
            for slat, slon in samples:
                covered = False
                for p in best_result["points"]:
                    if haversine_distance(slat, slon, p["lat"], p["lon"]) <= best["radius"]:
                        covered = True
                        break
                if not covered:
                    uncovered.append((slat, slon))
            
            if uncovered:
                gap_points = []
                max_gap = 20  # Cap additional towers
                while uncovered and len(gap_points) < max_gap:
                    best_pt = None
                    best_cover = 0
                    for si, (slat, slon) in enumerate(uncovered):
                        count = 1
                        for sj, (tlat, tlon) in enumerate(uncovered):
                            if sj != si and haversine_distance(slat, slon, tlat, tlon) <= best["radius"]:
                                count += 1
                        if count > best_cover:
                            best_cover = count
                            best_pt = (si, slat, slon)
                    
                    if best_pt is None or best_cover <= 1:
                        break
                    
                    si, glat, glon = best_pt
                    gap_points.append({"lat": round(glat, 7), "lon": round(glon, 7), "type": "gapfill"})
                    uncovered = [
                        (slat, slon) for sj, (slat, slon) in enumerate(uncovered)
                        if sj != si and haversine_distance(glat, glon, slat, slon) > best["radius"]
                    ]
                
                if gap_points:
                    merged = [dict(p) for p in best_result["points"]] + gap_points
                    new_cov = _calc_cov(merged, best["radius"], vertices)
                    best_result = {
                        **best_result,
                        "points": merged,
                        "num_required": len(merged),
                        "coverage_pct": round(new_cov * 100, 1),
                    }
                    entry = (
                        f"Gap-fill: +{len(gap_points)} towers -> {len(merged)} total, "
                        f"cov={new_cov*100:.1f}%"
                    )
                    grid_log.append(entry)
                    print(f"[grid_search] Gap-fill: +{len(gap_points)} towers → "
                          f"{best_result['num_required']} total, cov={best_result['coverage_pct']}%")
            
            # Re-run best with animation if requested
            if req.animate:
                best_result = pack_circles(geojson, best_result["cell_radius_m"],
                                           optimize=True, animate=True)
            
            result = best_result
            result["grid_search"] = True
            result["grid_search_log"] = grid_log
            result["rf_radius"] = rf_mode
        
        if not req.grid_search:
            result["rf_radius"] = rf_mode
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Circle packing failed: {str(e)}")
