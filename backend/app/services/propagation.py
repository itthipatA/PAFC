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
    """ITU-R P.452 — Placeholder for long-term interference prediction"""
    name = "p452"
    description = "ITU-R P.452 — Long-term interference prediction (placeholder)"

    def path_loss_db(self, distance_m: float, frequency_mhz: float,
                     tx_height_m: float = 30, rx_height_m: float = 30,
                     **kwargs) -> float:
        """
        Placeholder — falls back to Free Space.
        To implement fully: integrate ITU-R pyprop or similar library.
        """
        # Fallback with 10 dB extra margin for real-world losses
        fs = FreeSpaceModel()
        return fs.path_loss_db(distance_m, frequency_mhz, tx_height_m, rx_height_m) + 10.0


class HataModel(PropagationModel):
    """Hata Model for Urban/Suburban Mobile"""
    name = "hata"
    description = "Hata Model (urban/suburban) — IMT to IMT"

    def path_loss_db(self, distance_m: float, frequency_mhz: float,
                     tx_height_m: float = 30, rx_height_m: float = 1.5,
                     environment: str = "urban", **kwargs) -> float:
        """
        Hata model for 150-1500 MHz frequencies.
        For 4800-4990 MHz, uses COST-231 extension.
        """
        d_km = max(distance_m / 1000.0, 0.1)

        if environment == "urban":
            a_hr = (1.1 * math.log10(frequency_mhz) - 0.7) * rx_height_m - \
                   (1.56 * math.log10(frequency_mhz) - 0.8)
        else:
            a_hr = (1.1 * math.log10(frequency_mhz) - 0.7) * rx_height_m - \
                   (1.56 * math.log10(frequency_mhz) - 0.8)

        # COST-231 Hata (extended to 2 GHz, approximately to 5 GHz)
        loss = 46.3 + 33.9 * math.log10(frequency_mhz) - 13.82 * math.log10(tx_height_m) \
               - a_hr + (44.9 - 6.55 * math.log10(tx_height_m)) * math.log10(d_km) + 3
        return loss


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
