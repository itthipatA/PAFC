"""
Propagation Model Registry — pluggable design
Add new models by registering them here.
"""
from abc import ABC, abstractmethod
import math


class PropagationModel(ABC):
    """Base class for all propagation models."""

    name: str = "base"
    description: str = ""

    @abstractmethod
    def path_loss_db(self, distance_m: float, frequency_mhz: float,
                     tx_height_m: float = 30, rx_height_m: float = 30,
                     **kwargs) -> float:
        """
        Compute path loss in dB.

        Args:
            distance_m: Distance between Tx and Rx in meters
            frequency_mhz: Center frequency in MHz
            tx_height_m: Transmitter height AGL in meters
            rx_height_m: Receiver height AGL in meters
            **kwargs: Model-specific parameters

        Returns:
            Path loss in dB
        """
        ...


class FreeSpaceModel(PropagationModel):
    """Free Space Path Loss — ITU-R P.525"""
    name = "free_space"
    description = "Free Space Path Loss (ITU-R P.525) — upper bound estimate"

    def path_loss_db(self, distance_m: float, frequency_mhz: float,
                     tx_height_m: float = 30, rx_height_m: float = 30,
                     **kwargs) -> float:
        """
        L_fs = 32.4 + 20*log10(d_km) + 20*log10(f_MHz)
        """
        d_km = distance_m / 1000.0
        loss = 32.4 + 20 * math.log10(max(d_km, 0.001)) + 20 * math.log10(frequency_mhz)
        return loss


class ITURP452Model(PropagationModel):
    """ITU-R P.452 — Clear-air basic transmission loss (Section 4)
    
    Simplified from full terrain-dependent model. Provides basic transmission loss
    for interference prediction at 0.1-50 GHz.
    
    Formula (ITU-R P.452-17, §4):
      L_basic = 92.5 + 20·log10(f_GHz) + 20·log10(d_km) + A_h
      where A_h = additional loss from clutter/diffraction (simplified)
    
    Parameters:
      time_pct: % of time (1, 10, 50) — lower = rarer propagation = higher loss
      clutter_class: None/urban/suburban/rural/water
    """
    name = "p452"
    description = "ITU-R P.452 — Clear-air basic transmission loss (simplified)"

    def path_loss_db(self, distance_m: float, frequency_mhz: float,
                     tx_height_m: float = 30, rx_height_m: float = 30,
                     time_pct: float = 50, clutter_class: str = None,
                     **kwargs) -> float:
        d_km = max(distance_m / 1000.0, 0.001)
        f_ghz = frequency_mhz / 1000.0

        # Basic transmission loss (free-space equivalent)
        L_basic = 92.5 + 20 * math.log10(f_ghz) + 20 * math.log10(d_km)

        # Additional losses (simplified from ITU-R P.452 Annex 1)
        # Time percentage: rare events have HIGHER basic loss
        if time_pct <= 1:
            L_time = 15  # ~15 dB extra for 1% time
        elif time_pct <= 10:
            L_time = 8   # ~8 dB for 10% time
        else:
            L_time = 0   # 50% time = median = no extra

        # Clutter/terrain penalty (simplified)
        clutter_penalty = {
            'urban': 20,
            'suburban': 12,
            'rural': 6,
            'water': 0,
        }
        L_clutter = clutter_penalty.get(clutter_class, 0) if clutter_class else 0

        return L_basic + L_time + L_clutter


