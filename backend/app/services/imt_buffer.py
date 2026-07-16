"""
IMT Buffer Engine — PAFC Phase 37

Computes buffered polygon from IMT land boundary (+100m).
Replaces the old circle-based radius.

Key function:
  - compute_imt_buffer_polygon() → GeoJSON polygon = original + 100m buffer
"""

import math
import json
from typing import List, Tuple


# ── Constants ────────────────────────────────────────────────────────────

IMT_BUFFER_M = 100.0  # 100-meter buffer from polygon boundary
IMT_BUFFER_KM = IMT_BUFFER_M / 1000.0


# ── GeoJSON Parsing ──────────────────────────────────────────────────────

def parse_polygon_coords(polygon_geojson) -> List[Tuple[float, float]]:
    """
    Parse GeoJSON Polygon to list of (lon, lat) tuples.
    Handles Polygon, Feature, FeatureCollection.
    """
    if isinstance(polygon_geojson, str):
        geojson = json.loads(polygon_geojson)
    else:
        geojson = polygon_geojson
    
    geom_type = geojson.get("type", "")
    
    if geom_type == "Polygon":
        coords = geojson["coordinates"][0]
    elif geom_type == "Feature":
        return parse_polygon_coords(geojson["geometry"])
    elif geom_type == "FeatureCollection":
        for feature in geojson.get("features", []):
            return parse_polygon_coords(feature)
        raise ValueError("FeatureCollection has no features")
    elif geom_type == "MultiPolygon":
        coords = geojson["coordinates"][0][0]
    else:
        raise ValueError(f"Unsupported GeoJSON type: {geom_type}")
    
    return [(c[0], c[1]) for c in coords]  # (lon, lat)


# ── Geometry Utilities ───────────────────────────────────────────────────

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in km."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute initial bearing from point 1 to point 2."""
    lat1_r = math.radians(lat1)
    lat2_r = math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(lat2_r)
    y = (math.cos(lat1_r) * math.sin(lat2_r) -
         math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlon))
    bearing_rad = math.atan2(x, y)
    return (math.degrees(bearing_rad) + 360.0) % 360.0


def _point_at_distance_bearing(
    lat: float, lon: float,
    distance_km: float,
    bearing_deg: float,
) -> Tuple[float, float]:
    """Compute destination point given origin, distance, and bearing."""
    R = 6371.0
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    bearing_rad = math.radians(bearing_deg)
    angular_dist = distance_km / R
    
    new_lat_rad = math.asin(
        math.sin(lat_rad) * math.cos(angular_dist) +
        math.cos(lat_rad) * math.sin(angular_dist) * math.cos(bearing_rad)
    )
    new_lon_rad = lon_rad + math.atan2(
        math.sin(bearing_rad) * math.sin(angular_dist) * math.cos(lat_rad),
        math.cos(angular_dist) - math.sin(lat_rad) * math.sin(new_lat_rad)
    )
    return (math.degrees(new_lat_rad), math.degrees(new_lon_rad))


def _angle_between_bearings(b1: float, b2: float) -> float:
    """Smallest angle between two bearings (0-180 degrees)."""
    diff = abs(b1 - b2) % 360.0
    return diff if diff <= 180.0 else 360.0 - diff


# ── Polygon Buffer ───────────────────────────────────────────────────────

