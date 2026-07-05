"""
Circle Packing Service — PAFC Phase 33

วาง coverage circles ภายใน polygon รูปที่ดิน (โฉนด)
Algorithm: Hexagonal grid packing + Chebyshev center (single-tower)

ใช้หลัก: ระยะห่างระหว่าง center จุด = cell_radius * sqrt(3) (hexagonal close-packing)
"""

import math
from typing import List, Tuple, Dict, Any

# Earth's mean radius in meters
EARTH_RADIUS_M = 6_371_000


# ── Geometry Primitives ────────────────────────────────────────────

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """ระยะห่างระหว่าง 2 จุดผิวโลก (เมตร) — Haversine formula"""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _latlon_offset(lat: float, lon: float, dx_east_m: float, dy_north_m: float) -> Tuple[float, float]:
    """เลื่อนจุด lat/lon ไป dx เมตรตะวันออก, dy เมตรเหนือ"""
    cos_lat = math.cos(math.radians(lat))
    dlat = math.degrees(dy_north_m / EARTH_RADIUS_M)
    dlon = math.degrees(dx_east_m / (EARTH_RADIUS_M * max(cos_lat, 0.0001)))
    return (lat + dlat, lon + dlon)


def _point_in_polygon(lat: float, lon: float, vertices: List[Tuple[float, float]]) -> bool:
    """Ray-casting algorithm — ตรวจสอบว่าจุดอยู่ใน polygon หรือไม่"""
    n = len(vertices)
    inside = False
    j = n - 1
    for i in range(n):
        yi, xi = vertices[i]   # (lat, lon)
        yj, xj = vertices[j]
        if ((xi > lon) != (xj > lon)) and \
           (lat < (yj - yi) * (lon - xi) / (xj - xi) + yi):
            inside = not inside
        j = i
    return inside


def _point_to_segment_m(
    lat_p: float, lon_p: float,
    lat_a: float, lon_a: float,
    lat_b: float, lon_b: float,
) -> float:
    """ระยะสั้นสุดจากจุดไปยังส่วนของเส้นตรง (เมตร)"""
    ref_lat = (lat_a + lat_b) / 2
    cos_lat = math.cos(math.radians(ref_lat))
    scale_lat = EARTH_RADIUS_M * math.pi / 180
    scale_lon = scale_lat * max(cos_lat, 0.0001)

    px, py = lon_p * scale_lon, lat_p * scale_lat
    ax, ay = lon_a * scale_lon, lat_a * scale_lat
    bx, by = lon_b * scale_lon, lat_b * scale_lat

    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.sqrt((px - ax) ** 2 + (py - ay) ** 2)

    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    proj_x = ax + t * dx
    proj_y = ay + t * dy
    return math.sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)


# ── GeoJSON Utils ──────────────────────────────────────────────────

def _extract_polygon_vertices(geojson: Dict[str, Any]) -> List[Tuple[float, float]]:
    """แกะ exterior ring จาก GeoJSON Polygon → [(lat, lon), ...]"""
    coords = geojson["coordinates"][0]
    return [(c[1], c[0]) for c in coords]


# ── Chebyshev Center (จุดกึ่งกลางที่ไกลจากขอบที่สุด) ───────────────

def _chebyshev_center(
    vertices: List[Tuple[float, float]],
    grid_res: int = 20,
    iterations: int = 3,
) -> Tuple[float, float]:
    """
    หาจุดใน polygon ที่ maximize ระยะห่างจากขอบ (pole of inaccessibility)
    ใช้ iterative grid refinement — 3 รอบ refining
    """
    lats = [v[0] for v in vertices]
    lons = [v[1] for v in vertices]

    # Start from centroid
    best_lat = sum(lats) / len(lats)
    best_lon = sum(lons) / len(lons)
    best_min_dist = -1.0

    for iteration in range(iterations):
        factor = 2 ** iteration
        step_lat = (max(lats) - min(lats)) / (grid_res * factor)
        step_lon = (max(lons) - min(lons)) / (grid_res * factor)

        half = grid_res / 2
        search_min_lat = best_lat - step_lat * half
        search_min_lon = best_lon - step_lon * half

        for i in range(grid_res):
            for j in range(grid_res):
                lat = search_min_lat + i * step_lat
                lon = search_min_lon + j * step_lon
                if not _point_in_polygon(lat, lon, vertices):
                    continue

                # หาระยะสั้นสุดไปยังทุกขอบ
                min_dist = float("inf")
                n = len(vertices)
                for vi in range(n):
                    vj = (vi + 1) % n
                    d = _point_to_segment_m(
                        lat, lon,
                        vertices[vi][0], vertices[vi][1],
                        vertices[vj][0], vertices[vj][1],
                    )
                    min_dist = min(min_dist, d)

                if min_dist > best_min_dist:
                    best_min_dist = min_dist
                    best_lat = lat
                    best_lon = lon

    return (best_lat, best_lon)


def _min_distance_to_boundary(
    lat_p: float, lon_p: float,
    vertices: List[Tuple[float, float]],
) -> float:
    """ระยะสั้นสุดจากจุดไปยังขอบ polygon (เมตร)"""
    min_dist = float("inf")
    n = len(vertices)
    for i in range(n):
        j = (i + 1) % n
        d = _point_to_segment_m(
            lat_p, lon_p,
            vertices[i][0], vertices[i][1],
            vertices[j][0], vertices[j][1],
        )
        min_dist = min(min_dist, d)
    return min_dist


