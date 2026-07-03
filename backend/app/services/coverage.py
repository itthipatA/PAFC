"""
Coverage Engine — Link Budget Calculator for PAFC

Calculates the required EIRP for a given cell radius,
or the achievable cell radius for a given EIRP.

Standards reference:
- 3GPP TS 38.104 (NR BS classes)
- ITU-R P.525 (Free Space Path Loss)
- ITU-R M.2101 (IMT coverage modeling)
"""
import math
from typing import Optional
from dataclasses import dataclass
from app.services.propagation import PropagationRegistry


# ═══════════════════════════════════════════════════════════════
# CONFIGURATION — 5G NR Private Network (n79 band, 4800-4990 MHz)
# ═══════════════════════════════════════════════════════════════

# Reference values based on 3GPP TS 38.104 and typical private network deployments
DEFAULT_CONFIG = {
    # Target RSS at cell edge (dBm)
    # -95 dBm: Conservative for indoor/outdoor private 5G (good throughput)
    # -105 dBm: Edge of coverage (basic connectivity)
    # -85 dBm: Premium coverage (high throughput everywhere)
    "target_rss_dbm": -95,
    
    # Shadow fade margin (dB)
    # 6 dB: Suburban/light urban (low building density)
    # 8 dB: Urban (moderate building density)  <- default
    # 10 dB: Dense urban (high-rise, heavy clutter)
    "shadow_margin_db": 8,
    
    # Building penetration loss (dB) — for indoor coverage
    # 0 dB: Outdoor-only coverage  <- default
    # 10 dB: Light indoor (wood/glass)
    # 20 dB: Deep indoor (concrete)
    "building_loss_db": 0,
    
    # UE (User Equipment) antenna gain (dBi)
    # 0 dBi: Typical mobile terminal  <- default
    # 2 dBi: External CPE antenna
    "ue_antenna_gain_dbi": 0,
    
    # Body loss (dB)
    # 3 dB: Handheld device near body
    # 0 dB: Fixed CPE or free-space
    "body_loss_db": 0,
    
    # Center frequency for the band (MHz)
    "center_freq_mhz": 4900,
}


# ═══════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════

@dataclass
class LinkBudgetResult:
    """Complete link budget calculation."""
    
    # Inputs
    cell_radius_m: float
    bs_antenna_height_m: float
    bs_antenna_gain_dbi: float
    propagation_model: str
    
    # Configuration
    target_rss_dbm: float
    shadow_margin_db: float
    building_loss_db: float
    ue_antenna_gain_dbi: float
    body_loss_db: float
    center_freq_mhz: float
    
    # Calculated
    max_path_loss_db: float           # Maximum allowed path loss
    actual_path_loss_db: float        # Path loss at cell edge
    required_eirp_dbm: float          # EIRP needed to achieve target RSS
    cell_edge_rss_dbm: float          # RSS at cell edge with this EIRP
    link_margin_db: float             # How much margin above/below requirement
    coverage_classification: str      # "INDOOR" | "OUTDOOR_GOOD" | "OUTDOOR_BASIC" | "MARGINAL"
    
    # Reverse: given EIRP, what radius?
    achievable_radius_m: Optional[float] = None


@dataclass
class CoverageTradeOff:
    """Result of iteratively reducing EIRP to avoid interference."""
    
    original_radius_m: float
    original_eirp_dbm: float
    suggested_radius_m: float
    suggested_eirp_dbm: float
    radius_reduction_pct: float
    conflicting_systems: list[str]
    reason: str


# ═══════════════════════════════════════════════════════════════
# COVERAGE ENGINE
# ═══════════════════════════════════════════════════════════════

