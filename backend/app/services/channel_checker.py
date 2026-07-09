"""
Channel Availability Checker — PAFC Phase 36 (Simplified)

Replaces the full interference engine (Phase 0-3 pipeline).
Checks which 10 MHz blocks in 4800-4990 MHz are available for allocation.

Rules:
  1. PN Rule: Don't allocate same channel as existing IMT in adjacent areas (polygon + buffer)
  2. FS LoS Rule: Don't allocate same channel as FS link with Line-of-Sight
  3. FS is victim only — FS doesn't interfere with IMT, but IMT must not interfere with FS
  4. When sites are far enough apart → frequency reuse is allowed

Band: 4800-4990 MHz → 19 blocks of 10 MHz each
"""

import math
import json
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field

# ── Constants ────────────────────────────────────────────────────────────
BAND_START_MHZ = 4800
BAND_END_MHZ = 4990
BLOCK_WIDTH_MHZ = 10
NUM_BLOCKS = 19

DEFAULT_PN_BUFFER_KM = 2.0  # Default buffer for PN adjacency

# Speed of light (km/s)
C_KMS = 299792.458

# ── Dataclasses ───────────────────────────────────────────────────────────

@dataclass
class ChannelBlock:
    """One 10 MHz channel block status"""
    freq_low: float          # MHz
    freq_high: float         # MHz
    status: str              # "available" | "blocked_by_pn" | "blocked_by_fs"
    blocked_by: List[str] = field(default_factory=list)  # names of conflicting services
    reason: str = ""         # Thai explanation

@dataclass
class AvailabilityResult:
    """Full availability check result"""
    blocks: List[ChannelBlock]
    polygon_area_km2: float
    pn_buffer_km: float
    existing_imt_count: int
    existing_fs_count: int
    summary: str


# ── Geometry Utilities ────────────────────────────────────────────────────

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in km between two lat/lon points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _point_to_segment_distance_km(
    px: float, py: float,
    ax: float, ay: float,
    bx: float, by: float
) -> float:
    """
    Minimum distance (km) from point P to line segment AB.
    All coordinates in decimal degrees — uses approximate planar projection
    for local-scale calculations (<100km).
    """
    # Convert to approximate km from origin
    lat_avg = (py + ay + by) / 3
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(lat_avg))

    # Project to meters
    px_m = px * m_per_deg_lon
    py_m = py * m_per_deg_lat
    ax_m = ax * m_per_deg_lon
    ay_m = ay * m_per_deg_lat
    bx_m = bx * m_per_deg_lon
    by_m = by * m_per_deg_lat

    # Vector AB and AP
    abx = bx_m - ax_m
    aby = by_m - ay_m
    apx = px_m - ax_m
    apy = py_m - ay_m

    ab_len_sq = abx * abx + aby * aby
    if ab_len_sq < 1e-6:
        # A and B are same point
        return _haversine_km(py, px, ay, ax)

    # Project AP onto AB
    t = max(0.0, min(1.0, (apx * abx + apy * aby) / ab_len_sq))

    # Closest point on segment
    cx_m = ax_m + t * abx
    cy_m = ay_m + t * aby

    dx = px_m - cx_m
    dy = py_m - cy_m
    return math.sqrt(dx * dx + dy * dy) / 1000.0  # m → km


def _point_in_polygon(lat: float, lon: float, coords: List[Tuple[float, float]]) -> bool:
    """Ray casting — is point inside polygon? coords = [(lon, lat), ...]"""
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


def _polygon_area_km2(coords: List[Tuple[float, float]]) -> float:
    """Shoelace formula — area in km² from (lon, lat) coordinates."""
    n = len(coords)
    # Convert to meters
    lat_avg = sum(c[1] for c in coords) / n
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(lat_avg))

    area_m2 = 0.0
    j = n - 1
    for i in range(n):
        xi = coords[i][0] * m_per_deg_lon
        yi = coords[i][1] * m_per_deg_lat
        xj = coords[j][0] * m_per_deg_lon
        yj = coords[j][1] * m_per_deg_lat
        area_m2 += (xj + xi) * (yj - yi)
        j = i

    return abs(area_m2) / 2.0 / 1e6  # m² → km²


def _polygon_buffer_contains(
    polygon_coords: List[Tuple[float, float]],
    point_lat: float, point_lon: float,
    buffer_km: float
) -> bool:
    """
    Check if point is within polygon + buffer zone.
    First check exact containment, then check distance to polygon boundary.
    """
    if _point_in_polygon(point_lat, point_lon, polygon_coords):
        return True

    # Check distance to each edge
    n = len(polygon_coords)
    for i in range(n):
        j = (i + 1) % n
        ax, ay = polygon_coords[i]
        bx, by = polygon_coords[j]
        dist = _point_to_segment_distance_km(point_lon, point_lat, ax, ay, bx, by)
        if dist <= buffer_km:
            return True

    return False