# ── Coverage Calculation ───────────────────────────────────────────

def _circle_fraction_in_polygon(
    lat_c: float, lon_c: float,
    radius_m: float,
    vertices: List[Tuple[float, float]],
    samples: int = 12,
) -> float:
    """สัดส่วนของวงกลมที่อยู่ใน polygon (สุ่ม sample จุดบนเส้นรอบวง)"""
    inside = 0
    for i in range(samples):
        angle = 2 * math.pi * i / samples
        dlat_m = radius_m * 0.6 * math.sin(angle)
        dlon_m = radius_m * 0.6 * math.cos(angle)
        lat_s, lon_s = _latlon_offset(lat_c, lon_c, dlon_m, dlat_m)
        if _point_in_polygon(lat_s, lon_s, vertices):
            inside += 1
    return inside / samples


def _calculate_coverage(
    points: List[Dict[str, Any]],
    radius_m: float,
    vertices: List[Tuple[float, float]],
    grid_samples: int = 300,
) -> float:
    """คำนวณ % พื้นที่ polygon ที่ถูก cover โดย circles"""
    lats = [v[0] for v in vertices]
    lons = [v[1] for v in vertices]

    n_per_axis = int(math.sqrt(grid_samples))
    lat_step = (max(lats) - min(lats)) / n_per_axis if n_per_axis > 0 else 0.001
    lon_step = (max(lons) - min(lons)) / n_per_axis if n_per_axis > 0 else 0.001

    covered = 0
    total = 0

    lat = min(lats) + lat_step / 2
    while lat <= max(lats):
        lon = min(lons) + lon_step / 2
        while lon <= max(lons):
            if _point_in_polygon(lat, lon, vertices):
                total += 1
                for p in points:
                    if haversine_distance(lat, lon, p["lat"], p["lon"]) <= radius_m:
                        covered += 1
                        break
            lon += lon_step
        lat += lat_step

    return covered / max(total, 1)


# ── Main Algorithm ─────────────────────────────────────────────────

def pack_circles(
    geojson: Dict[str, Any],
    cell_radius_m: float,
) -> Dict[str, Any]:
    """
    วาง coverage circles ภายใน polygon

    Returns:
        {
            "points": [{"lat": ..., "lon": ..., "type": "packed"}, ...],
            "num_required": จำนวนเสาที่ต้องใช้,
            "coverage_pct": % พื้นที่ที่ cover ได้,
            "cell_radius_m": รัศมีต่อเสา,
            "centroid": {
                "lat": ..., "lon": ...,
                "max_cover_radius_m": รัศมีใหญ่สุดที่ centroid cover ได้
            },
            "centroid_coverage_pct": % cover เมื่อใช้เสาเดียวที่ centroid,
            "recommendation": "single" | "multi"
        }
    """
    vertices = _extract_polygon_vertices(geojson)

    # 1. Find Chebyshev center (สำหรับ single-tower case)
    centroid = _chebyshev_center(vertices)
    max_radius = _min_distance_to_boundary(centroid[0], centroid[1], vertices)

    # 2. Hexagonal grid packing
    spacing = cell_radius_m * math.sqrt(3)  # ~1.732 × radius

    ref_lat = sum(v[0] for v in vertices) / len(vertices)
    cos_lat = max(math.cos(math.radians(ref_lat)), 0.0001)
    dlat_deg = math.degrees(spacing / EARTH_RADIUS_M)
    dlon_deg = math.degrees(spacing / (EARTH_RADIUS_M * cos_lat))

    lats = [v[0] for v in vertices]
    lons = [v[1] for v in vertices]

    points: List[Dict[str, Any]] = []
    row = 0
    lat = min(lats) - dlat_deg
    while lat <= max(lats) + dlat_deg:
        offset = (dlon_deg / 2) if (row % 2 == 1) else 0.0
        lon = min(lons) - dlon_deg + offset
        while lon <= max(lons) + dlon_deg:
            if _point_in_polygon(lat, lon, vertices):
                frac = _circle_fraction_in_polygon(lat, lon, cell_radius_m, vertices)
                if frac > 0.2:  # วงกลมอย่างน้อย 20% อยู่ใน polygon
                    points.append({
                        "lat": round(lat, 7),
                        "lon": round(lon, 7),
                        "type": "packed",
                    })
            lon += dlon_deg
        row += 1
        lat += dlat_deg

    # 3. Coverage calculation
    coverage_pct = _calculate_coverage(points, cell_radius_m, vertices)
    centroid_pct = _calculate_coverage(
        [{"lat": centroid[0], "lon": centroid[1], "type": "centroid"}],
        cell_radius_m,
        vertices,
    )

    recommendation = "single" if coverage_pct >= 95 and len(points) <= 1 else "multi"

    return {
        "points": points,
        "num_required": len(points),
        "coverage_pct": round(coverage_pct * 100, 1),
        "cell_radius_m": cell_radius_m,
        "centroid": {
            "lat": round(centroid[0], 7),
            "lon": round(centroid[1], 7),
            "max_cover_radius_m": round(max_radius, 1),
        },
        "centroid_coverage_pct": round(centroid_pct * 100, 1),
        "recommendation": recommendation,
    }
