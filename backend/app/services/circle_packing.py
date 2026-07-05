"""
Circle Packing Service — PAFC Phase 33

วาง coverage circles ภายใน polygon รูปที่ดิน (โฉนด)

Algorithms:
- pack_circles() — default: GRILS (Greedy Randomized Iterated Local Search)
- pack_circles_hex() — fallback: hexagonal grid packing
- Chebyshev center — single-tower optimal point
"""

import math
import random
from typing import List, Tuple, Dict, Any, Set

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


# ── Polygon Sampling ────────────────────────────────────────────────

def _sample_polygon_interior(
    vertices: List[Tuple[float, float]],
    n_samples: int = 500,
) -> List[Tuple[float, float]]:
    """
    สุ่มจุดภายใน polygon เพื่อใช้ตรวจสอบ coverage
    ใช้ stratified grid sampling — แม่นยำกว่า random
    """
    lats = [v[0] for v in vertices]
    lons = [v[1] for v in vertices]
    
    n_per_axis = int(math.sqrt(n_samples))
    lat_step = (max(lats) - min(lats)) / n_per_axis
    lon_step = (max(lons) - min(lons)) / n_per_axis
    
    samples = []
    lat = min(lats) + lat_step / 2
    for _ in range(n_per_axis):
        lon = min(lons) + lon_step / 2
        for _ in range(n_per_axis):
            if _point_in_polygon(lat, lon, vertices):
                samples.append((lat, lon))
            lon += lon_step
        lat += lat_step
    
    # Pad with random if not enough
    if len(samples) < 10:
        for _ in range(n_samples):
            lat = min(lats) + random.random() * (max(lats) - min(lats))
            lon = min(lons) + random.random() * (max(lons) - min(lons))
            if _point_in_polygon(lat, lon, vertices):
                samples.append((lat, lon))
    
    return samples


def _generate_candidate_grid(
    vertices: List[Tuple[float, float]],
    cell_radius_m: float,
    density: float = 0.35,
) -> List[Tuple[float, float]]:
    """
    สร้าง candidate grid ละเอียดภายใน polygon
    spacing = cell_radius * density (default 0.35 → dense enough for optimal)
    """
    spacing = cell_radius_m * density
    
    lats = [v[0] for v in vertices]
    lons = [v[1] for v in vertices]
    
    ref_lat = sum(lats) / len(lats)
    cos_lat = max(math.cos(math.radians(ref_lat)), 0.0001)
    dlat_deg = math.degrees(spacing / EARTH_RADIUS_M)
    dlon_deg = math.degrees(spacing / (EARTH_RADIUS_M * cos_lat))
    
    candidates = []
    lat = min(lats) - dlat_deg
    while lat <= max(lats) + dlat_deg:
        lon = min(lons) - dlon_deg
        while lon <= max(lons) + dlon_deg:
            if _point_in_polygon(lat, lon, vertices):
                candidates.append((lat, lon))
            lon += dlon_deg
        lat += dlat_deg
    
    return candidates


def _build_coverage_sets(
    candidates: List[Tuple[float, float]],
    samples: List[Tuple[float, float]],
    cell_radius_m: float,
) -> List[Set[int]]:
    """
    Precompute: แต่ละ candidate cover sample indices ไหนบ้าง
    Returns: list of sets ของ sample indices
    """
    coverage = []
    for clat, clon in candidates:
        covered = set()
        for si, (slat, slon) in enumerate(samples):
            if haversine_distance(clat, clon, slat, slon) <= cell_radius_m:
                covered.add(si)
        coverage.append(covered)
    return coverage


# ── GRILS: Greedy Randomized Iterated Local Search ──────────────────

def _greedy_set_cover(
    coverage_sets: List[Set[int]],
    n_samples: int,
    target_pct: float = 0.95,
    shuffle: bool = False,
) -> List[int]:
    """
    เลือก candidates แบบ greedy — แต่ละ step เลือกตัวที่ cover uncovered samples มากที่สุด
    
    Args:
        coverage_sets: list of sets of sample indices per candidate
        n_samples: total number of samples
        target_pct: stop when coverage >= target_pct
        shuffle: if True, randomize tie-breaking (for multi-start)
    
    Returns: list of selected candidate indices
    """
    uncovered = set(range(n_samples))
    selected = []
    
    target_covered = int(n_samples * target_pct)
    
    # Create index list for candidates
    indices = list(range(len(coverage_sets)))
    if shuffle:
        random.shuffle(indices)
    
    while len(uncovered) > (n_samples - target_covered):
        best_idx = -1
        best_cover = 0
        
        for ci in indices:
            if ci in selected:
                continue
            cover_count = len(coverage_sets[ci] & uncovered)
            if cover_count > best_cover:
                best_cover = cover_count
                best_idx = ci
                if cover_count == len(uncovered):  # can't beat this
                    break
        
        if best_cover == 0:
            break  # no more coverage possible
        
        selected.append(best_idx)
        uncovered -= coverage_sets[best_idx]
    
    return selected