def _polygon_to_polygon_min_distance_km(
    coords1: List[Tuple[float, float]],
    coords2: List[Tuple[float, float]]
) -> float:
    """
    Minimum distance between two polygon boundaries.
    If polygons overlap → return 0.
    """
    # Quick check: any vertex of coords2 inside coords1 (overlap)
    for lon, lat in coords2:
        if _point_in_polygon(lat, lon, coords1):
            return 0.0
    for lon, lat in coords1:
        if _point_in_polygon(lat, lon, coords2):
            return 0.0

    # Minimum edge-to-edge distance
    min_dist = float('inf')
    for i in range(len(coords1)):
        j = (i + 1) % len(coords1)
        ax, ay = coords1[i]
        bx, by = coords1[j]
        for k in range(len(coords2)):
            p_lon, p_lat = coords2[k]
            dist = _point_to_segment_distance_km(p_lon, p_lat, ax, ay, bx, by)
            min_dist = min(min_dist, dist)

    return min_dist


# ── Fresnel Zone / LoS ────────────────────────────────────────────────────

def _fresnel_radius_m(
    d1_km: float, d2_km: float, freq_mhz: float, n: int = 1
) -> float:
    """
    Fresnel zone radius (meters) at a point along the path.
    d1_km: distance from TX to point (km)
    d2_km: distance from point to RX (km)
    freq_mhz: frequency in MHz
    n: Fresnel zone number (1 = first)
    """
    D = d1_km + d2_km
    if D < 0.001:
        return 0.0
    freq_hz = freq_mhz * 1e6
    wavelength = C_KMS * 1000 / freq_hz  # meters
    return math.sqrt((n * wavelength * d1_km * d2_km * 1000) / D)


def _fs_has_los_to_polygon(
    fs_tx_lat: float, fs_tx_lon: float,
    fs_rx_lat: float, fs_rx_lon: float,
    fs_freq_mhz: float,  # center frequency
    polygon_coords: List[Tuple[float, float]],
) -> bool:
    """
    Check if an FS link has Line-of-Sight to our polygon.
    
    LoS is defined as: any part of our polygon falls within the
    Fresnel zone (n=1) of the FS link path.
    
    We check multiple sample points along the FS path and polygon
    vertices to determine if the Fresnel zone envelope intersects
    the polygon.
    """
    D_km = _haversine_km(fs_tx_lat, fs_tx_lon, fs_rx_lat, fs_rx_lon)
    if D_km < 0.001:
        # Point-to-point — check if polygon contains FS location
        return _point_in_polygon(fs_tx_lat, fs_tx_lon, polygon_coords)

    # Determine bearing from TX to RX for interpolation
    dlat = math.radians(fs_rx_lat - fs_tx_lat)
    dlon = math.radians(fs_rx_lon - fs_tx_lon)
    
    # Sample 10 points along the FS path
    num_samples = 10
    for i in range(num_samples + 1):
        t = i / num_samples
        # Linear interpolation for lat/lon (approximation, OK for short paths)
        samp_lat = fs_tx_lat + t * (fs_rx_lat - fs_tx_lat)
        samp_lon = fs_tx_lon + t * (fs_rx_lon - fs_tx_lon)
        
        d1 = t * D_km
        d2 = (1 - t) * D_km
        
        # Fresnel radius at this point
        fresnel_r_m = _fresnel_radius_m(d1, d2, fs_freq_mhz, n=1)
        fresnel_r_km = fresnel_r_m / 1000.0
        
        # Check if this sampled point + Fresnel radius touches our polygon
        for lon, lat in polygon_coords:
            dist_to_sample = _haversine_km(lat, lon, samp_lat, samp_lon)
            if dist_to_sample <= fresnel_r_km:
                return True
        
        # Also check if polygon boundary intersects Fresnel zone
        n = len(polygon_coords)
        for j in range(n):
            k = (j + 1) % n
            ax, ay = polygon_coords[j]
            bx, by = polygon_coords[k]
            # Distance from sampled FS path point to polygon edge
            edge_dist = _point_to_segment_distance_km(
                samp_lon, samp_lat, ax, ay, bx, by
            )
            if edge_dist <= fresnel_r_km:
                return True

    return False


# ── Frequency Utilities ───────────────────────────────────────────────────