def compute_imt_buffer_polygon(
    polygon_geojson,
    buffer_m: float = IMT_BUFFER_M,
) -> dict:
    """
    Compute buffered polygon from IMT land boundary.
    
    Takes the original polygon and expands it outward by buffer_m meters.
    This replaces the old circle-based IMT radius.
    
    Algorithm:
      1. For each vertex, compute outward push along the angle bisector
         of the two adjacent edges.
      2. For concave angles, cap with an arc.
      3. Return the expanded polygon.
    
    Args:
        polygon_geojson: GeoJSON Polygon string or dict
        buffer_m: buffer distance in meters (default 100m)
    
    Returns:
        GeoJSON Polygon of the buffered area
    """
    coords = parse_polygon_coords(polygon_geojson)  # [(lon, lat), ...]
    
    if len(coords) < 3:
        raise ValueError("Polygon must have at least 3 vertices")
    
    buffer_km = buffer_m / 1000.0
    
    # Remove closing duplicate if present
    if len(coords) > 1:
        first = coords[0]
        last = coords[-1]
        if abs(first[0] - last[0]) < 1e-9 and abs(first[1] - last[1]) < 1e-9:
            coords = coords[:-1]
    
    n = len(coords)
    
    # For each vertex, compute the outward-buffered position
    buffered = []
    
    for i in range(n):
        # Current vertex and neighbors
        prev_i = (i - 1) % n
        next_i = (i + 1) % n
        
        curr_lat, curr_lon = coords[i][1], coords[i][0]
        prev_lat, prev_lon = coords[prev_i][1], coords[prev_i][0]
        next_lat, next_lon = coords[next_i][1], coords[next_i][0]
        
        # Bearings of incoming and outgoing edges
        bearing_in = _bearing(curr_lat, curr_lon, prev_lat, prev_lon)  # toward prev
        bearing_out = _bearing(curr_lat, curr_lon, next_lat, next_lon)  # toward next
        
        # Interior angle at vertex
        interior_angle = _angle_between_bearings(
            (bearing_in + 180) % 360, bearing_out
        )
        
        # Bisector direction (outward)
        # The outward bisector is the average of the two outward normals
        normal_in = (bearing_in + 90) % 360
        normal_out = (bearing_out - 90) % 360
        
        if interior_angle > 170:
            # Nearly straight — use midpoint of normals
            mid_normal = (normal_in + normal_out) / 2.0
            if abs(normal_in - normal_out) > 180:
                mid_normal = (mid_normal + 180) % 360
            outward_bearing = mid_normal % 360
            
            # Distance along bisector for given buffer
            offset_dist = buffer_km / math.sin(math.radians(interior_angle / 2.0))
            offset_dist = min(offset_dist, buffer_km * 10)  # cap for very shallow angles
        elif interior_angle < 90:
            # Sharp turn — use multiple arc points for smooth buffering
            outward_bearing = (normal_in + normal_out) / 2.0
            if abs(normal_in - normal_out) > 180:
                outward_bearing = (outward_bearing + 180) % 360
            outward_bearing = outward_bearing % 360
            
            # For sharp corners, push further to maintain minimum distance
            half_angle_rad = math.radians(interior_angle / 2.0)
            sin_half = max(math.sin(half_angle_rad), 0.01)
            offset_dist = buffer_km / sin_half
            offset_dist = min(offset_dist, buffer_km * 10)
            
            # Add arc points around the corner
            if interior_angle < 120:
                arc_start = (outward_bearing - interior_angle / 2.0 + 90) % 360
                arc_end = (outward_bearing + interior_angle / 2.0 - 90) % 360
                num_arc_pts = max(3, int(interior_angle / 15))
                
                for j in range(num_arc_pts + 1):
                    t = j / num_arc_pts
                    if arc_end < arc_start:
                        arc_bearing = (arc_start + t * (arc_end + 360 - arc_start)) % 360
                    else:
                        arc_bearing = arc_start + t * (arc_end - arc_start)
                    
                    arc_lat, arc_lon = _point_at_distance_bearing(
                        curr_lat, curr_lon, buffer_km, arc_bearing
                    )
                    buffered.append([arc_lon, arc_lat])
                
                continue  # skip adding the simple outward point
        else:
            # Moderate angle — simple outward push
            outward_bearing = (normal_in + normal_out) / 2.0
            if abs(normal_in - normal_out) > 180:
                outward_bearing = (outward_bearing + 180) % 360
            outward_bearing = outward_bearing % 360
            
            half_angle_rad = math.radians(interior_angle / 2.0)
            sin_half = max(math.sin(half_angle_rad), 0.1)
            offset_dist = buffer_km / sin_half
            offset_dist = min(offset_dist, buffer_km * 10)
        
        # Push vertex outward
        buf_lat, buf_lon = _point_at_distance_bearing(
            curr_lat, curr_lon, offset_dist, outward_bearing
        )
        buffered.append([buf_lon, buf_lat])
    
    # Close polygon
    if buffered:
        buffered.append(buffered[0])
    
    return {
        "type": "Polygon",
        "coordinates": [buffered]
    }