class CoverageEngine:
    """
    Link budget calculator for PAFC private network coverage.
    
    Usage:
        engine = CoverageEngine(propagation_model="free_space")
        
        # Forward: cell_radius → required EIRP
        result = engine.calculate_required_eirp(cell_radius_m=500)
        
        # Reverse: EIRP → achievable cell_radius
        radius = engine.calculate_achievable_radius(eirp_dbm=20)
        
        # Trade-off analysis
        tradeoff = engine.find_tradeoff(
            desired_radius=500,
            conflicting_systems=["BKK-01-Link"],
            max_allowed_eirp=10,
        )
    """
    
    def __init__(self, propagation_model: str = "free_space"):
        self.model_name = propagation_model
        self.model = PropagationRegistry.get(propagation_model)
    
    # ── Public API ────────────────────────────────────────────
    
    def calculate_required_eirp(
        self,
        cell_radius_m: float,
        bs_antenna_height_m: float = 15,
        bs_antenna_gain_dbi: float = 12,
        target_rss_dbm: Optional[float] = None,
        shadow_margin_db: Optional[float] = None,
        building_loss_db: Optional[float] = None,
        ue_antenna_gain_dbi: Optional[float] = None,
        body_loss_db: Optional[float] = None,
        center_freq_mhz: Optional[float] = None,
    ) -> LinkBudgetResult:
        """
        Calculate the EIRP required to achieve target RSS at cell edge.
        
        Formula:
            Max Path Loss = EIRP + G_UE − RSS_target − Margin − BuildingLoss − BodyLoss
            Required EIRP = RSS_target + PathLoss(d_max) − G_BS − G_UE + Margin + BuildingLoss + BodyLoss
        """
        cfg = self._resolve_config(
            target_rss_dbm, shadow_margin_db, building_loss_db,
            ue_antenna_gain_dbi, body_loss_db, center_freq_mhz
        )
        
        # Maximum allowed path loss (from link budget)
        # MAPL = EIRP + G_BS + G_UE − RSS_target − Margin − Building − Body
        # But we're solving for EIRP, so compute actual path loss first
        
        actual_path_loss = self.model.path_loss_db(
            distance_m=cell_radius_m,
            frequency_mhz=cfg["center_freq_mhz"],
            tx_height_m=bs_antenna_height_m,
            rx_height_m=1.5,  # UE height
        )
        
        # Total system losses (signal degradations not from path)
        total_losses = (
            cfg["shadow_margin_db"]
            + cfg["building_loss_db"]
            + cfg["body_loss_db"]
        )
        
        # UE antenna gain only (BS gain already included in EIRP definition)
        ue_gain = cfg["ue_antenna_gain_dbi"]
        
        # Required EIRP (already includes BS antenna gain)
        # EIRP_req = RSS_target + PathLoss − G_UE + Σlosses
        required_eirp = (
            cfg["target_rss_dbm"]
            + actual_path_loss
            - ue_gain
            + total_losses
        )
        
        # Cell edge RSS with this EIRP
        cell_edge_rss = required_eirp + ue_gain - actual_path_loss - total_losses
        
        # Link margin: how much above the minimum threshold
        link_margin = cell_edge_rss - cfg["target_rss_dbm"]
        
        # Coverage classification
        coverage_class = self._classify_coverage(cell_edge_rss, cfg["target_rss_dbm"])
        
        # Achievable radius (should equal input since we solved for it)
        achievable = cell_radius_m
        
        # Maximum allowed path loss
        max_path_loss = actual_path_loss
        
        return LinkBudgetResult(
            cell_radius_m=cell_radius_m,
            bs_antenna_height_m=bs_antenna_height_m,
            bs_antenna_gain_dbi=bs_antenna_gain_dbi,
            propagation_model=self.model_name,
            target_rss_dbm=cfg["target_rss_dbm"],
            shadow_margin_db=cfg["shadow_margin_db"],
            building_loss_db=cfg["building_loss_db"],
            ue_antenna_gain_dbi=cfg["ue_antenna_gain_dbi"],
            body_loss_db=cfg["body_loss_db"],
            center_freq_mhz=cfg["center_freq_mhz"],
            max_path_loss_db=max_path_loss,
            actual_path_loss_db=actual_path_loss,
            required_eirp_dbm=required_eirp,
            cell_edge_rss_dbm=cell_edge_rss,
            link_margin_db=link_margin,
            coverage_classification=coverage_class,
            achievable_radius_m=achievable,
        )
    
    def calculate_achievable_radius(
        self,
        eirp_dbm: float,
        bs_antenna_height_m: float = 15,
        bs_antenna_gain_dbi: float = 12,
        target_rss_dbm: Optional[float] = None,
        shadow_margin_db: Optional[float] = None,
        building_loss_db: Optional[float] = None,
        ue_antenna_gain_dbi: Optional[float] = None,
        body_loss_db: Optional[float] = None,
        center_freq_mhz: Optional[float] = None,
    ) -> float:
        """
        Reverse calculation: given EIRP, what cell radius is achievable?
        
        Returns radius in meters.
        
        Solves: PathLoss(d) = EIRP + G_BS + G_UE − RSS_target − Σlosses
        For Free Space: d_km = 10^((PathLoss − 32.4 − 20·log10(f)) / 20)
        """
        cfg = self._resolve_config(
            target_rss_dbm, shadow_margin_db, building_loss_db,
            ue_antenna_gain_dbi, body_loss_db, center_freq_mhz
        )
        
        # UE antenna gain only (BS gain already in EIRP)
        ue_gain = cfg["ue_antenna_gain_dbi"]
        total_losses = (
            cfg["shadow_margin_db"]
            + cfg["building_loss_db"]
            + cfg["body_loss_db"]
        )
        
        # Maximum allowable path loss for this EIRP
        max_pl = eirp_dbm + ue_gain - cfg["target_rss_dbm"] - total_losses
        
        # Solve for distance
        # For Free Space: PL = 32.4 + 20·log10(d_km) + 20·log10(f_MHz)
        # → d_km = 10^((PL − 32.4 − 20·log10(f)) / 20)
        if self.model_name == "free_space":
            f_mhz = cfg["center_freq_mhz"]
            d_km = 10 ** ((max_pl - 32.4 - 20 * math.log10(f_mhz)) / 20)
            radius_m = max(d_km * 1000, 10)  # Minimum 10m
        else:
            # For other models: binary search
            radius_m = self._binary_search_radius(
                max_pl, bs_antenna_height_m, cfg["center_freq_mhz"]
            )
        
        return radius_m
    
    def find_tradeoff(
        self,
        desired_radius_m: float,
        conflicting_systems: list[str],
        max_allowed_eirp_dbm: float,
        bs_antenna_height_m: float = 15,
        bs_antenna_gain_dbi: float = 12,
        target_rss_dbm: Optional[float] = None,
        shadow_margin_db: Optional[float] = None,
        building_loss_db: Optional[float] = None,
        ue_antenna_gain_dbi: Optional[float] = None,
        body_loss_db: Optional[float] = None,
        center_freq_mhz: Optional[float] = None,
    ) -> CoverageTradeOff:
        """
        When interference forces EIRP reduction, find achievable radius.
        
        Returns a trade-off showing the radius that can be achieved
        with the reduced EIRP, and how much was lost.
        """
        cfg = self._resolve_config(
            target_rss_dbm, shadow_margin_db, building_loss_db,
            ue_antenna_gain_dbi, body_loss_db, center_freq_mhz
        )
        
        # Original link budget at desired radius
        original = self.calculate_required_eirp(
            cell_radius_m=desired_radius_m,
            bs_antenna_height_m=bs_antenna_height_m,
            bs_antenna_gain_dbi=bs_antenna_gain_dbi,
            **{k: cfg[k] for k in [
                "target_rss_dbm", "shadow_margin_db", "building_loss_db",
                "ue_antenna_gain_dbi", "body_loss_db", "center_freq_mhz"
            ]}
        )
        
        # Achievable radius with reduced EIRP
        achievable = self.calculate_achievable_radius(
            eirp_dbm=max_allowed_eirp_dbm,
            bs_antenna_height_m=bs_antenna_height_m,
            bs_antenna_gain_dbi=bs_antenna_gain_dbi,
            **{k: cfg[k] for k in [
                "target_rss_dbm", "shadow_margin_db", "building_loss_db",
                "ue_antenna_gain_dbi", "body_loss_db", "center_freq_mhz"
            ]}
        )
        
        reduction_pct = ((desired_radius_m - achievable) / desired_radius_m) * 100
        
        if reduction_pct < 1:
            reason = (
                f"EIRP reduction to {max_allowed_eirp_dbm:.1f} dBm does not "
                f"significantly affect coverage (radius: {desired_radius_m:.0f}m → "
                f"{achievable:.0f}m, −{reduction_pct:.1f}%)"
            )
        elif reduction_pct < 30:
            reason = (
                f"ต้องลดกำลังส่งเหลือ {max_allowed_eirp_dbm:.1f} dBm "
                f"เนื่องจากรบกวน {', '.join(conflicting_systems)} "
                f"→ รัศมีครอบคลุมลดจาก {desired_radius_m:.0f}m เหลือ {achievable:.0f}m "
                f"(ลดลง {reduction_pct:.0f}%)"
            )
        else:
            reason = (
                f"⚠️ ต้องลดกำลังส่งอย่างมากเหลือ {max_allowed_eirp_dbm:.1f} dBm "
                f"→ รัศมีครอบคลุมเหลือเพียง {achievable:.0f}m จากที่ต้องการ {desired_radius_m:.0f}m "
                f"(ลดลง {reduction_pct:.0f}%) — อาจต้องพิจารณาย้ายตำแหน่ง"
            )
        
        return CoverageTradeOff(
            original_radius_m=desired_radius_m,
            original_eirp_dbm=original.required_eirp_dbm,
            suggested_radius_m=achievable,
            suggested_eirp_dbm=max_allowed_eirp_dbm,
            radius_reduction_pct=reduction_pct,
            conflicting_systems=conflicting_systems,
            reason=reason,
        )
    
    # ── Internal ──────────────────────────────────────────────
    
    def _resolve_config(self, target_rss, shadow_margin, building_loss,
                         ue_gain, body_loss, freq) -> dict:
        """Merge defaults with overrides."""
        return {
            "target_rss_dbm": target_rss if target_rss is not None else DEFAULT_CONFIG["target_rss_dbm"],
            "shadow_margin_db": shadow_margin if shadow_margin is not None else DEFAULT_CONFIG["shadow_margin_db"],
            "building_loss_db": building_loss if building_loss is not None else DEFAULT_CONFIG["building_loss_db"],
            "ue_antenna_gain_dbi": ue_gain if ue_gain is not None else DEFAULT_CONFIG["ue_antenna_gain_dbi"],
            "body_loss_db": body_loss if body_loss is not None else DEFAULT_CONFIG["body_loss_db"],
            "center_freq_mhz": freq if freq is not None else DEFAULT_CONFIG["center_freq_mhz"],
        }
    
    @staticmethod
    def _classify_coverage(cell_edge_rss: float, target_rss: float) -> str:
        """Classify coverage quality based on cell-edge RSS."""
        margin = cell_edge_rss - target_rss
        if margin > 10:
            return "OUTDOOR_GOOD"       # Excellent outdoor, some indoor
        elif margin > 0:
            return "OUTDOOR_BASIC"      # Good outdoor coverage
        elif margin > -6:
            return "MARGINAL"           # Marginal — may have dead spots
        else:
            return "INADEQUATE"         # Below minimum
    
    def _binary_search_radius(
        self, max_pl_db: float, bs_height_m: float, freq_mhz: float,
        min_m: float = 10, max_m: float = 100_000,
    ) -> float:
        """Binary search for distance given max allowable path loss."""
        for _ in range(40):
            mid = (min_m + max_m) / 2
            pl = self.model.path_loss_db(
                distance_m=mid,
                frequency_mhz=freq_mhz,
                tx_height_m=bs_height_m,
                rx_height_m=1.5,
            )
            if pl < max_pl_db:
                min_m = mid
            else:
                max_m = mid
        
        return (min_m + max_m) / 2


# ═══════════════════════════════════════════════════════════════
# CONVENIENCE FUNCTIONS
# ═══════════════════════════════════════════════════════════════

def quick_radius(eirp_dbm: float, target_rss: float = -95, freq_mhz: float = 4900) -> float:
    """
    Quick Free Space: radius in meters from EIRP and target RSS.
    Assumes 0 dBi UE gain, 8 dB shadow margin, 0 building loss.
    """
    total_losses = 8  # shadow margin
    max_pl = eirp_dbm - target_rss - total_losses
    d_km = 10 ** ((max_pl - 32.4 - 20 * math.log10(freq_mhz)) / 20)
    return max(d_km * 1000, 10)


def quick_eirp(radius_m: float, target_rss: float = -95, freq_mhz: float = 4900) -> float:
    """
    Quick Free Space: required EIRP in dBm for given radius.
    """
    d_km = radius_m / 1000
    fspl = 32.4 + 20 * math.log10(max(d_km, 0.001)) + 20 * math.log10(freq_mhz)
    total_losses = 8  # shadow margin
    return target_rss + fspl + total_losses
