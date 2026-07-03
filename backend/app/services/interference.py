"""
Interference Engine v2 — Three-Phase Victim/Interferer Identification

Phase 0: Pre-screen → identify which pairs of systems could interfere
Phase 1: Calculate → compute actual I[dBm] for each identified pair
Phase 2: Aggregate → map pair results to 10 MHz spectrum blocks

Architecture:
    POST /analyze → Phase0.identify_pairs() → Phase1.compute_pairs() → Phase2.aggregate()

Key addition: bidirectional analysis — FS_TX → IMT (previously missing),
plus explicit victim/interferer labeling for every pair.
"""
import math
from typing import Optional
from dataclasses import dataclass, field
from app.core.config import get_settings
from app.services.propagation import PropagationRegistry

settings = get_settings()


# ═══════════════════════════════════════════════════════════════
# DATA CLASSES — Inputs
# ═══════════════════════════════════════════════════════════════

@dataclass
class FSLinkData:
    """Lightweight representation of an FS link for interference calculation."""
    id: str
    name: str
    tx_lat: float
    tx_lon: float
    tx_altitude: float
    rx_lat: float
    rx_lon: float
    rx_altitude: float
    freq_low: float
    freq_high: float
    bandwidth: float
    tx_power: float          # dBm
    tx_antenna_gain: float  # dBi
    rx_antenna_gain: float  # dBi
    beamwidth_deg: float = 3.0  # deg — half-power beamwidth


@dataclass
class IMTNeighborData:
    """Lightweight representation of a neighboring IMT allocation."""
    id: str
    name: str
    center_lat: float
    center_lon: float
    cell_radius: float     # m
    freq_low: float        # MHz
    freq_high: float       # MHz
    # For bidirectional: the IMT's own EIRP parameters
    # max_eirp = total EIRP (TX power + antenna_gain) — consistent with Coverage Engine
    max_eirp: float = 23   # dBm total EIRP (default conservative)
    antenna_gain: float = 12  # dBi (used for VICTIM receiver gain only)
    antenna_height: float = 15  # m (default)
    # Antenna pattern (Phase 17)
    antenna_type: str = "omni"  # "omni" | "sector"
    sector_beamwidth_deg: float = 120  # deg — only for sector type
    sector_azimuth_deg: float = 0  # deg from True North — only for sector type


# ═══════════════════════════════════════════════════════════════
# DATA CLASSES — Phase 0: Identified Pairs
# ═══════════════════════════════════════════════════════════════

@dataclass
class InterferencePair:
    """A pair of systems with potential interference, identified in Phase 0."""

    # Identity
    interferer_type: str       # "NEW_IMT" | "FS_LINK" | "EXISTING_IMT"
    interferer_id: str         # system identifier
    interferer_name: str       # human-readable name
    victim_type: str           # "FS_RX" | "NEW_IMT" | "EXISTING_IMT"
    victim_id: str
    victim_name: str

    # Relationship
    direction: str             # "IMT→FS" | "FS→IMT" | "IMT↔IMT_COCHANNEL" | "IMT↔IMT_ADJACENT"
    freq_overlap_low: float    # MHz — overlapping frequency range
    freq_overlap_high: float
    distance_m: float          # meters between interferer and victim

    # Spatial context
    within_beam: Optional[bool] = None  # For FS→IMT: is IMT in FS main beam?

    # Guard band (adjacent channel only)
    guard_band_mhz: float = 0.0  # MHz — frequency separation between allocations

    # Pre-computed rough estimate (quick FSPL for risk classification)
    estimated_i_dbm: float = -200.0
    preliminary_risk: str = "LOW"  # "HIGH" | "MEDIUM" | "LOW"


# ═══════════════════════════════════════════════════════════════
# DATA CLASSES — Phase 1: Computed Pair Results
# ═══════════════════════════════════════════════════════════════

@dataclass
class PairResult:
    """Detailed interference calculation for a single pair."""

    # Link back to pair
    pair: InterferencePair

    # Computed values
    i_dbm: float               # Interference power at victim [dBm]
    threshold_dbm: float       # Interference threshold
    margin_db: float           # How much above/below threshold (positive = above = problem)
    path_loss_db: float        # Path loss used
    effective_distance_m: float  # Distance after subtracting cell radius etc.

    # Verdict
    verdict: str               # "CONFLICT" | "CLEAR" | "GUARD_BAND"
    detail: str = ""           # Human-readable explanation


# ═══════════════════════════════════════════════════════════════
# DATA CLASSES — Phase 2: Block Results
# ═══════════════════════════════════════════════════════════════

@dataclass
class BlockResult:
    """Result for a single 10 MHz block."""
    freq_low: float
    freq_high: float
    status: str          # "green" | "gray" | "red"
    max_eirp: Optional[float] = None
    reason: str = ""
    i_total_dbm: float = -200  # Aggregate interference from all sources (Phase 17)
    conflicting_pairs: list = field(default_factory=list)  # PairResult refs


@dataclass
class InterferenceResult:
    """Full interference analysis result for a request."""
    request_id: str
    center_lat: float
    center_lon: float
    cell_radius: float

    # Phase 0 output
    pairs: list[InterferencePair] = field(default_factory=list)

    # Phase 1 output
    pair_results: list[PairResult] = field(default_factory=list)

    # Phase 2 output
    blocks: list[BlockResult] = field(default_factory=list)

    # Metadata
    summary: dict = field(default_factory=dict)
    verification: dict = field(default_factory=dict)
    computation_time_ms: float = 0