class ITURP2108Model(PropagationModel):
    """ITU-R P.2108 — Clutter Loss Model
    
    Predicts additional loss due to buildings and vegetation around terminals.
    Critical for distinguishing between FS (rooftop) and IMT (street-level).
    
    Formula (ITU-R P.2108-1, §3):
      L_clutter = max(0, -5·log10(1 - p) - 6.5·log10(1 - p)·log10(f_GHz))
      where p = percentage of locations, then scale by height factor
    
    Parameters:
      clutter_type: urban/suburban/rural/water
      percentage_locations: 1-99% (default 50% = median)
      terminal_height_m: height of the terminal above ground
      clutter_height_m: representative clutter height (default from type)
    """
    name = "p2108"
    description = "ITU-R P.2108 — Clutter loss (adds to FSPL)"

    # Default clutter heights per ITU-R P.2108 Table 1
    DEFAULT_CLUTTER_HEIGHTS = {
        'urban': 20,
        'suburban': 10,
        'rural': 5,
        'water': 0,
    }

    def path_loss_db(self, distance_m: float, frequency_mhz: float,
                     tx_height_m: float = 30, rx_height_m: float = 30,
                     clutter_type: str = 'urban', percentage_locations: float = 50,
                     clutter_height_m: float = None,
                     **kwargs) -> float:
        d_km = distance_m / 1000.0
        f_ghz = frequency_mhz / 1000.0

        # Base FSPL
        fs = FreeSpaceModel()
        L_fs = fs.path_loss_db(distance_m, frequency_mhz, tx_height_m, rx_height_m)

        # Clutter height
        if clutter_height_m is None:
            clutter_height_m = self.DEFAULT_CLUTTER_HEIGHTS.get(clutter_type, 10)

        # P.2108 clutter loss — terminal below clutter height gets full loss
        # terminals above clutter get reduced loss (linear interpolation)
        height_factor = max(0, 1 - min(tx_height_m, rx_height_m) / max(clutter_height_m, 1))
        
        if height_factor <= 0:
            return L_fs  # Terminal above clutter — no extra loss

        # Nominal clutter loss at distance/percentage
        p = max(min(percentage_locations, 99), 1) / 100.0
        if p >= 0.999:
            return L_fs
            
        try:
            L_nom = max(0, -5 * math.log10(1 - p) - 6.5 * math.log10(1 - p) * math.log10(f_ghz))
        except (ValueError, OverflowError):
            L_nom = 20  # Fallback for p → 1.0

        L_clutter = L_nom * height_factor
        return L_fs + L_clutter


class ITURP1411Model(PropagationModel):
    """ITU-R P.1411 — Short-Range Outdoor Propagation (300 MHz - 100 GHz)
    
    Designed for systems below rooftop level: IMT small cells, WiFi, etc.
    Best model for IMT-to-IMT interference at street level.
    
    Two sub-models based on distance:
    - Below rooftop (d < breakpoint): street canyon propagation
    - Above rooftop (d > breakpoint): over-rooftop diffraction
    
    Formula (ITU-R P.1411-12, §4.1.1):
      L = L_bp + 10·n1·log10(d / R_bp) when d ≤ R_bp
      L = L_bp + 10·n2·log10(d / R_bp) when d > R_bp
      where R_bp = breakpoint distance, n1/n2 = distance exponents
    
    Parameters:
      environment: urban/suburban/rural
      street_width_m: width of street (default 20m for urban)
      building_height_m: average building height (default 15m for urban)
    """
    name = "p1411"
    description = "ITU-R P.1411 — Short-range outdoor (IMT-to-IMT street level)"

    # Environment defaults
    ENV_PARAMS = {
        'urban':    {'n1': 2.0, 'n2': 4.0, 'street_w': 20, 'bldg_h': 15, 'L0': 81.2},
        'suburban': {'n1': 2.0, 'n2': 3.5, 'street_w': 30, 'bldg_h': 10, 'L0': 76.2},
        'rural':    {'n1': 2.0, 'n2': 3.0, 'street_w': 50, 'bldg_h': 5,  'L0': 71.2},
    }

    def path_loss_db(self, distance_m: float, frequency_mhz: float,
                     tx_height_m: float = 15, rx_height_m: float = 1.5,
                     environment: str = 'urban', street_width_m: float = None,
                     building_height_m: float = None,
                     **kwargs) -> float:
        d_km = max(distance_m / 1000.0, 0.01)
        f_mhz = frequency_mhz
        env = self.ENV_PARAMS.get(environment, self.ENV_PARAMS['urban'])

        sw = street_width_m or env['street_w']
        bh = building_height_m or env['bldg_h']

        # Breakpoint distance (R_bp) — where first Fresnel zone clears rooftops
        # R_bp ≈ 4·h_tx·h_rx / λ (simplified for small cells)
        wavelength_m = 300 / f_mhz
        h_rx_eff = max(rx_height_m, 1.0)
        R_bp_km = 4 * tx_height_m * h_rx_eff / (wavelength_m * 1000)
        R_bp_km = max(R_bp_km, 0.02)  # Minimum 20m breakpoint

        # Reference loss at breakpoint
        L_bp = abs(20 * math.log10(wavelength_m * wavelength_m / (8 * math.pi * tx_height_m * h_rx_eff)))

        if d_km <= R_bp_km:
            # Street canyon — slower decay
            if d_km <= 0.001:
                d_km = 0.001
            L = L_bp + 10 * env['n1'] * math.log10(d_km / R_bp_km)
        else:
            # Over-rooftop — faster decay
            L = L_bp + 10 * env['n2'] * math.log10(d_km / R_bp_km)

        return L