def _freq_overlap(
    f1_low: float, f1_high: float,
    f2_low: float, f2_high: float
) -> bool:
    """Check if two frequency ranges overlap."""
    return f1_low < f2_high and f2_low < f1_high


def _block_index(freq_low: float) -> int:
    """Convert frequency to block index (0-18)."""
    return int((freq_low - BAND_START_MHZ) / BLOCK_WIDTH_MHZ)


# ── GeoJSON Parsing ───────────────────────────────────────────────────────

def _parse_polygon_coords(polygon_geojson: str) -> List[Tuple[float, float]]:
    """
    Parse GeoJSON Polygon to list of (lon, lat) tuples.
    Handles both Polygon and MultiPolygon (takes first ring).
    """
    geojson = json.loads(polygon_geojson) if isinstance(polygon_geojson, str) else polygon_geojson
    
    geom_type = geojson.get("type", "")
    if geom_type == "Polygon":
        coords = geojson["coordinates"][0]
    elif geom_type == "MultiPolygon":
        coords = geojson["coordinates"][0][0]
    elif geom_type == "Feature":
        return _parse_polygon_coords(geojson["geometry"])
    elif geom_type == "FeatureCollection":
        for feature in geojson["features"]:
            return _parse_polygon_coords(feature)
        raise ValueError("FeatureCollection has no features")
    else:
        raise ValueError(f"Unsupported GeoJSON type: {geom_type}")
    
    return [(c[0], c[1]) for c in coords]  # (lon, lat)


def _parse_wkt_polygon(wkt: str) -> List[Tuple[float, float]]:
    """
    Parse WKT POLYGON((...)) to list of (lon, lat) tuples.
    Handles closing vertex (last≈first).
    """
    import re
    # Extract coordinate pairs
    coord_str = re.search(r'POLYGON\s*\(\((.*?)\)\)', wkt, re.IGNORECASE)
    if not coord_str:
        raise ValueError(f"Cannot parse WKT: {wkt[:50]}...")
    
    pairs = coord_str.group(1).strip().split(',')
    coords = []
    for pair in pairs:
        parts = pair.strip().split()
        if len(parts) >= 2:
            coords.append((float(parts[0]), float(parts[1])))  # (lon, lat)
    
    # Remove closing vertex if it's a duplicate of the first
    if len(coords) > 1:
        first = coords[0]
        last = coords[-1]
        if abs(first[0] - last[0]) < 1e-9 and abs(first[1] - last[1]) < 1e-9:
            coords = coords[:-1]
    
    return coords


# ── Main Checker ──────────────────────────────────────────────────────────