def _remove_redundant(
    selected: List[int],
    coverage_sets: List[Set[int]],
    n_samples: int,
    target_pct: float = 0.95,
) -> List[int]:
    """
    ลองถอดแต่ละวงกลม — ถ้า coverage ไม่หล่นต่ำกว่า target → ถาวร
    """
    target_covered = int(n_samples * target_pct)
    current = set(selected)
    
    improved = True
    while improved:
        improved = False
        for ci in list(current):
            # Check coverage without this circle
            test = current - {ci}
            covered = set()
            for cj in test:
                covered |= coverage_sets[cj]
            if len(covered) >= target_covered:
                current = test
                improved = True
                break  # restart scan after removal
    
    return list(current)


def _local_improve(
    selected: List[int],
    coverage_sets: List[Set[int]],
    n_samples: int,
    candidates: List[Tuple[float, float]],
    target_pct: float = 0.95,
    max_iter: int = 50,
) -> List[int]:
    """
    Local search: ลองสลับวงกลมออก + เพิ่มวงใหม่ที่ดีกว่า
    """
    target_covered = int(n_samples * target_pct)
    current = set(selected)
    
    # Compute initial coverage
    def compute_coverage(indices: Set[int]) -> Set[int]:
        covered = set()
        for ci in indices:
            covered |= coverage_sets[ci]
        return covered
    
    current_covered = compute_coverage(current)
    
    all_indices = set(range(len(candidates)))
    unused = all_indices - current
    
    for _ in range(max_iter):
        improved = False
        
        # Try removing one + adding one that covers more
        for ri in list(current):
            test = current - {ri}
            test_covered = compute_coverage(test)
            
            # Find best replacement
            best_ci = -1
            best_gain = len(test_covered)
            
            for ci in unused:
                new_covered = test_covered | coverage_sets[ci]
                if len(new_covered) > best_gain:
                    best_gain = len(new_covered)
                    best_ci = ci
            
            if best_ci >= 0 and best_gain > len(current_covered):
                current = test | {best_ci}
                unused = all_indices - current
                current_covered = compute_coverage(current)
                improved = True
                break  # restart scan
        
        if not improved:
            break
    
    return list(current)


def _grils_solve(
    candidates: List[Tuple[float, float]],
    coverage_sets: List[Set[int]],
    n_samples: int,
    target_pct: float = 0.95,
    n_restarts: int = 8,
) -> List[int]:
    """
    Multi-start GRILS — run greedy + redundancy + local from different seeds
    Returns best solution (minimum circles covering >= target_pct)
    """
    best_solution = None
    best_count = len(candidates) + 1
    
    for run in range(n_restarts):
        # Phase 1: Greedy (with shuffle for diversity)
        selected = _greedy_set_cover(coverage_sets, n_samples, target_pct, shuffle=(run > 0))
        
        # Phase 2: Remove redundant
        selected = _remove_redundant(selected, coverage_sets, n_samples, target_pct)
        
        # Phase 3: Local improvement (skip on first run for speed if good enough)
        if len(selected) > 3 and run >= n_restarts // 2:
            selected = _local_improve(selected, coverage_sets, n_samples, candidates, target_pct)
        
        if len(selected) < best_count:
            best_count = len(selected)
            best_solution = selected
        
        # Early exit if we hit theoretical minimum (polygon area / circle area)
        if best_count <= 1:
            break
    
    return best_solution or []


# ── Main Algorithm ─────────────────────────────────────────────────

def pack_circles(
    geojson: Dict[str, Any],
    cell_radius_m: float,
    optimize: bool = True,
) -> Dict[str, Any]:
    """
    วาง coverage circles ภายใน polygon
    
    Args:
        geojson: GeoJSON Polygon
        cell_radius_m: รัศมี coverage ต่อเสา (เมตร)
        optimize: True = GRILS optimal, False = hexagonal grid fast
    
    Returns: {...}
    """
    vertices = _extract_polygon_vertices(geojson)
    ref_lat = sum(v[0] for v in vertices) / len(vertices)
    cos_lat = max(math.cos(math.radians(ref_lat)), 0.0001)
    
    # 1. Centroid (สำหรับ single-tower case)
    centroid = _chebyshev_center(vertices)
    max_radius = _min_distance_to_boundary(centroid[0], centroid[1], vertices)
    
    # 2. Circle packing
    if optimize and len(vertices) >= 3:
        points, coverage_pct = _pack_optimal(vertices, cell_radius_m, ref_lat, cos_lat)
    else:
        points = _pack_hex(vertices, cell_radius_m, ref_lat, cos_lat)
        coverage_pct = _calculate_coverage(points, cell_radius_m, vertices)
    
    # 3. Centroid coverage
    centroid_pct = _calculate_coverage(
        [{"lat": centroid[0], "lon": centroid[1], "type": "centroid"}],
        cell_radius_m,
        vertices,
    )
    
    recommendation = "single" if len(points) <= 1 and coverage_pct >= 90 else "multi"
    
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


