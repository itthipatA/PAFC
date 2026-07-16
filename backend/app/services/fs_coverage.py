"""
FS Coverage Engine — PAFC Phase 37

Calculates -120dBm coverage radius for Fixed Service stations
using directional antenna pattern + FSPL.

Key functions:
  - fs_coverage_polygon() → GeoJSON polygon for a single FS station (-120dBm contour)
  - fs_link_corridor() → GeoJSON polygon covering the full FS link path

Engineering basis:
  - ITU-R F.699: Reference radiation pattern for fixed wireless systems
  - ITU-R P.525: Free-space path loss (FSPL)
  - Threshold: -120 dBm (based on user's specification)
"""

import math
import json
from typing import List, Tuple, Optional, Dict

# ── Constants ────────────────────────────────────────────────────────────

# -120 dBm detection threshold (user-specified)
RX_THRESHOLD_DBM = -120.0

# ITU-R F.699 pattern parameters
F699_PEAK_GAIN_DBI = 40.0     # typical max gain for microwave dish
F699_BEAMWIDTH_DEG = 3.0      # typical half-power beamwidth
F699_FIRST_SIDELOBE_DB = -20  # first sidelobe level relative to peak

# Number of radial samples for polygon generation
NUM_RADIAL_SAMPLES = 72  # every 5 degrees


# ── Physics — FSPL ──────────────────────────────────────────────────────

def fspl_db(d_km: float, freq_mhz: float) -> float:
    """
    Free-Space Path Loss (ITU-R P.525)
    
    FSPL = 20·log₁₀(d_km) + 20·log₁₀(f_MHz) + 32.45
    
    Args:
        d_km: distance in kilometers
        freq_mhz: frequency in MHz
    
    Returns:
        Path loss in dB
    """
    if d_km < 0.001:
        d_km = 0.001  # floor at 1m to avoid infinite negative loss
    return 20.0 * math.log10(d_km) + 20.0 * math.log10(freq_mhz) + 32.45


def distance_for_rx_level(
    eirp_dbm: float,
    rx_gain_dbi: float,
    freq_mhz: float,
    target_rx_dbm: float = RX_THRESHOLD_DBM,
) -> float:
    """
    Compute distance (km) where received power equals target level.
    
    Pr = EIRP - FSPL(d) + Gr
    → FSPL(d) = EIRP + Gr - Pr
    → d = 10^((FSPL(d) - 20·log₁₀(f) - 32.45) / 20)
    
    Solving for d:
    FSPL(d) = EIRP + Gr - target_rx
    d = 10^((EIRP + Gr - target_rx - 20·log₁₀(f) - 32.45) / 20)
    """
    required_fspl = eirp_dbm + rx_gain_dbi - target_rx_dbm
    exponent = (required_fspl - 20.0 * math.log10(freq_mhz) - 32.45) / 20.0
    d_km = 10.0 ** exponent
    return max(0.001, d_km)


# ── Antenna Pattern — ITU-R F.699 (Simplified) ───────────────────────────

def itu_f699_pattern_discrimination(
    angle_deg: float,
    peak_gain_dbi: float,
    beamwidth_deg: float = F699_BEAMWIDTH_DEG,
) -> float:
    """
    ITU-R F.699 reference radiation pattern discrimination.
    
    Returns the gain RELATIVE TO PEAK (negative = loss) at a given off-axis angle.
    
    Simplified model:
      - Main beam (|φ| ≤ BW/2): 0 dB discrimination (full gain)
      - Transition (BW/2 < |φ| ≤ BW*2): -12·(φ/BW - 0.5)² dB
      - Near sidelobe (BW*2 < |φ| ≤ 20°): peak_gain - 25·log(φ) clamped
      - Far sidelobe (|φ| > 20°): 0 dBi gain (discrimination = -(peak_gain))
    
    Args:
        angle_deg: off-axis angle from main beam (0 = main beam center), in degrees
        peak_gain_dbi: maximum antenna gain in dBi
        beamwidth_deg: half-power (-3dB) beamwidth in degrees
    
    Returns:
        Gain discrimination in dB (0 = full gain, negative = reduced)
    """
    phi = abs(angle_deg)
    half_bw = beamwidth_deg / 2.0
    
    if phi <= half_bw:
        # Main beam — full gain
        return 0.0
    
    elif phi <= half_bw * 4:
        # Transition region — parabolic roll-off
        # At phi=half_bw: 0 dB → at phi=half_bw*4: approximately -20 dB
        normalized = (phi / half_bw) - 1.0  # 0 at half_bw, 3 at 4*half_bw
        return -12.0 * (normalized ** 0.7)  # Smoother falloff
    
    elif phi <= 20.0:
        # Near sidelobe — log roll-off
        # G(φ) = 32 - 25·log(φ) for ITU-R F.699 reference
        gain_dbi = 32.0 - 25.0 * math.log10(phi)
        discrimination = gain_dbi - peak_gain_dbi
        return min(0.0, discrimination)
    
    else:
        # Far sidelobe — minimum gain
        # ITU-R F.699 floor is -10 dBi
        far_gain_dbi = -10.0
        discrimination = far_gain_dbi - peak_gain_dbi
        return min(-20.0, discrimination)