class HataModel(PropagationModel):
    """Hata Model for Urban/Suburban Mobile
    
    Valid range: 150-1500 MHz (COST-231 extended to ~2 GHz). 
    At 5 GHz: applies with frequency correction factor.
    rx_height_m capped at 10m (model designed for mobile, not rooftop).
    """
    name = "hata"
    description = "Hata Model (urban/suburban) — IMT to IMT"

    def path_loss_db(self, distance_m: float, frequency_mhz: float,
                     tx_height_m: float = 30, rx_height_m: float = 1.5,
                     environment: str = "urban", **kwargs) -> float:
        d_km = max(distance_m / 1000.0, 0.1)
        
        # Cap rx height — Hata designed for mobile receivers (1-10m)
        rx_h = min(max(rx_height_m, 1.0), 10.0)
        
        # Frequency correction for >2 GHz (beyond COST-231 range)
        f_mhz = min(frequency_mhz, 2000)  # Clamp to COST-231 max
        f_correction = max(0, 20 * math.log10(frequency_mhz / 2000)) if frequency_mhz > 2000 else 0

        if environment == "urban":
            a_hr = (1.1 * math.log10(f_mhz) - 0.7) * rx_h - \
                   (1.56 * math.log10(f_mhz) - 0.8)
        else:
            a_hr = (1.1 * math.log10(f_mhz) - 0.7) * rx_h - \
                   (1.56 * math.log10(f_mhz) - 0.8)

        # COST-231 Hata (extended to 2 GHz)
        loss = 46.3 + 33.9 * math.log10(f_mhz) - 13.82 * math.log10(tx_height_m) \
               - a_hr + (44.9 - 6.55 * math.log10(tx_height_m)) * math.log10(d_km) + 3
        
        return loss + f_correction


# Model Registry
class PropagationRegistry:
    """Pluggable propagation model registry."""

    _models: dict = {}

    @classmethod
    def register(cls, model: PropagationModel):
        cls._models[model.name] = model

    @classmethod
    def get(cls, name: str) -> PropagationModel:
        if name not in cls._models:
            raise ValueError(f"Unknown propagation model: {name}. Available: {list(cls._models.keys())}")
        return cls._models[name]

    @classmethod
    def list_models(cls) -> dict:
        return {name: {"name": m.name, "description": m.description}
                for name, m in cls._models.items()}


# Register default models
PropagationRegistry.register(FreeSpaceModel())
PropagationRegistry.register(ITURP452Model())
PropagationRegistry.register(HataModel())
PropagationRegistry.register(ITURP2108Model())
PropagationRegistry.register(ITURP1411Model())
