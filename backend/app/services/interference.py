"""
Interference Engine — Core computation for block availability

Determines which 10 MHz blocks are available (🟢), need guard (⚪),
or are unavailable (🔴) for a given location and parameters.
"""
import math
from typing import Optional
from dataclasses import dataclass, field
from app.core.config import get_settings
from app.services.propagation import PropagationRegistry


settings = get_settings()


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
    tx_power: float       # dBm
    tx_antenna_gain: float  # dBi
    rx_antenna_gain: float  # dBi


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


@dataclass
class BlockResult:
    """Result for a single 10 MHz block."""
    freq_low: float
    freq_high: float
    status: str  # "green", "gray", "red"
    max_eirp: Optional[float] = None
    reason: str = ""


@dataclass
class InterferenceResult:
    """Full interference analysis result for a request."""
    request_id: str
    center_lat: float
    center_lon: float
    cell_radius: float
    blocks: list[BlockResult] = field(default_factory=list)
    summary: dict = field(default_factory=dict)


class InterferenceEngine:
    """
    Core Interference Engine for PAFC.

    Usage:
        engine = InterferenceEngine(propagation_model="free_space")
        result = engine.analyze(
            center_lat=13.75, center_lon=100.5, cell_radius=500,
            antenna_height=15, antenna_gain=12, max_eirp=23,
            fs_links=[...], neighbor_imts=[...]
        )
    """

    def __init__(self, propagation_model: str = "free_space"):
        self.model_name = propagation_model
        self.model = PropagationRegistry.get(propagation_model)

    # ---- Public API ----

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
        Analyze all 10 MHz blocks in the band (or requested range).

        Returns per-block status: green / gray / red.
        """
        band_start = requested_band_start or settings.band_start_mhz
        band_end = requested_band_end or settings.band_end_mhz
        block_size = settings.block_size_mhz

        blocks = []
        freq = band_start
        while freq < band_end:
            block_high = min(freq + block_size, band_end)
            result = self._analyze_block(
                freq_low=freq,
                freq_high=block_high,
                center_lat=center_lat,
                center_lon=center_lon,
                cell_radius=cell_radius,
                antenna_height=antenna_height,
                antenna_gain=antenna_gain,
                max_eirp=max_eirp,
                fs_links=fs_links,
                neighbor_imts=neighbor_imts,
            )
            blocks.append(result)
            freq += block_size

        summary = {
            "total_blocks": len(blocks),
            "green": sum(1 for b in blocks if b.status == "green"),
            "gray": sum(1 for b in blocks if b.status == "gray"),
            "red": sum(1 for b in blocks if b.status == "red"),
            "green_mhz": sum(b.freq_high - b.freq_low for b in blocks if b.status == "green"),
            "model": self.model_name,
        }

        return InterferenceResult(
            request_id="",
            center_lat=center_lat,
            center_lon=center_lon,
            cell_radius=cell_radius,
            blocks=blocks,
            summary=summary,
        )

    def set_model(self, model_name: str):
        """Switch propagation model at runtime."""
        self.model_name = model_name
        self.model = PropagationRegistry.get(model_name)

    # ---- Internal ----

    def _analyze_block(
        self,
        freq_low: float,
        freq_high: float,
        center_lat: float,
        center_lon: float,
        cell_radius: float,
        antenna_height: float,
        antenna_gain: float,
        max_eirp: float,
        fs_links: list[FSLinkData],
        neighbor_imts: list[IMTNeighborData],
    ) -> BlockResult:
        """
        Analyze a single 10 MHz block against all FS links and neighbor IMTs.
        """

        # Step 1: Check FS links that overlap with this block
        for fs in fs_links:
            if not self._freq_overlap(freq_low, freq_high, fs.freq_low, fs.freq_high):
                continue

            # Distance from IMT center to closest point on FS path
            dist_to_path = self._dist_to_path(center_lat, center_lon,
                                              fs.tx_lat, fs.tx_lon,
                                              fs.rx_lat, fs.rx_lon)
            # Total interference radius = cell_radius + FS path buffer
            interference_radius = cell_radius + self._fs_interference_radius(fs)

            if dist_to_path < interference_radius:
                # Compute interference at FS receiver
                i_fs = self._compute_fs_interference(
                    imt_lat=center_lat, imt_lon=center_lon,
                    imt_radius=cell_radius,
                    imt_eirp=max_eirp + antenna_gain,
                    fs_rx_lat=fs.rx_lat, fs_rx_lon=fs.rx_lon,
                    fs_rx_alt=fs.rx_altitude or 0,
                    fs_rx_gain=fs.rx_antenna_gain,
                    freq_mhz=(freq_low + freq_high) / 2,
                    imt_height=antenna_height,
                )

                if i_fs > settings.interference_threshold_dbm:
                    return BlockResult(
                        freq_low=freq_low, freq_high=freq_high,
                        status="red",
                        reason=f"FS conflict: {fs.name} (I={i_fs:.1f} dBm > threshold {settings.interference_threshold_dbm} dBm)"
                    )

        # Step 2: Check neighbor IMTs using this block (co-channel)
        for imt in neighbor_imts:
            if not self._freq_overlap(freq_low, freq_high, imt.freq_low, imt.freq_high):
                continue

            dist = self._haversine(center_lat, center_lon, imt.center_lat, imt.center_lon)
            min_separation = cell_radius + imt.cell_radius + self._cochannel_protection_ratio()

            if dist < min_separation:
                return BlockResult(
                    freq_low=freq_low, freq_high=freq_high,
                    status="red",
                    reason=f"IMT co-channel conflict: {imt.name} ({dist/1000:.1f} km < {min_separation/1000:.1f} km)"
                )

        # Step 3: Check guard band requirement (adjacent channel)
        for imt in neighbor_imts:
            # Check if neighbor uses adjacent blocks (±10 MHz)
            if abs(freq_low - imt.freq_low) <= settings.default_guard_band_mhz and \
               abs(freq_low - imt.freq_low) > 0:
                dist = self._haversine(center_lat, center_lon, imt.center_lat, imt.center_lon)
                adj_separation = cell_radius + imt.cell_radius + self._adjacent_protection_ratio()

                if dist < adj_separation:
                    return BlockResult(
                        freq_low=freq_low, freq_high=freq_high,
                        status="gray",
                        reason=f"Guard band: adjacent to {imt.name} ({dist/1000:.1f} km < {adj_separation/1000:.1f} km)"
                    )

        # Step 4: All checks passed
        return BlockResult(
            freq_low=freq_low, freq_high=freq_high,
            status="green",
            max_eirp=max_eirp,
            reason="Available"
        )

    # ---- Geometry Helpers ----

    @staticmethod
    def _haversine(lat1, lon1, lat2, lon2) -> float:
        """Haversine distance in meters."""
        R = 6371000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlam = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    @staticmethod
    def _dist_to_path(px, py, ax, ay, bx, by) -> float:
        """Minimum distance from point P to line segment AB (Haversine approximation)."""
        # Simplified: use midpoint approximation for far distances
        # For production, use geodesic projection
        d_pa = InterferenceEngine._haversine(px, py, ax, ay)
        d_pb = InterferenceEngine._haversine(px, py, bx, by)
        d_ab = InterferenceEngine._haversine(ax, ay, bx, by)

        if d_ab < 1:
            return d_pa

        # Perpendicular distance using approximate planar geometry
        s = (d_pa + d_pb + d_ab) / 2
        area = math.sqrt(max(s * (s - d_pa) * (s - d_pb) * (s - d_ab), 0))
        perp_dist = 2 * area / d_ab

        # Check if projection falls on segment
        proj = (d_pa**2 - d_pb**2 + d_ab**2) / (2 * d_ab)
        if 0 <= proj <= d_ab:
            return perp_dist
        return min(d_pa, d_pb)

    @staticmethod
    def _freq_overlap(f1_low, f1_high, f2_low, f2_high) -> bool:
        """Check if two frequency ranges overlap."""
        return f1_low < f2_high and f2_low < f1_high

    # ---- Protection Criteria ----

    @staticmethod
    def _cochannel_protection_ratio() -> float:
        """Minimum separation for co-channel IMT (meters). Rough estimate."""
        return 2000  # 2 km minimum for same block

    @staticmethod
    def _adjacent_protection_ratio() -> float:
        """Additional separation for adjacent channel IMT (meters)."""
        return 500  # 500m if separated by 10 MHz guard

    @staticmethod
    def _fs_interference_radius(fs: FSLinkData) -> float:
        """Additional protection radius around FS receiver (meters)."""
        # Rough: 2 km protection zone around FS Rx
        return max(2000, fs.bandwidth * 50)  # wider bandwidth = bigger zone

    def _compute_fs_interference(
        self,
        imt_lat, imt_lon, imt_radius,
        imt_eirp,
        fs_rx_lat, fs_rx_lon, fs_rx_alt,
        fs_rx_gain,
        freq_mhz,
        imt_height,
    ) -> float:
        """
        Compute interference power at FS receiver from IMT.

        I = EIRP - L_path + G_rx

        Returns:
            Interference power in dBm at FS receiver
        """
        # Distance from IMT center to FS receiver
        dist = self._haversine(imt_lat, imt_lon, fs_rx_lat, fs_rx_lon)
        # Subtract cell radius (worst case: IMT user at cell edge toward FS Rx)
        effective_dist = max(dist - imt_radius, 1)

        # Path loss
        l_path = self.model.path_loss_db(
            distance_m=effective_dist,
            frequency_mhz=freq_mhz,
            tx_height_m=imt_height,
            rx_height_m=fs_rx_alt,
        )

        # Interference at FS Rx
        i_dbm = imt_eirp - l_path + (fs_rx_gain or 0)
        return i_dbm