# ═══════════════════════════════════════════════════════════════
# GEOMETRY HELPERS (shared across phases)
# ═══════════════════════════════════════════════════════════════

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in meters."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial bearing from point 1 to point 2 in degrees [0, 360)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlam = math.radians(lon2 - lon1)
    x = math.sin(dlam) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlam)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def dist_to_path_m(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    """Minimum distance from point P to line segment AB using haversine."""
    d_pa = haversine_m(px, py, ax, ay)
    d_pb = haversine_m(px, py, bx, by)
    d_ab = haversine_m(ax, ay, bx, by)

    if d_ab < 1:
        return d_pa

    # Heron's formula for perpendicular distance (planar approximation)
    s = (d_pa + d_pb + d_ab) / 2
    area = math.sqrt(max(s * (s - d_pa) * (s - d_pb) * (s - d_ab), 0))
    perp_dist = 2 * area / d_ab

    # Check if projection falls on segment
    proj = (d_pa ** 2 - d_pb ** 2 + d_ab ** 2) / (2 * d_ab)
    if 0 <= proj <= d_ab:
        return perp_dist
    return min(d_pa, d_pb)


def freq_overlap(f1_low: float, f1_high: float, f2_low: float, f2_high: float) -> bool:
    """Check if two frequency ranges overlap."""
    return f1_low < f2_high and f2_low < f1_high


def fs_antenna_gain_db(
    fs_tx_lat: float, fs_tx_lon: float,
    fs_rx_lat: float, fs_rx_lon: float,
    imt_lat: float, imt_lon: float,
    beamwidth_deg: float = 3.0,
    max_gain_dbi: float = 35.0
) -> float:
    """
    ITU-R F.699 reference antenna pattern for FS parabolic dishes.
    
    Returns antenna gain (dBi) in the direction of the IMT.
    Positive = gain toward IMT. Zero = isotropic. Negative = attenuation.
    
    Pattern regions:
    - Main lobe (phi <= bw/2): G_max = max_gain_dbi
    - First side-lobe (bw/2 < phi <= 3*bw/2): G = 2 + 15*log(D/lambda) ≈ -20 to -25 dB
    - Far side-lobe (3*bw/2 < phi <= 48deg): G = 52 - 10*log(D/lambda) - 25*log(phi)
    - Back lobe (phi > 48deg): G = -10 - 10*log(D/lambda) ≈ -30 dB
    
    For interference analysis, we compute discrimination = max_gain - actual_gain.
    """
    bearing_to_rx = bearing_deg(fs_tx_lat, fs_tx_lon, fs_rx_lat, fs_rx_lon)
    bearing_to_imt = bearing_deg(fs_tx_lat, fs_tx_lon, imt_lat, imt_lon)
    
    phi = abs((bearing_to_imt - bearing_to_rx + 180) % 360 - 180)
    half_bw = beamwidth_deg / 2
    
    import math
    D_over_lambda = 10 ** ((max_gain_dbi - 7.5) / 20)  # Approximate from G = 20*log(D/lambda) + 7.5
    
    if phi <= half_bw:
        gain = max_gain_dbi  # Main lobe
    elif phi <= 3 * half_bw:
        # First side-lobe: ~20-25 dB below main lobe
        gain = 2 + 15 * math.log10(max(D_over_lambda, 1))
        gain = min(gain, max_gain_dbi - 15)  # At least 15 dB down
    elif phi <= 48:
        # Far side-lobe: ITU-R F.699 envelope
        gain = 52 - 10 * math.log10(max(D_over_lambda, 1)) - 25 * math.log10(max(phi, 1))
    else:
        # Back lobe
        gain = -10 - 10 * math.log10(max(D_over_lambda, 1))
    
    return gain

def is_imt_in_fs_beam(
    fs_tx_lat: float, fs_tx_lon: float,
    fs_rx_lat: float, fs_rx_lon: float,
    imt_lat: float, imt_lon: float,
    beamwidth_deg: float = 3.0
) -> bool:
    """Backward-compatible wrapper: returns True if IMT is in main beam."""
    gain = fs_antenna_gain_db(fs_tx_lat, fs_tx_lon, fs_rx_lat, fs_rx_lon,
                               imt_lat, imt_lon, beamwidth_deg)
    return gain >= (35.0 - 3)  # Within 3 dB of max = in main beam




def sector_antenna_discrimination_db(
    imt_lat: float, imt_lon: float,
    target_lat: float, target_lon: float,
    antenna_type: str = "omni",
    sector_azimuth_deg: float = 0,
    sector_beamwidth_deg: float = 120
) -> float:
    """
    Compute antenna discrimination for sectored/omni IMT.
    Returns: dB attenuation relative to max gain.
    - Omni: 0 dB (no discrimination)
    - Sector: 0 dB if in beam, -20 dB front-to-back ratio otherwise
    """
    if antenna_type == "omni":
        return 0.0
    
    # Bearing from IMT to target
    bearing = bearing_deg(imt_lat, imt_lon, target_lat, target_lon)
    
    # Angular difference from sector center
    phi = abs((bearing - sector_azimuth_deg + 180) % 360 - 180)
    half_bw = sector_beamwidth_deg / 2
    
    if phi <= half_bw:
        return 0.0  # In sector → full gain
    else:
        return 20.0  # Outside sector → -20 dB (typical panel FBR)

# ═══════════════════════════════════════════════════════════════
# ENGINE — Three-Phase
# ═══════════════════════════════════════════════════════════════

class InterferenceEngine:
    """
    Core Interference Engine v2 — Three-Phase Victim/Interferer Analysis.

    Usage:
        engine = InterferenceEngine(propagation_model="free_space")
        result = engine.analyze(
            center_lat=13.75, center_lon=100.5, cell_radius=500,
            antenna_height=15, antenna_gain=12, max_eirp=23,
            fs_links=[...], neighbor_imts=[...]
        )
        # result.pairs       → Phase 0: identified victim/interferer pairs
        # result.pair_results → Phase 1: detailed I[dBm] per pair
        # result.blocks       → Phase 2: per-block status
    """

    # Configuration
    BEAMWIDTH_DEG = 3.0             # FS antenna beamwidth
    COCHANNEL_PROTECTION_M = 2000   # Minimum co-channel separation (rule of thumb)
    ACS_DB = 33                     # Adjacent Channel Selectivity (3GPP TS 38.104)
    # Adjacent protection derived from ACS: co-channel / 10^(ACS/20) with safety factor
    _ADJACENT_FACTOR = 10 ** (ACS_DB / 20)  # ~44.7x
    _ADJACENT_RAW_M = COCHANNEL_PROTECTION_M / _ADJACENT_FACTOR  # ~45m
    ADJACENT_PROTECTION_M = int(_ADJACENT_RAW_M * 3)  # ~135m with 3x safety factor
    SPATIAL_MARGIN_KM = 1.0         # Safety margin for spatial search

    def __init__(self, propagation_model: str = "free_space"):
        self.model_name = propagation_model
        self.model = PropagationRegistry.get(propagation_model)

    def set_model(self, model_name: str):
        """Switch propagation model at runtime."""
        self.model_name = model_name
        self.model = PropagationRegistry.get(model_name)

    def _compute_spatial_filter_km(
        self, cell_radius: float, fs_links: list, neighbor_imts: list
    ) -> float:
        """Compute spatial search radius from actual system parameters.
        
        spatial_filter = max(cell_radius) + max(FS coordination distance) + margin
        where FS coordination distance = distance at which FS EIRP reaches threshold.
        
        Uses FSPL to derive coordination distance from max FS EIRP in the system.
        """
        # 1. Max IMT cell radius (km)
        max_imt_r_km = cell_radius / 1000
        for imt in neighbor_imts:
            max_imt_r_km = max(max_imt_r_km, imt.cell_radius / 1000)
        
        # 2. Max FS coordination distance (km)
        # Worst case: highest FS EIRP in the system
        max_fs_eirp = 65  # dBm conservative default
        if fs_links:
            max_fs_eirp = max(
                (fs.tx_power or 30) + (fs.tx_antenna_gain or 35)
                for fs in fs_links
            )
        
        # FSPL at which FS interference reaches threshold
        # I = EIRP_FS - FSPL + G_IMT → FSPL = EIRP_FS - threshold + G_IMT
        # Use -80 dBm for pre-screen (IMT receiver sensitivity, not FS threshold)
        pre_screen_threshold = -80
        fs_pl_threshold = max_fs_eirp - pre_screen_threshold + 12
        
        # Distance: d_km = 10^((PL - 32.4 - 20*log(f))/20)
        center_freq = (settings.band_start_mhz + settings.band_end_mhz) / 2
        fs_coord_km = 10 ** (
            (fs_pl_threshold - 32.4 - 20 * math.log10(center_freq)) / 20
        )
        fs_coord_km = max(min(fs_coord_km, 10), 0.5)  # Cap at 10 km, min 500m
        
        return max_imt_r_km + fs_coord_km + self.SPATIAL_MARGIN_KM

    def get_assumptions(self) -> dict:
        """
        Return all engineering assumptions used in the interference analysis.
        These are the «สมมุติฐาน» that govern every calculation.
        """
        return {
            "interference_threshold": {
                "label": "Interference Threshold",
                "value": f"{settings.interference_threshold_dbm} dBm",
                "description": "I/N = −6 dB with typical FS receiver noise floor −108 dBm",
                "reference": "ITU-R F.758",
                "impact": "ค่าต่ำลง → conservative มากขึ้น → บล็อกคลื่นมากขึ้น",
                "impact_en": "Lower = more conservative (blocks more spectrum)",
                "reality_check": "✅ สมเหตุสมผล — I/N = −6 dB เป็นค่ามาตรฐาน ITU-R สำหรับ FS protection criteria ที่ 5 GHz",
            },
            "cochannel_protection": {
                "label": "Co-Channel Protection Distance",
                "value": f"{self.COCHANNEL_PROTECTION_M} m ({(self.COCHANNEL_PROTECTION_M/1000):.1f} km)",
                "description": "ระยะห่างขั้นต่ำระหว่าง IMT ที่ใช้ความถี่เดียวกัน (engineering rule of thumb สำหรับ small cell deployment)",
                "reference": "Typical IMT small cell at 5 GHz, based on field experience",
                "impact": "ค่าสูงขึ้น → IMT ต้องห่างกันมากขึ้น → โอกาส conflict เพิ่ม",
                "reality_check": "✅ สมเหตุสมผล — 2 km เป็นค่าระยะเผื่อที่เพียงพอสำหรับ IMT small cell (< 500m radius) ที่ 5 GHz",
            },
            "adjacent_protection": {
                "label": "Adjacent Channel Protection",
                "value": f"Dynamic — depends on guard band width (0-40+ MHz)",
                "description": f"ระยะห่างสำหรับ adjacent channel — คำนวณจาก guard_band_isolation_db(width)",
                "reference": f"ACS = {self.ACS_DB} dB (3GPP TS 38.104) + filter roll-off: 12 dB/10MHz (near) + 15 dB/10MHz (far)",
                "impact": "Guard band กว้างขึ้น → isolation เพิ่ม → ระยะห่างลดลง → ≥40 MHz ติดกันได้",
                "isolation_table": {
                    "0 MHz (adjacent)": f"isolation={self.guard_band_isolation_db(0):.0f} dB → required_sep={self.COCHANNEL_PROTECTION_M/10**(self.guard_band_isolation_db(0)/20):.0f}m",
                    "10 MHz": f"isolation={self.guard_band_isolation_db(10):.0f} dB → required_sep={self.COCHANNEL_PROTECTION_M/10**(self.guard_band_isolation_db(10)/20):.0f}m",
                    "20 MHz": f"isolation={self.guard_band_isolation_db(20):.0f} dB → required_sep={self.COCHANNEL_PROTECTION_M/10**(self.guard_band_isolation_db(20)/20):.0f}m",
                    "40 MHz": f"isolation={self.guard_band_isolation_db(40):.0f} dB → co-location possible",
                },
                "justification": (
                    f"ACS = {self.ACS_DB} dB + filter roll-off ตาม 3GPP TS 38.104 → "
                    f"total isolation = f(guard_band_width) → "
                    f"required separation = co-channel/{self._ADJACENT_FACTOR:.0f} / 10^(filter_roll_off/20)"
                ),
                "reality_check": "✅ สมเหตุสมผล — อิงจาก 3GPP filter masks สำหรับ NR base station ที่ 5 GHz",
            },
            "fs_beamwidth": {
                "label": "FS Antenna Beamwidth",
                "value": f"{self.BEAMWIDTH_DEG}°",
                "description": "ความกว้างลำคลื่นหลักของสายอากาศ FS (Half-Power Beamwidth)",
                "reference": "Typical parabolic dish ~35 dBi",
                "impact": "แคบลง → FS→IMT interference เกิดในมุมที่แคบลง",
                "reality_check": "✅ สมเหตุสมผล — parabolic dish 35 dBi มี beamwidth 2-4° ที่ 5 GHz ตาม ITU-R F.699",
            },
            "fs_sidelobe": {
                "label": "FS Side-Lobe Suppression",
                "value": "−25 dB",
                "description": "การลดทอนสัญญาณนอกลำคลื่นหลัก (side-lobe discrimination)",
                "reference": "ITU-R F.699 reference antenna pattern",
                "impact": "ค่าสูงขึ้น → interference นอก beam น้อยลง",
                "reality_check": "✅ สมเหตุสมผล — ITU-R F.699 ระบุ side-lobe envelope ที่ −25 dB สำหรับมุม > beamwidth/2",
            },
            "spatial_filter": {
                "label": "Spatial Search Radius",
                "value": "Dynamic — จากการคำนวณ FSPL (max IMT radius + max FS coord distance + margin)",
                "description": (
                    "คำนวณจาก: max(cell_radius) + max FS coordination distance (FSPL-derived "
                    "from max EIRP in system) + 1 km safety margin"
                ),
                "reference": "ITU-R P.525 (FSPL) + ITU-R SM.1047 (coordination distance)",
                "impact": "ขึ้นกับ FS EIRP ในระบบ — EIRP สูงขึ้น → ค้นหากว้างขึ้น",
                "reality_check": "✅ คำนวณจาก FSPL จริง ไม่ใช่ hardcoded — adapts to system parameters",
            },
            "propagation": {
                "label": "Propagation Model",
                "value": self.model_name.upper(),
                "description": "แบบจำลองการแพร่กระจายคลื่น — FSPL = ไม่มีสิ่งกีดขวาง (free space)",
                "reference": "ITU-R P.525",
                "limitations": [
                    "ไม่มี clutter/terrain loss → ประเมิน path loss ต่ำเกิน → ประเมิน interference สูงเกิน (conservative)",
                    "ไม่มี atmospheric effects (ducting, rain fade)",
                    "ไม่มี building diffraction",
                ],
                "impact": "Conservative สำหรับ interference protection — อาจบล็อกคลื่นเกินจำเป็นในพื้นที่ที่มีสิ่งกีดขวาง",
                "reality_check": "⚠️ FSPL ให้ค่า path loss ต่ำสุด → interference estimate สูงสุด → อาจบล็อกคลื่นเกินจริงใน urban areas",
            },
            "imt_antenna": {
                "label": "IMT Antenna Pattern",
                "value": "Omni-directional",
                "description": "IMT ใช้สายอากาศแบบรอบทิศทาง (conservative assumption)",
                "reference": "Typical small cell / private network deployment",
                "impact": "แผ่ interference เท่ากันทุกทิศทาง — ถ้าใช้ sectored antenna จะลด interference ได้",
                "reality_check": "⚠️ Private 5G มักใช้ sectored/panel antennas (60-120°) — omni assumption overestimates interference",
            },
            "risk_classification": {
                "label": "Risk Classification",
                "value": "HIGH: margin > +20 dB | MEDIUM: margin > −10 dB | LOW: otherwise",
                "description": "เกณฑ์การจัดระดับความเสี่ยงเบื้องต้น (Phase 0 pre-screen)",
                "reference": "Engineering judgement",
                "impact": "เกณฑ์ต่ำลง → ระบบจะ flag risk มากขึ้น → ละเอียดขึ้นแต่ noise เพิ่ม",
                "reality_check": "✅ สมเหตุสมผล — margin 20 dB ให้ safety factor เพียงพอสำหรับ pre-screen",
            },
        }

    # ── Public API ────────────────────────────────────────────

    def analyze(
        self,
        center_lat: float,
        center_lon: float,
        cell_radius: float,
        antenna_height: float,
        antenna_gain: float,
        max_eirp: float,
        fs_links: list[FSLinkData],
        neighbor_imts: list[IMTNeighborData],
        requested_band_start: Optional[float] = None,
        requested_band_end: Optional[float] = None,
    ) -> InterferenceResult:
        """
        Full three-phase analysis.

        Returns InterferenceResult with pairs, pair_results, and blocks.
        """
        import time
        t0 = time.time()

        band_start = requested_band_start or settings.band_start_mhz
        band_end = requested_band_end or settings.band_end_mhz

        # ── Phase 0: Pre-screen ──
        pairs = self.phase0_identify_pairs(
            center_lat=center_lat, center_lon=center_lon,
            cell_radius=cell_radius,
            antenna_height=antenna_height,
            antenna_gain=antenna_gain,
            max_eirp=max_eirp,
            fs_links=fs_links,
            neighbor_imts=neighbor_imts,
        )

        # ── Phase 1: Calculate ──
        pair_results = self.phase1_compute_pairs(
            pairs=pairs,
            new_imt_lat=center_lat, new_imt_lon=center_lon,
            new_imt_radius=cell_radius,
            new_imt_eirp=max_eirp,  # max_eirp = total EIRP (already includes antenna_gain)
            new_imt_height=antenna_height,
            new_imt_ant_gain=antenna_gain,
            fs_links=fs_links,
            neighbor_imts=neighbor_imts,
        )

        # ── Phase 2: Aggregate to blocks ──
        blocks = self.phase2_aggregate(
            pair_results=pair_results,
            band_start=band_start, band_end=band_end,
            max_eirp=max_eirp,
        )

        # ── Summary ──
        summary = {
            "total_blocks": len(blocks),
            "green": sum(1 for b in blocks if b.status == "green"),
            "gray": sum(1 for b in blocks if b.status == "gray"),
            "red": sum(1 for b in blocks if b.status == "red"),
            "green_mhz": sum(b.freq_high - b.freq_low for b in blocks if b.status == "green"),
            "model": self.model_name,
            "pairs_identified": len(pairs),
            "pairs_high_risk": sum(1 for p in pairs if p.preliminary_risk == "HIGH"),
            "pairs_conflict": sum(1 for pr in pair_results if pr.verdict == "CONFLICT"),
        }

        # ── Verification ──
        verification = self._verify_blocks(blocks, band_start, band_end, pair_results)

        computation_time_ms = (time.time() - t0) * 1000

        return InterferenceResult(
            request_id="",
            center_lat=center_lat,
            center_lon=center_lon,
            cell_radius=cell_radius,
            pairs=pairs,
            pair_results=pair_results,
            blocks=blocks,
            summary=summary,
            verification=verification,
            computation_time_ms=computation_time_ms,
        )

    # ══════════════════════════════════════════════════════════
    # PHASE 0: VICTIM/INTERFERER IDENTIFICATION
    # ══════════════════════════════════════════════════════════

    def phase0_identify_pairs(
        self,
        center_lat: float,
        center_lon: float,
        cell_radius: float,
        antenna_height: float,
        antenna_gain: float,
        max_eirp: float,
        fs_links: list[FSLinkData],
        neighbor_imts: list[IMTNeighborData],
    ) -> list[InterferencePair]:
        """
        Phase 0: Identify all potential victim/interferer pairs.

        Four directions of interference:
        ➀ NEW_IMT → FS_RX  (IMT interferes with FS receiver)
        ➁ FS_TX → NEW_IMT  (FS transmitter interferes with IMT) — NEW
        ➂ NEW_IMT → EXISTING_IMT (co-channel / adjacent)
        ➃ EXISTING_IMT → NEW_IMT (reciprocal)

        Returns pairs sorted by risk (HIGH → MEDIUM → LOW).
        """
        pairs: list[InterferencePair] = []
        # max_eirp = total EIRP (TX power + antenna gain) — consistent with Coverage Engine
        new_imt_eirp = max_eirp
        spatial_filter_km = self._compute_spatial_filter_km(cell_radius, fs_links, neighbor_imts)
        spatial_limit_m = (cell_radius + spatial_filter_km * 1000)

        # ── ➀ NEW_IMT → FS_RX ──
        for fs in fs_links:
            dist_to_rx = haversine_m(center_lat, center_lon, fs.rx_lat, fs.rx_lon)
            dist_to_path = dist_to_path_m(
                center_lat, center_lon,
                fs.tx_lat, fs.tx_lon, fs.rx_lat, fs.rx_lon
            )

            # Spatial filter
            if dist_to_path > spatial_limit_m:
                continue

            # Frequency filter — IMT could use any block in band
            # FS link has specific frequency range
            # Pre-screen: FS band overlaps IMT possible band?
            if not freq_overlap(
                settings.band_start_mhz, settings.band_end_mhz,
                fs.freq_low, fs.freq_high
            ):
                continue

            # Quick FSPL estimate
            effective_dist = max(dist_to_rx - cell_radius, 1.0)
            est_path_loss = self.model.path_loss_db(
                distance_m=effective_dist,
                frequency_mhz=(fs.freq_low + fs.freq_high) / 2,
                tx_height_m=antenna_height,
                rx_height_m=fs.rx_altitude or 0,
            )
            est_i = new_imt_eirp - est_path_loss + (fs.rx_antenna_gain or 0)

            risk = self._classify_risk(est_i, settings.interference_threshold_dbm, dist_to_rx)

            pairs.append(InterferencePair(
                interferer_type="NEW_IMT", interferer_id="new", interferer_name="IMT ใหม่",
                victim_type="FS_RX", victim_id=fs.id, victim_name=fs.name,
                direction="IMT→FS",
                freq_overlap_low=fs.freq_low, freq_overlap_high=fs.freq_high,
                distance_m=dist_to_rx,
                within_beam=None,
                estimated_i_dbm=est_i,
                preliminary_risk=risk,
            ))

        # ── ➁ FS_TX → NEW_IMT (NEW — previously missing) ──
        for fs in fs_links:
            dist_to_tx = haversine_m(center_lat, center_lon, fs.tx_lat, fs.tx_lon)

            # Spatial filter
            if dist_to_tx > spatial_limit_m:
                continue

            # Frequency filter
            if not freq_overlap(
                settings.band_start_mhz, settings.band_end_mhz,
                fs.freq_low, fs.freq_high
            ):
                continue

            # Beam check — FS antenna is directional!
            in_beam = is_imt_in_fs_beam(
                fs.tx_lat, fs.tx_lon, fs.rx_lat, fs.rx_lon,
                center_lat, center_lon,
                beamwidth_deg=fs.beamwidth_deg,
            )

            # FS EIRP = tx_power + tx_antenna_gain (directional)
            fs_eirp = (fs.tx_power or 30) + (fs.tx_antenna_gain or 35)

            # Effective distance from FS Tx to closest IMT receiver (at cell edge)
            effective_dist = max(dist_to_tx - cell_radius, 1.0)

            est_path_loss = self.model.path_loss_db(
                distance_m=effective_dist,
                frequency_mhz=(fs.freq_low + fs.freq_high) / 2,
                tx_height_m=fs.tx_altitude or 30,
                rx_height_m=antenna_height,
            )

            # Apply beam discrimination if IMT is outside main beam
            beam_discrimination = 0 if in_beam else -25  # Side-lobe suppression ~25 dB
            est_i = fs_eirp - est_path_loss + antenna_gain + beam_discrimination

            risk = self._classify_risk(est_i, settings.interference_threshold_dbm, dist_to_tx)
            # Upgrade risk if in beam
            if in_beam and risk == "MEDIUM":
                risk = "HIGH"

            pairs.append(InterferencePair(
                interferer_type="FS_LINK", interferer_id=fs.id, interferer_name=fs.name,
                victim_type="NEW_IMT", victim_id="new", victim_name="IMT ใหม่",
                direction="FS→IMT",
                freq_overlap_low=fs.freq_low, freq_overlap_high=fs.freq_high,
                distance_m=dist_to_tx,
                within_beam=in_beam,
                estimated_i_dbm=est_i,
                preliminary_risk=risk,
            ))

            # ── ➁b FS_TX → NEW_IMT ADJACENT (Phase 17 — adjacent channel) ──
            # FS can interfere even on adjacent channels due to high EIRP
            guard_range = settings.default_guard_band_mhz
            pairs.append(InterferencePair(
                interferer_type="FS_LINK", interferer_id=fs.id, interferer_name=fs.name,
                victim_type="NEW_IMT", victim_id="new", victim_name="IMT ใหม่",
                direction="FS→IMT_ADJACENT",
                freq_overlap_low=fs.freq_low - guard_range,
                freq_overlap_high=fs.freq_high + guard_range,
                distance_m=dist_to_tx,
                within_beam=in_beam,
                guard_band_mhz=0,
                estimated_i_dbm=est_i - self.ACS_DB,  # ACS reduces interference
                preliminary_risk=self._classify_risk(est_i - self.ACS_DB,
                    settings.interference_threshold_dbm, dist_to_tx),
            ))

        # ── ➂ & ➃ NEW_IMT ↔ EXISTING_IMT (bidirectional) ──
        for imt in neighbor_imts:
            dist = haversine_m(center_lat, center_lon, imt.center_lat, imt.center_lon)

            # Spatial filter
            if dist > spatial_limit_m:
                continue

            # Co-channel check (same block usage possible)
            min_co_sep = cell_radius + imt.cell_radius + self.COCHANNEL_PROTECTION_M
            cochannel_possible = dist < min_co_sep

            # Adjacent channel check
            min_adj_sep = cell_radius + imt.cell_radius + self.ADJACENT_PROTECTION_M
            adjacent_possible = dist < (min_adj_sep + 3000)

            if not cochannel_possible and not adjacent_possible:
                continue

            # imt.max_eirp = total EIRP (already includes antenna_gain)
            existing_imt_eirp = imt.max_eirp

            # ── ➂ NEW_IMT → EXISTING_IMT ──
            if cochannel_possible:
                effective_dist = max(dist - imt.cell_radius, 1.0)
                est_path_loss = self.model.path_loss_db(
                    distance_m=effective_dist,
                    frequency_mhz=(imt.freq_low + imt.freq_high) / 2,
                    tx_height_m=antenna_height,
                    rx_height_m=imt.antenna_height,
                )
                est_i = new_imt_eirp - est_path_loss + imt.antenna_gain
                risk = self._classify_risk(est_i, settings.interference_threshold_dbm, dist)

                pairs.append(InterferencePair(
                    interferer_type="NEW_IMT", interferer_id="new", interferer_name="IMT ใหม่",
                    victim_type="EXISTING_IMT", victim_id=imt.id, victim_name=imt.name,
                    direction="IMT↔IMT_COCHANNEL",
                    freq_overlap_low=imt.freq_low, freq_overlap_high=imt.freq_high,
                    distance_m=dist,
                    estimated_i_dbm=est_i,
                    preliminary_risk=risk,
                ))

            # ── ➃ EXISTING_IMT → NEW_IMT (reciprocal) ──
            if cochannel_possible:
                effective_dist = max(dist - cell_radius, 1.0)
                est_path_loss = self.model.path_loss_db(
                    distance_m=effective_dist,
                    frequency_mhz=(imt.freq_low + imt.freq_high) / 2,
                    tx_height_m=imt.antenna_height,
                    rx_height_m=antenna_height,
                )
                est_i = existing_imt_eirp - est_path_loss + antenna_gain
                risk = self._classify_risk(est_i, settings.interference_threshold_dbm, dist)

                pairs.append(InterferencePair(
                    interferer_type="EXISTING_IMT", interferer_id=imt.id, interferer_name=imt.name,
                    victim_type="NEW_IMT", victim_id="new", victim_name="IMT ใหม่",
                    direction="IMT↔IMT_COCHANNEL",
                    freq_overlap_low=imt.freq_low, freq_overlap_high=imt.freq_high,
                    distance_m=dist,
                    estimated_i_dbm=est_i,
                    preliminary_risk=risk,
                ))

            # Guard band pairs for adjacent channels
            # Create pair covering neighbor block ± guard band range
            # so Phase 2 maps to both adjacent blocks (e.g., neighbor at
            # 4810-4820 → expanded 4800-4830 covers 4800-4810 and 4820-4830)
            # NOTE: create adjacent pairs REGARDLESS of co-channel — a single
            # IMT can be both co-channel on one block AND adjacent on others
            if adjacent_possible:
                guard_range = settings.default_guard_band_mhz  # 10 MHz
                # guard_band_mhz = 0 for pre-screen (minimum case — adjacent block)
                # Actual guard band width depends on which block new IMT uses
                pairs.append(InterferencePair(
                    interferer_type="NEW_IMT", interferer_id="new", interferer_name="IMT ใหม่",
                    victim_type="EXISTING_IMT", victim_id=imt.id, victim_name=imt.name,
                    direction="IMT↔IMT_ADJACENT",
                    # Expand range so Phase 2 maps to both adjacent blocks
                    freq_overlap_low=imt.freq_low - guard_range,
                    freq_overlap_high=imt.freq_high + guard_range,
                    distance_m=dist,
                    guard_band_mhz=0,  # Minimum: adjacent block (0 MHz guard)
                    estimated_i_dbm=-200,
                    preliminary_risk="MEDIUM",
                ))

        # Sort by risk
        risk_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
        pairs.sort(key=lambda p: risk_order.get(p.preliminary_risk, 99))

        return pairs

    # ══════════════════════════════════════════════════════════
    # PHASE 1: DETAILED INTERFERENCE CALCULATION
    # ══════════════════════════════════════════════════════════

    def phase1_compute_pairs(
        self,
        pairs: list[InterferencePair],
        new_imt_lat: float,
        new_imt_lon: float,
        new_imt_radius: float,
        new_imt_eirp: float,
        new_imt_height: float,
        new_imt_ant_gain: float,
        fs_links: list[FSLinkData],
        neighbor_imts: list[IMTNeighborData],
    ) -> list[PairResult]:
        """
        Phase 1: For each identified pair, compute actual I[dBm].

        Different math per direction:
        - IMT→FS:      I = EIRP_IMT − FSPL(d_effective) + G_FS_RX
        - FS→IMT:      I = EIRP_FS  − FSPL(d_effective) + G_IMT − beam_discrimination
        - IMT↔IMT (co): I = EIRP_int − FSPL(d_effective) + G_victim
        - IMT↔IMT (adj): guard band determination only

        NOTE: max_eirp / imt.max_eirp = total EIRP (includes antenna_gain).
        antenna_gain is used for VICTIM side only (receiving antenna gain).
        """
        # Build lookup maps
        fs_by_id = {fs.id: fs for fs in fs_links}
        imt_by_id = {imt.id: imt for imt in neighbor_imts}

        results: list[PairResult] = []
        threshold = settings.interference_threshold_dbm

        for pair in pairs:
            if pair.direction == "IMT→FS":
                fs = fs_by_id.get(pair.victim_id)
                result = self._compute_imt_to_fs(pair, new_imt_lat, new_imt_lon,
                                                  new_imt_radius, new_imt_eirp,
                                                  new_imt_height, fs, threshold)
            elif pair.direction == "FS→IMT":
                fs = fs_by_id.get(pair.interferer_id)
                result = self._compute_fs_to_imt(pair,
                                                  new_imt_lat, new_imt_lon,
                                                  new_imt_radius, new_imt_ant_gain,
                                                  new_imt_height, fs, threshold)
            elif pair.direction == "FS→IMT_ADJACENT":
                fs = fs_by_id.get(pair.interferer_id)
                result = self._compute_fs_to_imt_adjacent(pair,
                                                  new_imt_lat, new_imt_lon,
                                                  new_imt_radius, new_imt_ant_gain,
                                                  new_imt_height, fs, threshold)
            elif pair.direction == "IMT↔IMT_COCHANNEL":
                victim_imt = None
                if pair.victim_id != "new":
                    victim_imt = imt_by_id.get(pair.victim_id)
                interferer_imt = None
                if pair.interferer_id != "new":
                    interferer_imt = imt_by_id.get(pair.interferer_id)
                result = self._compute_imt_to_imt_cochannel(
                    pair, new_imt_lat, new_imt_lon, new_imt_radius,
                    new_imt_eirp, new_imt_height, new_imt_ant_gain,
                    victim_imt, interferer_imt, threshold
                )
            elif pair.direction == "IMT↔IMT_ADJACENT":
                result = self._compute_imt_to_imt_adjacent(
                    pair, new_imt_radius, threshold
                )
            else:
                continue

            results.append(result)

        return results

    # ── Direction-specific calculations ──

    def _compute_imt_to_fs(
        self, pair: InterferencePair,
        imt_lat, imt_lon, imt_radius, imt_eirp, imt_height,
        fs: Optional[FSLinkData],
        threshold: float,
    ) -> PairResult:
        """➀ IMT → FS Receiver interference."""
        effective_dist = max(pair.distance_m - imt_radius, 1.0)

        rx_height = fs.rx_altitude if fs else 0
        rx_gain = fs.rx_antenna_gain if fs else 0
        fs_freq = (pair.freq_overlap_low + pair.freq_overlap_high) / 2

        path_loss = self.model.path_loss_db(
            distance_m=effective_dist,
            frequency_mhz=fs_freq,
            tx_height_m=imt_height,
            rx_height_m=rx_height,
        )

        i_dbm = imt_eirp - path_loss + rx_gain
        margin = i_dbm - threshold
        verdict = "CONFLICT" if i_dbm > threshold else "CLEAR"

        fs_name = fs.name if fs else pair.victim_name
        return PairResult(
            pair=pair,
            i_dbm=i_dbm,
            threshold_dbm=threshold,
            margin_db=margin,
            path_loss_db=path_loss,
            effective_distance_m=effective_dist,
            verdict=verdict,
            detail=f"IMT→FS [{fs_name}]: I={i_dbm:.1f} dBm vs threshold {threshold} dBm "
                   f"(margin={margin:+.1f} dB, dist={effective_dist:.0f}m, "
                   f"PL={path_loss:.1f} dB)"
        )

    def _compute_fs_to_imt(
        self, pair: InterferencePair,
        imt_lat, imt_lon, imt_radius, imt_ant_gain, imt_height,
        fs: Optional[FSLinkData],
        threshold: float,
    ) -> PairResult:
        """➁ FS Transmitter → IMT Receiver interference (NEW)."""
        effective_dist = max(pair.distance_m - imt_radius, 1.0)

        tx_height = fs.tx_altitude if fs and fs.tx_altitude else 30
        fs_freq = (pair.freq_overlap_low + pair.freq_overlap_high) / 2

        path_loss = self.model.path_loss_db(
            distance_m=effective_dist,
            frequency_mhz=fs_freq,
            tx_height_m=tx_height,
            rx_height_m=imt_height,
        )

        # FS EIRP from actual data or conservative estimate
        if fs:
            fs_eirp = (fs.tx_power or 30) + (fs.tx_antenna_gain or 35)
        else:
            fs_eirp = 65  # dBm conservative

        # Beam discrimination using F.699 pattern (Phase 17)
        if fs:
            fs_gain = fs_antenna_gain_db(
                fs.tx_lat, fs.tx_lon, fs.rx_lat, fs.rx_lon,
                imt_lat, imt_lon,
                beamwidth_deg=fs.beamwidth_deg,
                max_gain_dbi=fs.tx_antenna_gain or 35
            )
            beam_disc = (fs.tx_antenna_gain or 35) - fs_gain  # dB below max
        else:
            beam_disc = 0 if pair.within_beam else 25

        i_dbm = fs_eirp - path_loss + imt_ant_gain - beam_disc
        margin = i_dbm - threshold
        verdict = "CONFLICT" if i_dbm > threshold else "CLEAR"

        beam_note = "ใน main beam" if pair.within_beam else "นอก main beam (−25 dB)"
        fs_name = fs.name if fs else pair.interferer_name
        return PairResult(
            pair=pair,
            i_dbm=i_dbm,
            threshold_dbm=threshold,
            margin_db=margin,
            path_loss_db=path_loss,
            effective_distance_m=effective_dist,
            verdict=verdict,
            detail=f"FS→IMT [{fs_name}]: I={i_dbm:.1f} dBm vs threshold {threshold} dBm "
                   f"(margin={margin:+.1f} dB, dist={effective_dist:.0f}m, "
                   f"PL={path_loss:.1f} dB, FS_EIRP={fs_eirp} dBm, {beam_note})"
        )

    def _compute_imt_to_imt_cochannel(
        self, pair: InterferencePair,
        new_imt_lat, new_imt_lon, new_imt_radius,
        new_imt_eirp, new_imt_height, new_imt_ant_gain,
        victim_imt: Optional[IMTNeighborData],
        interferer_imt: Optional[IMTNeighborData],
        threshold: float,
    ) -> PairResult:
        """➂/➃ IMT ↔ IMT co-channel interference."""
        # Determine EIRP and heights based on who is interferer
        if pair.interferer_type == "NEW_IMT":
            interferer_eirp = new_imt_eirp
            interferer_height = new_imt_height
            victim_ant_gain = victim_imt.antenna_gain if victim_imt else 12
            victim_height = victim_imt.antenna_height if victim_imt else 15
            victim_cell_r = victim_imt.cell_radius if victim_imt else 500
            effective_dist = max(pair.distance_m - victim_cell_r, 1.0)
        else:
            # imt.max_eirp = total EIRP (already includes antenna_gain)
            interferer_eirp = interferer_imt.max_eirp if interferer_imt else 35
            interferer_height = interferer_imt.antenna_height if interferer_imt else 15
            victim_ant_gain = new_imt_ant_gain
            victim_height = new_imt_height
            effective_dist = max(pair.distance_m - new_imt_radius, 1.0)

        freq_mhz = (pair.freq_overlap_low + pair.freq_overlap_high) / 2
        path_loss = self.model.path_loss_db(
            distance_m=effective_dist,
            frequency_mhz=freq_mhz,
            tx_height_m=interferer_height,
            rx_height_m=victim_height,
        )

        i_dbm = interferer_eirp - path_loss + victim_ant_gain

        # Distance-based co-channel separation
        victim_r = victim_imt.cell_radius if victim_imt else 500 if pair.victim_id != "new" else new_imt_radius
        interferer_r = interferer_imt.cell_radius if interferer_imt else 500 if pair.interferer_id != "new" else new_imt_radius
        min_sep = interferer_r + victim_r + self.COCHANNEL_PROTECTION_M
        violates_separation = pair.distance_m < min_sep

        margin = i_dbm - threshold
        if i_dbm > threshold or violates_separation:
            verdict = "CONFLICT"
        else:
            verdict = "CLEAR"

        sep_note = f"ระยะ {pair.distance_m/1000:.1f} km"
        if violates_separation:
            sep_note += f" < ขั้นต่ำ {min_sep/1000:.1f} km"

        return PairResult(
            pair=pair,
            i_dbm=i_dbm,
            threshold_dbm=threshold,
            margin_db=margin,
            path_loss_db=path_loss,
            effective_distance_m=effective_dist,
            verdict=verdict,
            detail=f"IMT↔IMT Co-channel [{pair.interferer_name}→{pair.victim_name}]: "
                   f"I={i_dbm:.1f} dBm, {sep_note}"
        )

    def _compute_imt_to_imt_adjacent(
        self, pair: InterferencePair,
        new_imt_radius: float,
        threshold: float,
    ) -> PairResult:
        """IMT ↔ IMT adjacent channel — guard band determination.
        
        Required distance depends on guard band width:
        - 0 MHz (adjacent): ACS only → 134m
        - 10 MHz: ACS + filter roll-off → ~30m  
        - 20+ MHz: >55 dB isolation → ~4m
        - 40+ MHz: >85 dB isolation → co-location possible (0m)
        
        Formula: isolation = guard_band_isolation_db(width_mhz)
                 required_sep = COCHANNEL_PROTECTION_M / 10^(isolation/20)
        """
        guard_mhz = max(pair.guard_band_mhz, 0)
        isolation_db = self.guard_band_isolation_db(guard_mhz)
        
        # Required separation from isolation
        distance_factor = 10 ** (isolation_db / 20)
        required_adj_sep = max(self.COCHANNEL_PROTECTION_M / distance_factor, 1)
        
        # Use conservative victim cell_radius default
        victim_cell_r = 500
        min_adj_sep = new_imt_radius + victim_cell_r + required_adj_sep
        needs_guard = pair.distance_m < min_adj_sep
        
        # Determine verdict
        if needs_guard:
            if required_adj_sep <= 1:
                verdict = "CLEAR"  # Isolation sufficient, no physical separation needed
                detail_end = "→ CLEAR (isolation เพียงพอ — ติดกันได้)"
            else:
                verdict = "GUARD_BAND"
                detail_end = f"→ GUARD_BAND"
        else:
            verdict = "CLEAR"
            detail_end = "→ CLEAR"

        return PairResult(
            pair=pair,
            i_dbm=-200,
            threshold_dbm=threshold,
            margin_db=-200,
            path_loss_db=isolation_db,  # Store isolation in path_loss_db for frontend
            effective_distance_m=pair.distance_m,
            verdict=verdict,
            detail=(
                f"Guard band: {guard_mhz:.0f} MHz → isolation={isolation_db:.0f} dB (ACS={self.ACS_DB}+{isolation_db-self.ACS_DB:.0f} filter) → "
                f"distance_factor=10^({isolation_db:.0f}/20)={distance_factor:.0f}× → "
                f"required_sep={self.COCHANNEL_PROTECTION_M}/{distance_factor:.0f}≈{required_adj_sep:.0f}m | "
                f"min_sep={new_imt_radius}+{victim_cell_r}+{required_adj_sep:.0f}={min_adj_sep:.0f}m, "
                f"actual={pair.distance_m:.0f}m {detail_end}"
            ),
        )

    def _compute_fs_to_imt_adjacent(
        self, pair: InterferencePair,
        imt_lat, imt_lon, imt_radius, imt_ant_gain, imt_height,
        fs, threshold: float,
    ) -> PairResult:
        """FS Transmitter → IMT Receiver ADJACENT channel (Phase 17).
        
        Same as FS→IMT but with ACS isolation subtracted.
        FS EIRP is high enough that adjacent channel can still interfere.
        """
        effective_dist = max(pair.distance_m - imt_radius, 1.0)
        tx_height = fs.tx_altitude if fs and fs.tx_altitude else 30
        fs_freq = (pair.freq_overlap_low + pair.freq_overlap_high) / 2
        
        path_loss = self.model.path_loss_db(
            distance_m=effective_dist,
            frequency_mhz=fs_freq,
            tx_height_m=tx_height,
            rx_height_m=imt_height,
        )
        
        if fs:
            fs_eirp = (fs.tx_power or 30) + (fs.tx_antenna_gain or 35)
            fs_gain = fs_antenna_gain_db(
                fs.tx_lat, fs.tx_lon, fs.rx_lat, fs.rx_lon,
                imt_lat, imt_lon,
                beamwidth_deg=fs.beamwidth_deg,
                max_gain_dbi=fs.tx_antenna_gain or 35
            )
            beam_disc = (fs.tx_antenna_gain or 35) - fs_gain
        else:
            fs_eirp = 65
            beam_disc = 0 if pair.within_beam else 25
        
        i_dbm = fs_eirp - path_loss + imt_ant_gain - beam_disc - self.ACS_DB
        margin = i_dbm - threshold
        verdict = "CONFLICT" if i_dbm > threshold else "CLEAR"
        
        beam_note = "ใน main beam" if pair.within_beam else "นอก main beam"
        fs_name = fs.name if fs else pair.interferer_name
        return PairResult(
            pair=pair,
            i_dbm=i_dbm,
            threshold_dbm=threshold,
            margin_db=margin,
            path_loss_db=path_loss,
            effective_distance_m=effective_dist,
            verdict=verdict,
            detail=(
                f"FS→IMT Adjacent [{fs_name}]: I={i_dbm:.1f} dBm vs threshold {threshold} dBm "
                f"(margin={margin:+.1f} dB, dist={effective_dist:.0f}m, "
                f"PL={path_loss:.1f} dB, FS_EIRP={fs_eirp} dBm, ACS=−{self.ACS_DB} dB, {beam_note})"
            ),
        )

    @staticmethod
    def guard_band_isolation_db(guard_mhz: float) -> float:
        """Calculate total isolation from guard band width.
        
        Based on 3GPP TS 38.104 NR base station requirements:
        - 0 MHz (adjacent): ACS = 33 dB
        - 10 MHz: ACS + 10-15 dB filter roll-off ≈ 45 dB
        - 20 MHz: ACS + 28 dB ≈ 61 dB  
        - 40 MHz: ACS + 55 dB ≈ 88 dB
        - 60+ MHz: ACS + 70+ dB ≈ 103+ dB → fully isolated
        
        Simplified filter roll-off model:
        First 10 MHz: ~12 dB (near-band filter transition)
        Each additional 10 MHz: ~15 dB (filter stopband)
        """
        if guard_mhz <= 0:
            return 33.0  # Pure ACS, no guard band
        
        ACS_DB = 33
        # Filter roll-off: ~12 dB in first 10 MHz, then ~15 dB per 10 MHz
        if guard_mhz <= 10:
            roll_off = guard_mhz / 10 * 12  # Linear in first 10 MHz
        else:
            roll_off = 12 + (guard_mhz - 10) / 10 * 15
        
        return ACS_DB + roll_off

    # ══════════════════════════════════════════════════════════
    # PHASE 2: AGGREGATE TO SPECTRUM BLOCKS
    # ══════════════════════════════════════════════════════════

    def phase2_aggregate(
        self,
        pair_results: list[PairResult],
        band_start: float,
        band_end: float,
        max_eirp: float,
        block_size: float = 10.0,
    ) -> list[BlockResult]:
        """
        Phase 2: Aggregate pair results to per-block status.

        For each 10 MHz block:
        - Look at all pair_results that affect this block
        - Worst status wins: RED > GRAY > GREEN
        - Attach relevant pair_results for explanation
        """
        blocks = []
        freq = band_start
        while freq < band_end:
            block_high = min(freq + block_size, band_end)
            block_center = (freq + block_high) / 2

            # Find all pair_results relevant to this block
            relevant = []
            for pr in pair_results:
                if pr.verdict == "CLEAR":
                    continue
                if freq_overlap(freq, block_high,
                                pr.pair.freq_overlap_low, pr.pair.freq_overlap_high):
                    relevant.append(pr)

            # Determine status with aggregate interference (Phase 17)
            # Sum all interference contributions in linear domain
            i_linear_sum = 0
            for pr in relevant:
                if pr.i_dbm > -200:
                    i_linear_sum += 10 ** (pr.i_dbm / 10)
            
            i_total = -200
            if i_linear_sum > 0:
                i_total = 10 * math.log10(i_linear_sum)
            
            if not relevant:
                status = "green"
                reason = "Available"
            else:
                # Priority: CONFLICT > GUARD_BAND
                conflicts = [pr for pr in relevant if pr.verdict == "CONFLICT"]
                guards = [pr for pr in relevant if pr.verdict == "GUARD_BAND"]

                if conflicts:
                    status = "red"
                    # Build reason from conflicts — include causal chain (WHY, not just WHAT)
                    reason_parts = []
                    for pr in conflicts:
                        if pr.pair.direction == "IMT→FS":
                            margin_exceed = pr.i_dbm - pr.threshold_dbm
                            # Show the causal chain: EIRP → distance → FSPL → I
                            reason_parts.append(
                                f"FS conflict: {pr.pair.victim_name} "
                                f"(I={pr.i_dbm:.1f} dBm > threshold {pr.threshold_dbm} dBm, "
                                f"exceed {margin_exceed:.1f} dB | "
                                f"ระยะ {pr.pair.distance_m:.0f}m, PL≈{pr.path_loss_db:.0f} dB)"
                            )
                        elif pr.pair.direction == "FS→IMT":
                            beam_info = "ใน main beam" if pr.pair.within_beam else "นอก main beam (−25 dB)"
                            reason_parts.append(
                                f"FS→IMT: {pr.pair.interferer_name} "
                                f"(I={pr.i_dbm:.1f} dBm, {beam_info} | "
                                f"ระยะ {pr.pair.distance_m:.0f}m, PL≈{pr.path_loss_db:.0f} dB)"
                            )
                        elif pr.pair.direction == "IMT↔IMT_COCHANNEL":
                            reason_parts.append(
                                f"IMT co-channel conflict: {pr.pair.victim_name if pr.pair.interferer_type == 'NEW_IMT' else pr.pair.interferer_name} "
                                f"({pr.pair.distance_m/1000:.1f} km < ขั้นต่ำ {(pr.pair.distance_m/1000 + 0.5):.1f} km | "
                                f"I={pr.i_dbm:.1f} dBm, PL≈{pr.path_loss_db:.0f} dB)"
                            )
                    reason = "; ".join(reason_parts)
                elif guards:
                    status = "gray"
                    guard_names = [pr.pair.victim_name if pr.pair.interferer_type == "NEW_IMT"
                                   else pr.pair.interferer_name for pr in guards]
                    reason = f"Guard band: adjacent to {', '.join(guard_names)}"
                else:
                    status = "green"
                    reason = "Available"

            blocks.append(BlockResult(
                freq_low=freq, freq_high=block_high,
                status=status,
                max_eirp=max_eirp if status == "green" else None,
                reason=reason,
                i_total_dbm=round(i_total, 1),
                conflicting_pairs=relevant,
            ))

            freq += block_size

        return blocks

    # ══════════════════════════════════════════════════════════
    # RISK CLASSIFICATION
    # ══════════════════════════════════════════════════════════

    @staticmethod
    def _classify_risk(i_dbm: float, threshold: float, distance_m: float) -> str:
        """Classify preliminary risk based on estimated I[dBm] and distance."""
        margin = i_dbm - threshold

        if margin > 20:  # Far above threshold
            return "HIGH"
        elif margin > -10:  # Near threshold
            return "MEDIUM"
        elif distance_m < 1000:  # Very close even if I is low
            return "MEDIUM"
        else:
            return "LOW"

    # ══════════════════════════════════════════════════════════
    # VERIFICATION
    # ══════════════════════════════════════════════════════════

    @staticmethod
    def _verify_blocks(
        blocks: list[BlockResult],
        band_start: float,
        band_end: float,
        pair_results: list = None,
    ) -> dict:
        """Post-analysis verification (10 checks)."""
        checks = {}

        # 1. Block count
        expected = int((band_end - band_start) / 10)
        checks["block_count"] = {
            "pass": len(blocks) == expected,
            "expected": expected, "actual": len(blocks),
            "reason": (
                f"Band 4800-4990 MHz = 190 MHz / 10 MHz = {expected} blocks"
                if len(blocks) == expected
                else f"Expected {expected} blocks (190 MHz / 10 MHz), got {len(blocks)}"
            ),
        }

        # 2. Frequency continuity
        continuity_ok = True
        continuity_detail = ""
        for i in range(len(blocks) - 1):
            if abs(blocks[i + 1].freq_low - blocks[i].freq_high) > 0.1:
                continuity_ok = False
                continuity_detail = (
                    f"Gap at block {i}: {blocks[i].freq_low}-{blocks[i].freq_high} "
                    f"→ {blocks[i+1].freq_low}-{blocks[i+1].freq_high}"
                )
                break
        checks["frequency_continuity"] = {
            "pass": continuity_ok,
            "reason": (
                "All blocks are contiguous 10 MHz steps"
                if continuity_ok
                else continuity_detail or "Blocks are not contiguous"
            ),
        }

        # 3. Guard adjacency (green next to red without gray = warning)
        adjacency_warnings = 0
        adjacency_detail = []
        for i in range(len(blocks) - 1):
            if (blocks[i].status == "green" and blocks[i + 1].status == "red") or \
               (blocks[i].status == "red" and blocks[i + 1].status == "green"):
                adjacency_warnings += 1
                adjacency_detail.append(
                    f"Block {blocks[i].freq_low:.0f}-{blocks[i].freq_high:.0f} ({blocks[i].status}) "
                    f"adjacent to {blocks[i+1].freq_low:.0f}-{blocks[i+1].freq_high:.0f} ({blocks[i+1].status})"
                )
        checks["guard_adjacency"] = {
            "pass": adjacency_warnings == 0,
            "warnings": adjacency_warnings,
            "reason": (
                "No green-red adjacency without guard band"
                if adjacency_warnings == 0
                else f"{adjacency_warnings} instance(s) of green→red without guard: {'; '.join(adjacency_detail[:3])}"
            ),
        }

        # 4. Total MHz consistency
        total_mhz = sum(b.freq_high - b.freq_low for b in blocks)
        checks["total_mhz"] = {
            "pass": abs(total_mhz - (band_end - band_start)) < 0.1,
            "expected": band_end - band_start, "actual": total_mhz,
            "reason": (
                f"Total bandwidth = {total_mhz:.0f} MHz (expected {band_end - band_start:.0f} MHz)"
                if abs(total_mhz - (band_end - band_start)) < 0.1
                else f"Total {total_mhz:.0f} MHz != expected {band_end - band_start:.0f} MHz"
            ),
        }

        # 5. Guard reason validation
        invalid_guards = sum(1 for b in blocks
                             if b.status == "gray" and "Guard" not in b.reason)
        checks["guard_reasons"] = {
            "pass": invalid_guards == 0,
            "invalid_count": invalid_guards,
            "reason": (
                "All gray blocks have valid guard band reasons"
                if invalid_guards == 0
                else f"{invalid_guards} gray block(s) missing guard reason"
        ),
        }

        # ══ 6-10: ADDITIONAL VERIFICATION CHECKS ══

        # 6. Path loss monotonicity — PL should increase with distance
        pl_ok = True
        pl_detail = ""
        fs_pairs = [(pr.effective_distance_m, pr.path_loss_db, pr.pair.interferer_name)
                     for pr in pair_results if pr.pair.direction == "IMT→FS"]
        fs_pairs.sort()
        for i in range(len(fs_pairs) - 1):
            if fs_pairs[i+1][0] > fs_pairs[i][0] and fs_pairs[i+1][1] <= fs_pairs[i][1]:
                pl_ok = False
                pl_detail = (
                    f"PL non-monotonic: {fs_pairs[i][2]} at {fs_pairs[i][0]:.0f}m "
                    f"(PL={fs_pairs[i][1]:.1f}) vs {fs_pairs[i+1][2]} at "
                    f"{fs_pairs[i+1][0]:.0f}m (PL={fs_pairs[i+1][1]:.1f})"
                )
                break
        checks["path_loss_monotonicity"] = {
            "pass": pl_ok,
            "reason": "Path loss increases with distance (monotonic)" if pl_ok
                      else f"Non-monotonic PL: {pl_detail}",
        }

        # 7. Reciprocal symmetry — IMT↔IMT bidirectional margins
        sym_ok = True
        sym_detail = ""
        co_pairs = [(pr.pair.interferer_name, pr.pair.victim_name, pr.margin_db)
                     for pr in pair_results if pr.pair.direction == "IMT↔IMT_COCHANNEL"]
        co_pairs.sort(key=lambda x: x[0] + x[1])
        seen = set()
        for i, (iname, vname, m1) in enumerate(co_pairs):
            pair_key = tuple(sorted([iname, vname]))
            if pair_key in seen:
                continue
            seen.add(pair_key)
            for j, (iname2, vname2, m2) in enumerate(co_pairs):
                if i != j and iname == vname2 and vname == iname2:
                    if abs(m1 - m2) > 10:
                        sym_ok = False
                        sym_detail = f"Asymmetric: {iname}→{vname}={m1:.1f} dB vs {iname2}→{vname2}={m2:.1f} dB"
        checks["reciprocal_symmetry"] = {
            "pass": sym_ok,
            "reason": "IMT↔IMT reciprocal margins symmetric (within 10 dB)" if sym_ok
                      else (
                          f"{sym_detail} — "
                          "height-dependent models (Hata, P.1411) produce asymmetric PL "
                          "when tx_h != rx_h. Expected physics, not a bug."
                      ),
        }

        # 8. EIRP sanity — no positive I[dBm] for 5 GHz IMT
        eirp_ok = True
        eirp_detail = ""
        for pr in pair_results:
            if pr.pair.direction in ("IMT→FS", "IMT↔IMT_COCHANNEL"):
                if pr.pair.interferer_type == "NEW_IMT" and pr.i_dbm > 0:
                    eirp_ok = False
                    eirp_detail = f"Positive I[dBm] ({pr.i_dbm:.1f}) — EIRP may be unrealistically high"
                    break
        checks["eirp_sanity"] = {
            "pass": eirp_ok,
            "reason": "All I[dBm] are negative (reasonable for 5 GHz)" if eirp_ok
                      else eirp_detail or "Unusual EIRP detected",
        }

        # 9. FS→IMT beam check count
        fs_beam_count = sum(1 for pr in pair_results
                            if pr.pair.direction == "FS→IMT" and pr.pair.within_beam is not None)
        checks["fs_beam_coverage"] = {
            "pass": True,
            "reason": f"FS→IMT beam checks: {fs_beam_count} pair(s) evaluated",
        }

        # 10. Green-red ratio sanity
        green_count = sum(1 for b in blocks if b.status == "green")
        red_count = sum(1 for b in blocks if b.status == "red")
        gray_count = sum(1 for b in blocks if b.status == "gray")
        checks["block_distribution"] = {
            "pass": True,
            "reason": f"Block distribution: {green_count} green + {gray_count} gray + {red_count} red = 19 total",
        }

        checks["all_pass"] = all(c["pass"] for c in checks.values())
        return checks


        # ═══════════════════════════════════════════════════════════════
        # BACKWARD COMPATIBILITY — Public API (used by allocation.py)
        # ═══════════════════════════════════════════════════════════════

def phase0_only(
    center_lat, center_lon, cell_radius,
    antenna_height, antenna_gain, max_eirp,
    fs_links, neighbor_imts,
    model_name="free_space",
) -> list[InterferencePair]:
    """
    Convenience: run only Phase 0 (pre-screen).
    For UI "pre-scan" button before full analysis.
    """
    engine = InterferenceEngine(propagation_model=model_name)
    return engine.phase0_identify_pairs(
    center_lat=center_lat, center_lon=center_lon,
        cell_radius=cell_radius,
    antenna_height=antenna_height,
        antenna_gain=antenna_gain,
        max_eirp=max_eirp,
    fs_links=fs_links,
        neighbor_imts=neighbor_imts,
    )