# ── Geo Computation ───────────────────────────────────────────────────────

def _point_at_distance_bearing(
    lat: float, lon: float,
    distance_km: float,
    bearing_deg: float,
) -> Tuple[float, float]:
    """
    Compute destination point given origin, distance, and bearing.
    
    Uses spherical Earth model (Haversine inverse).
    """
    R = 6371.0  # Earth radius in km
    
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


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute initial bearing from point 1 to point 2."""
    lat1_r = math.radians(lat1)
    lat2_r = math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    
    x = math.sin(dlon) * math.cos(lat2_r)
    y = (math.cos(lat1_r) * math.sin(lat2_r) -
         math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlon))
    
    bearing_rad = math.atan2(x, y)
    bearing_deg = math.degrees(bearing_rad)
    return (bearing_deg + 360.0) % 360.0


# ── FS Station Coverage ───────────────────────────────────────────────────

def fs_station_coverage_polygon(
    lat: float,
    lon: float,
    tx_power_dbm: float,
    tx_antenna_gain_dbi: float,
    freq_mhz: float,
    azimuth_deg: float,
    beamwidth_deg: float = 3.0,
    rx_antenna_gain_dbi: float = 0.0,
    target_rx_dbm: float = RX_THRESHOLD_DBM,
) -> dict:
    """
    Generate -120dBm coverage polygon for a single FS station.
    
    Uses directional antenna pattern (ITU-R F.699) + FSPL to compute
    the distance at each angle where received power drops to target level.
    
    Args:
        lat, lon: station coordinates
        tx_power_dbm: transmitter power (dBm)
        tx_antenna_gain_dbi: antenna gain (dBi)
        freq_mhz: operating frequency (MHz)
        azimuth_deg: antenna pointing direction (degrees from True North)
        beamwidth_deg: half-power beamwidth (degrees)
        rx_antenna_gain_dbi: receiver antenna gain (dBi, assumed omni=0 for victim)
        target_rx_dbm: target received power threshold (default -120 dBm)
    
    Returns:
        GeoJSON Polygon feature
    """
    eirp_dbm = tx_power_dbm + tx_antenna_gain_dbi
    
    # Compute max distance (on main beam, 0° discrimination)
    max_d_km = distance_for_rx_level(
        eirp_dbm=eirp_dbm,
        rx_gain_dbi=rx_antenna_gain_dbi,
        freq_mhz=freq_mhz,
        target_rx_dbm=target_rx_dbm,
    )
    
    # Generate polygon vertices at each angle
    coords = []
    for i in range(NUM_RADIAL_SAMPLES):
        angle_from_azimuth = i * (360.0 / NUM_RADIAL_SAMPLES)  # 0-360
        
        # Get pattern discrimination at this off-axis angle
        discrimination_db = itu_f699_pattern_discrimination(
            angle_deg=angle_from_azimuth,
            peak_gain_dbi=tx_antenna_gain_dbi,
            beamwidth_deg=beamwidth_deg,
        )
        
        # Effective EIRP at this angle
        effective_eirp = eirp_dbm + discrimination_db
        
        # Distance where received power = target
        d_km = distance_for_rx_level(
            eirp_dbm=effective_eirp,
            rx_gain_dbi=rx_antenna_gain_dbi,
            freq_mhz=freq_mhz,
            target_rx_dbm=target_rx_dbm,
        )
        
        # Cap at main-beam distance (avoid numerical blowup at nulls)
        d_km = min(d_km, max_d_km)
        d_km = max(d_km, 0.001)  # floor at 1m
        
        # Bearing from station
        point_bearing = (azimuth_deg + angle_from_azimuth) % 360.0
        
        # Compute lat/lon of this point
        pt_lat, pt_lon = _point_at_distance_bearing(
            lat, lon, d_km, point_bearing
        )
        
        coords.append([pt_lon, pt_lat])  # GeoJSON order: [lon, lat]
    
    # Close the polygon
    coords.append(coords[0])
    
    return {
        "type": "Polygon",
        "coordinates": [coords]
    }


def fs_station_coverage_circle_fallback(
    lat: float,
    lon: float,
    tx_power_dbm: float,
    tx_antenna_gain_dbi: float,
    freq_mhz: float,
    rx_antenna_gain_dbi: float = 0.0,
    target_rx_dbm: float = RX_THRESHOLD_DBM,
) -> dict:
    """
    Simple circular coverage (no directional pattern).
    Used as fallback when antenna pattern data is unavailable.
    
    Returns GeoJSON Polygon (circle approximated by 36 points).
    """
    eirp_dbm = tx_power_dbm + tx_antenna_gain_dbi
    
    d_km = distance_for_rx_level(
        eirp_dbm=eirp_dbm,
        rx_gain_dbi=rx_antenna_gain_dbi,
        freq_mhz=freq_mhz,
        target_rx_dbm=target_rx_dbm,
    )
    
    # Generate circle approximation
    coords = []
    num_points = 36
    for i in range(num_points):
        angle = i * (360.0 / num_points)
        pt_lat, pt_lon = _point_at_distance_bearing(lat, lon, d_km, angle)
        coords.append([pt_lon, pt_lat])
    
    coords.append(coords[0])
    
    return {
        "type": "Polygon",
        "coordinates": [coords]
    }


# ── FS Link Corridor ──────────────────────────────────────────────────────

def fs_link_corridor_polygon(
    tx_lat: float, tx_lon: float,
    rx_lat: float, rx_lon: float,
    tx_power_dbm: float,
    tx_antenna_gain_dbi: float,
    rx_antenna_gain_dbi: float,
    freq_mhz: float,
    beamwidth_deg: float = 3.0,
    azimuth_deg: Optional[float] = None,
    corridor_width_m: Optional[float] = None,
) -> dict:
    """
    Generate a corridor polygon covering the FS link path.
    
    The corridor is a rectangle-like polygon along the link path,
    with a width based on:
      - Fresnel zone radius (if corridor_width_m not specified)
      - Or fixed width (if specified)
    
    The ends are capped with TX and RX station coverage zones.
    
    Args:
        tx_lat, tx_lon: transmitter coordinates
        rx_lat, rx_lon: receiver coordinates
        tx_power_dbm, tx_antenna_gain_dbi, rx_antenna_gain_dbi: RF params
        freq_mhz: operating frequency
        beamwidth_deg: antenna beamwidth
        azimuth_deg: antenna azimuth (computed from TX→RX if not given)
        corridor_width_m: override corridor width in meters
    
    Returns:
        GeoJSON Polygon covering the full link path
    """
    # Compute link bearing and distance
    if azimuth_deg is None:
        azimuth_deg = _bearing(tx_lat, tx_lon, rx_lat, rx_lon)
    
    # Haversine distance TX→RX
    R = 6371.0
    tx_lat_r = math.radians(tx_lat)
    rx_lat_r = math.radians(rx_lat)
    dlat = math.radians(rx_lat - tx_lat)
    dlon = math.radians(rx_lon - tx_lon)
    a = (math.sin(dlat/2)**2 + 
         math.cos(tx_lat_r) * math.cos(rx_lat_r) * math.sin(dlon/2)**2)
    link_distance_km = R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    if link_distance_km < 0.001:
        # Co-located — return station coverage only
        return fs_station_coverage_polygon(
            tx_lat, tx_lon, tx_power_dbm, tx_antenna_gain_dbi,
            freq_mhz, azimuth_deg, beamwidth_deg, rx_antenna_gain_dbi,
        )
    
    # Compute Fresnel zone radius at midpoint (widest point)
    freq_hz = freq_mhz * 1e6
    wavelength_m = 299792458.0 / freq_hz
    d1 = d2 = link_distance_km / 2.0  # midpoint
    fresnel_r_m = math.sqrt(
        (1 * wavelength_m * d1 * 1000 * d2 * 1000) / (link_distance_km * 1000)
    )
    
    # Corridor half-width: use max of Fresnel radius and 100m minimum
    if corridor_width_m is None:
        half_width_m = max(fresnel_r_m, 100.0)
    else:
        half_width_m = corridor_width_m / 2.0
    
    half_width_km = half_width_m / 1000.0
    
    # Compute perpendicular bearings (left and right of link path)
    bearing_left = (azimuth_deg - 90.0) % 360.0
    bearing_right = (azimuth_deg + 90.0) % 360.0
    
    # Compute station coverage zones
    tx_coverage = fs_station_coverage_polygon(
        tx_lat, tx_lon, tx_power_dbm, tx_antenna_gain_dbi,
        freq_mhz, azimuth_deg, beamwidth_deg, rx_antenna_gain_dbi,
    )
    rx_coverage = fs_station_coverage_polygon(
        rx_lat, rx_lon, tx_power_dbm, tx_antenna_gain_dbi,
        freq_mhz, (azimuth_deg + 180.0) % 360.0, beamwidth_deg,
        rx_antenna_gain_dbi,
    )
    
    # Generate corridor as convex hull of TX+RX coverage + edge buffers
    # For simplicity: create 4 corner points (left/right of TX, left/right of RX)
    # then take convex hull of these + sampled coverage points
    
    # Left and right of TX
    tx_left_lat, tx_left_lon = _point_at_distance_bearing(
        tx_lat, tx_lon, half_width_km, bearing_left
    )
    tx_right_lat, tx_right_lon = _point_at_distance_bearing(
        tx_lat, tx_lon, half_width_km, bearing_right
    )
    
    # Left and right of RX
    rx_left_lat, rx_left_lon = _point_at_distance_bearing(
        rx_lat, rx_lon, half_width_km, bearing_left
    )
    rx_right_lat, rx_right_lon = _point_at_distance_bearing(
        rx_lat, rx_lon, half_width_km, bearing_right
    )
    
    # Collect all points for convex hull
    all_points = [
        (tx_lat, tx_lon),
        (tx_left_lat, tx_left_lon),
        (tx_right_lat, tx_right_lon),
        (rx_lat, rx_lon),
        (rx_left_lat, rx_left_lon),
        (rx_right_lat, rx_right_lon),
    ]
    
    # Add coverage boundary samples for better shape
    # Sample points along TX and RX coverage edges
    tx_coords = tx_coverage["coordinates"][0]
    rx_coords = rx_coverage["coordinates"][0]
    
    # Take every 6th point (12 from each, total 24)
    step = max(1, len(tx_coords) // 12)
    for i in range(0, len(tx_coords) - 1, step):
        lon, lat = tx_coords[i]
        all_points.append((lat, lon))
    for i in range(0, len(rx_coords) - 1, step):
        lon, lat = rx_coords[i]
        all_points.append((lat, lon))
    
    # Convex hull (Graham scan on lat/lon — approximate, OK for local scale)
    hull = _convex_hull_latlon(all_points)
    
    # Close the hull
    if len(hull) > 0:
        hull.append(hull[0])
    
    geojson_coords = [[lon, lat] for lat, lon in hull]
    
    return {
        "type": "Polygon",
        "coordinates": [geojson_coords]
    }


# ── Convex Hull (Lat/Lon) ────────────────────────────────────────────────

def _convex_hull_latlon(points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """
    Compute convex hull of (lat, lon) points using Graham scan.
    
    Approximate: treats lat/lon as Euclidean coordinates.
    Accurate enough for local-scale polygons (<100km).
    """
    if len(points) <= 3:
        return list(points)
    
    # Sort by lat, then lon
    sorted_pts = sorted(set(points), key=lambda p: (p[0], p[1]))
    
    if len(sorted_pts) <= 3:
        return sorted_pts
    
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    
    # Lower hull
    lower = []
    for p in sorted_pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    
    # Upper hull
    upper = []
    for p in reversed(sorted_pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    
    # Combine (remove duplicate endpoints)
    return lower[:-1] + upper[:-1]


# ── Utility: Check if point is inside FS coverage polygon ──────────────────

def is_point_in_fs_coverage(
    point_lat: float,
    point_lon: float,
    fs_station: dict,  # FSLink-compatible dict with RF params
    target_rx_dbm: float = RX_THRESHOLD_DBM,
) -> bool:
    """
    Check if a point falls within the -120dBm coverage of an FS station.
    
    Uses ray-casting on the coverage polygon (faster than recomputing FSPL).
    """
    coverage = fs_station_coverage_circle_fallback(
        lat=fs_station["tx_lat"],
        lon=fs_station["tx_lon"],
        tx_power_dbm=fs_station["tx_power"],
        tx_antenna_gain_dbi=fs_station["tx_antenna_gain"],
        freq_mhz=(fs_station["freq_low"] + fs_station["freq_high"]) / 2,
        rx_antenna_gain_dbi=fs_station.get("rx_antenna_gain", 0),
        target_rx_dbm=target_rx_dbm,
    )
    
    coords = coverage["coordinates"][0]
    return _point_in_polygon(point_lat, point_lon, coords)


def _point_in_polygon(lat: float, lon: float, coords: List[List[float]]) -> bool:
    """Ray casting — coords = [[lon, lat], ...]"""
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


# ── Compute FS coverage for all stations ───────────────────────────────────

def compute_all_fs_coverages(
    fs_links: list,
    target_rx_dbm: float = RX_THRESHOLD_DBM,
) -> dict:
    """
    Compute coverage polygons for all FS links in the database.
    
    Args:
        fs_links: list of FSLink ORM objects (must have tx_lat, tx_lon, rx_lat, rx_lon,
                  tx_power, tx_antenna_gain, rx_antenna_gain, freq_low, freq_high,
                  beamwidth_deg, azimuth)
    
    Returns:
        {
            "<link_id>": {
                "tx_coverage": GeoJSON Polygon,
                "rx_coverage": GeoJSON Polygon, 
                "link_corridor": GeoJSON Polygon,
                "max_distance_km": float,
                "freq_mhz": float,
            }
        }
    """
    result = {}
    
    for fs in fs_links:
        freq_mhz = (fs.freq_low + fs.freq_high) / 2.0
        azimuth = fs.azimuth if fs.azimuth else _bearing(
            fs.tx_lat, fs.tx_lon, fs.rx_lat, fs.rx_lon
        )
        bw = getattr(fs, 'beamwidth_deg', 3.0) or 3.0
        rx_gain = getattr(fs, 'rx_antenna_gain', 0.0) or 0.0
        
        # TX station coverage (directional)
        tx_coverage = fs_station_coverage_polygon(
            lat=fs.tx_lat,
            lon=fs.tx_lon,
            tx_power_dbm=fs.tx_power,
            tx_antenna_gain_dbi=fs.tx_antenna_gain,
            freq_mhz=freq_mhz,
            azimuth_deg=azimuth,
            beamwidth_deg=bw,
            rx_antenna_gain_dbi=rx_gain,
            target_rx_dbm=target_rx_dbm,
        )
        
        # RX station coverage (pointing back toward TX)
        rx_azimuth = (azimuth + 180.0) % 360.0
        rx_coverage = fs_station_coverage_polygon(
            lat=fs.rx_lat,
            lon=fs.rx_lon,
            tx_power_dbm=fs.tx_power,
            tx_antenna_gain_dbi=fs.tx_antenna_gain,
            freq_mhz=freq_mhz,
            azimuth_deg=rx_azimuth,
            beamwidth_deg=bw,
            rx_antenna_gain_dbi=rx_gain,
            target_rx_dbm=target_rx_dbm,
        )
        
        # Link corridor
        corridor = fs_link_corridor_polygon(
            tx_lat=fs.tx_lat, tx_lon=fs.tx_lon,
            rx_lat=fs.rx_lat, rx_lon=fs.rx_lon,
            tx_power_dbm=fs.tx_power,
            tx_antenna_gain_dbi=fs.tx_antenna_gain,
            rx_antenna_gain_dbi=rx_gain,
            freq_mhz=freq_mhz,
            beamwidth_deg=bw,
            azimuth_deg=azimuth,
        )
        
        # Max distance on main beam
        eirp = fs.tx_power + fs.tx_antenna_gain
        max_d = distance_for_rx_level(eirp, rx_gain, freq_mhz, target_rx_dbm)
        
        result[str(fs.id)] = {
            "name": fs.name,
            "operator": fs.operator,
            "tx_coverage": tx_coverage,
            "rx_coverage": rx_coverage,
            "link_corridor": corridor,
            "max_distance_km": round(max_d, 2),
            "freq_mhz": round(freq_mhz, 1),
            "freq_low": fs.freq_low,
            "freq_high": fs.freq_high,
        }
    
    return result