class ChannelChecker:
    """
    Check channel availability for a proposed IMT allocation area.
    
    Usage:
        checker = ChannelChecker(db_session)
        result = await checker.check(
            polygon_coords=coords,
            pn_buffer_km=2.0,
        )
    """
    
    def __init__(self, db_session):
        self.db = db_session
        self.band_start = BAND_START_MHZ
        self.band_end = BAND_END_MHZ
        self.block_width = BLOCK_WIDTH_MHZ
        self.num_blocks = NUM_BLOCKS
    
    def _init_blocks(self) -> List[ChannelBlock]:
        """Create all 19 blocks with available status."""
        blocks = []
        for i in range(self.num_blocks):
            flo = self.band_start + i * self.block_width
            fhi = flo + self.block_width
            blocks.append(ChannelBlock(
                freq_low=flo,
                freq_high=fhi,
                status="available",
                reason=f"ว่าง — สามารถจัดสรรได้ ({flo}-{fhi} MHz)"
            ))
        return blocks
    
    async def check(
        self,
        polygon_coords: List[Tuple[float, float]],
        pn_buffer_km: float = DEFAULT_PN_BUFFER_KM,
    ) -> AvailabilityResult:
        """
        Check all 19 blocks for availability.
        
        Args:
            polygon_coords: [(lon, lat), ...] — proposed coverage area
            pn_buffer_km: Buffer distance for PN adjacency check
            
        Returns:
            AvailabilityResult with per-block status
        """
        from sqlalchemy import select
        from app.models.fs_link import FSLink
        from app.models.imt import IMTAllocation, SpectrumBlock
        
        blocks = self._init_blocks()
        
        # ── Query existing IMT allocations + their blocks ──
        imt_query = select(IMTAllocation).where(
            IMTAllocation.status.in_(["active", "pending"])
        )
        imt_result = await self.db.execute(imt_query)
        imt_allocations = imt_result.scalars().all()
        
        # ── Query FS links in our frequency band ──
        fs_query = select(FSLink).where(
            FSLink.status == "active",
            FSLink.freq_high > self.band_start,
            FSLink.freq_low < self.band_end,
        )
        fs_result = await self.db.execute(fs_query)
        fs_links = fs_result.scalars().all()
        
        # ── Check each block ──
        polygon_area = _polygon_area_km2(polygon_coords)
        
        for block in blocks:
            block_f_low = block.freq_low
            block_f_high = block.freq_high
            
            # ── PN Check ──
            for imt in imt_allocations:
                # Check if this IMT has a spectrum block overlapping ours
                sb_query = select(SpectrumBlock).where(
                    SpectrumBlock.allocation_id == imt.id,
                    SpectrumBlock.freq_high > block_f_low,
                    SpectrumBlock.freq_low < block_f_high,
                )
                sb_result = await self.db.execute(sb_query)
                overlapping_blocks = sb_result.scalars().all()
                
                if not overlapping_blocks:
                    continue  # No frequency conflict
                
                # Parse IMT's polygon
                imt_coords = None
                if imt.polygon_geojson:
                    try:
                        imt_coords = _parse_polygon_coords(imt.polygon_geojson)
                    except Exception:
                        pass
                
                if not imt_coords and imt.area_wkt:
                    try:
                        imt_coords = _parse_wkt_polygon(imt.area_wkt)
                    except Exception:
                        pass
                
                if not imt_coords:
                    # Fallback: use cell radius to create a rough circle
                    # For PN check, skip if we can't parse coordinates
                    continue
                
                # Check adjacency: are the polygons close?
                dist = _polygon_to_polygon_min_distance_km(polygon_coords, imt_coords)
                
                if dist <= pn_buffer_km:
                    block.status = "blocked_by_pn"
                    block.blocked_by.append(f"PN: {imt.name} ({imt.operator})")
                    dist_label = "ซ้อนทับ" if dist < 0.01 else f"ห่าง {dist:.1f} km"
                    block.reason = (
                        f"ไม่สามารถจัดสรร — {imt.name} ({imt.operator}) "
                        f"ใช้ช่อง {imt_bw_for_display(overlapping_blocks)} "
                        f"ในพื้นที่ข้างเคียง ({dist_label})"
                    )
                    break  # PN already blocked — no need to check more IMTs
            
            # ── FS LoS Check ── (skip if already blocked by PN)
            if block.status == "available":
                for fs in fs_links:
                    # Frequency overlap?
                    if not _freq_overlap(block_f_low, block_f_high, fs.freq_low, fs.freq_high):
                        continue
                    
                    # LoS check: Fresnel zone intersection
                    fs_center_freq = (fs.freq_low + fs.freq_high) / 2
                    
                    if _fs_has_los_to_polygon(
                        fs.tx_lat, fs.tx_lon,
                        fs.rx_lat, fs.rx_lon,
                        fs_center_freq,
                        polygon_coords,
                    ):
                        block.status = "blocked_by_fs"
                        block.blocked_by.append(f"FS: {fs.name} ({fs.operator})")
                        block.reason = (
                            f"ไม่สามารถจัดสรร — FS Link {fs.name} ({fs.operator}) "
                            f"ใช้งาน {fs.freq_low}-{fs.freq_high} MHz "
                            f"ในแนว Line-of-Sight"
                        )
                        break
        
        # ── Summary ──
        available_count = sum(1 for b in blocks if b.status == "available")
        pn_blocked = sum(1 for b in blocks if b.status == "blocked_by_pn")
        fs_blocked = sum(1 for b in blocks if b.status == "blocked_by_fs")
        
        summary = (
            f"ตรวจสอบคลื่นความถี่ 4800-4990 MHz ({self.num_blocks} ช่อง): "
            f"✅ ว่าง {available_count} ช่อง, "
            f"🔴 ติด PN {pn_blocked} ช่อง, "
            f"🔴 ติด FS (LoS) {fs_blocked} ช่อง "
            f"(จาก IMT {len(imt_allocations)} สถานี, FS {len(fs_links)} เส้น)"
        )
        
        return AvailabilityResult(
            blocks=blocks,
            polygon_area_km2=round(polygon_area, 3),
            pn_buffer_km=pn_buffer_km,
            existing_imt_count=len(imt_allocations),
            existing_fs_count=len(fs_links),
            summary=summary,
        )


def imt_bw_for_display(sb_blocks) -> str:
    """Format spectrum blocks for display in reason text."""
    if not sb_blocks:
        return "?"
    freqs = []
    for sb in sb_blocks[:3]:  # Show at most 3
        freqs.append(f"{sb.freq_low:.0f}-{sb.freq_high:.0f}")
    if len(sb_blocks) > 3:
        freqs.append("...")
    return ", ".join(freqs)