def is_point_in_imt_buffer(
    point_lat: float,
    point_lon: float,
    buffer_geojson: dict,
) -> bool:
    """
    Check if a point falls within the IMT buffer polygon.
    Uses ray casting.
    """
    if "coordinates" not in buffer_geojson:
        return False
    
    coords = buffer_geojson["coordinates"][0]  # [[lon, lat], ...]
    n = len(coords)
    inside = False
    j = n - 1
    for i in range(n):
        loni, lati = coords[i]
        lonj, latj = coords[j]
        if ((lati > point_lat) != (latj > point_lat)) and \
           (point_lon < (lonj - loni) * (point_lat - lati) / (latj - lati) + loni):
            inside = not inside
        j = i
    return inside


def does_imt_buffer_intersect_fs_coverage(
    imt_buffer_geojson: dict,
    fs_coverage_geojson: dict,
) -> bool:
    """
    Check if IMT buffer polygon intersects with FS coverage polygon.
    
    Returns True if:
      - Any vertex of one polygon falls inside the other, OR
      - Any edge of one polygon crosses an edge of the other
    
    Args:
        imt_buffer_geojson: buffered IMT polygon (GeoJSON)
        fs_coverage_geojson: FS station coverage polygon (GeoJSON)
    
    Returns:
        True if polygons overlap or touch
    """
    imt_coords = imt_buffer_geojson["coordinates"][0]
    fs_coords = fs_coverage_geojson["coordinates"][0]
    
    # Check 1: Any IMT vertex inside FS polygon
    for lon, lat in imt_coords[:-1]:  # skip closing vertex
        if _point_in_polygon_fast(lat, lon, fs_coords):
            return True
    
    # Check 2: Any FS vertex inside IMT polygon
    for lon, lat in fs_coords[:-1]:
        if _point_in_polygon_fast(lat, lon, imt_coords):
            return True
    
    # Check 3: Edge-edge intersection
    for i in range(len(imt_coords) - 1):
        imt_p1 = imt_coords[i]
        imt_p2 = imt_coords[i + 1]
        for j in range(len(fs_coords) - 1):
            fs_p1 = fs_coords[j]
            fs_p2 = fs_coords[j + 1]
            if _segments_intersect(imt_p1, imt_p2, fs_p1, fs_p2):
                return True
    
    return False


def _point_in_polygon_fast(
    lat: float, lon: float,
    coords: List[List[float]],
) -> bool:
    """Ray casting — optimized."""
    n = len(coords)
    inside = False
    j = n - 1
    for i in range(n):
        loni, lati = coords[i]
        lonj, latj = coords[j]
        if ((lati > lat) != (latj > lat)) and \
           (lon < (lonj - loni) * (lat - lati) / (latj - lati) + loni):
            inside = not inside
        j = i
    return inside


def _segments_intersect(
    p1: List[float], p2: List[float],
    q1: List[float], q2: List[float],
) -> bool:
    """Check if two line segments intersect (using orientation test)."""
    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    
    def on_segment(a, b, c):
        return (min(a[0], b[0]) <= c[0] <= max(a[0], b[0]) and
                min(a[1], b[1]) <= c[1] <= max(a[1], b[1]))
    
    o1 = orient(p1, p2, q1)
    o2 = orient(p1, p2, q2)
    o3 = orient(q1, q2, p1)
    o4 = orient(q1, q2, p2)
    
    if o1 * o2 < 0 and o3 * o4 < 0:
        return True
    
    if o1 == 0 and on_segment(p1, p2, q1): return True
    if o2 == 0 and on_segment(p1, p2, q2): return True
    if o3 == 0 and on_segment(q1, q2, p1): return True
    if o4 == 0 and on_segment(q1, q2, p2): return True
    
    return False