def _pack_optimal(
    vertices: List[Tuple[float, float]],
    cell_radius_m: float,
    ref_lat: float,
    cos_lat: float,
) -> Tuple[List[Dict[str, Any]], float]:
    """
    Optimal packing via Iterative Removal + Local Refinement
    
    Approach:
    1. Start with hex grid (known-good solution, high coverage)
    2. Greedily remove redundant circles (each that doesn't drop coverage below 95%)
    3. Local refinement: small shifts to reclaim coverage from any dips
    
    This guarantees at least as good as hex grid, and improves for irregular shapes.
    """
    # Phase 1: Start with hex grid
    hex_points = _pack_hex(vertices, cell_radius_m, ref_lat, cos_lat)
    if len(hex_points) <= 1:
        cov = _calculate_coverage(hex_points, cell_radius_m, vertices)
        return hex_points, cov
    
    # Phase 2: Greedy redundancy removal
    # Sort by "how much unique coverage does this circle provide?"
    # Remove circles that contribute least unique coverage first
    current = list(hex_points)
    baseline_cov = _calculate_coverage(current, cell_radius_m, vertices)
    
    improved = True
    while improved:
        improved = False
        # Score each circle by how much coverage drops if removed
        scores = []
        for i in range(len(current)):
            test = current[:i] + current[i+1:]
            cov = _calculate_coverage(test, cell_radius_m, vertices)
            drop = baseline_cov - cov
            scores.append((i, drop, cov))
        
        # Find removable: drop < 1% and coverage >= 93%
        candidates = [(i, drop, cov) for i, drop, cov in scores if drop < 0.01 and cov >= 0.93]
        if candidates:
            # Remove the one with smallest drop
            best = min(candidates, key=lambda x: x[1])
            i, _, new_cov = best
            current = current[:i] + current[i+1:]
            baseline_cov = new_cov
            improved = True
    
    points = current
    
    # Phase 3: Local shift optimization (small perturbations)
    # For each remaining circle, try small shifts in 4 directions
    # Accept if coverage improves
    if len(points) > 2:
        shift_m = cell_radius_m * 0.15  # 15% of radius
        for _ in range(3):  # 3 passes
            any_improved = False
            for pi in range(len(points)):
                p = points[pi]
                lat, lon = p["lat"], p["lon"]
                best_cov = _calculate_coverage(points, cell_radius_m, vertices)
                best_shift = (lat, lon)
                
                # Try 8 directions
                for angle in range(8):
                    rad = angle * math.pi / 4
                    dlat_m = shift_m * math.cos(rad)
                    dlon_m = shift_m * math.sin(rad)
                    new_lat, new_lon = _latlon_offset(lat, lon, dlon_m, dlat_m)
                    
                    if not _point_in_polygon(new_lat, new_lon, vertices):
                        continue
                    
                    test = [dict(p) for p in points]
                    test[pi] = {"lat": round(new_lat, 7), "lon": round(new_lon, 7), "type": "packed"}
                    cov = _calculate_coverage(test, cell_radius_m, vertices)
                    if cov > best_cov + 0.005:
                        best_cov = cov
                        best_shift = (new_lat, new_lon)
                
                if best_shift != (lat, lon):
                    points[pi]["lat"] = round(best_shift[0], 7)
                    points[pi]["lon"] = round(best_shift[1], 7)
                    any_improved = True
            
            if not any_improved:
                break
    
    coverage_pct = _calculate_coverage(points, cell_radius_m, vertices)
    return points, coverage_pct


def _pack_hex(
    vertices: List[Tuple[float, float]],
    cell_radius_m: float,
    ref_lat: float,
    cos_lat: float,
) -> List[Dict[str, Any]]:
    """Hexagonal grid packing — fast fallback"""
    spacing = cell_radius_m * math.sqrt(3)
    
    dlat_deg = math.degrees(spacing / EARTH_RADIUS_M)
    dlon_deg = math.degrees(spacing / (EARTH_RADIUS_M * cos_lat))
    
    lats = [v[0] for v in vertices]
    lons = [v[1] for v in vertices]
    
    points = []
    row = 0
    lat = min(lats) - dlat_deg
    while lat <= max(lats) + dlat_deg:
        offset = (dlon_deg / 2) if (row % 2 == 1) else 0.0
        lon = min(lons) - dlon_deg + offset
        while lon <= max(lons) + dlon_deg:
            if _point_in_polygon(lat, lon, vertices):
                frac = _circle_fraction_in_polygon(lat, lon, cell_radius_m, vertices)
                if frac > 0.2:
                    points.append({
                        "lat": round(lat, 7),
                        "lon": round(lon, 7),
                        "type": "packed",
                    })
            lon += dlon_deg
        row += 1
        lat += dlat_deg
    
    return points
