"""
IMT Private Network Allocation Model
"""
from sqlalchemy import Column, String, Float, DateTime, Date, func
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.db.database import Base


class IMTAllocation(Base):
    __tablename__ = "imt_allocations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, index=True)
    operator = Column(String(255), nullable=False)

    # Area — stored as GeoJSON WKT in text (PostGIS geometry optional)
    area_wkt = Column(String, nullable=False)  # "POLYGON((...))"
    cell_radius = Column(Float, nullable=False)  # meters

    # RF Parameters
    antenna_height = Column(Float, nullable=False)   # m AGL
    max_eirp = Column(Float, nullable=False)           # dBm (already includes antenna gain)
    antenna_gain = Column(Float, nullable=True)        # dBi

    # Antenna Pattern (Phase 17)
    antenna_type = Column(String(20), nullable=True, default="omni")  # omni | sector | shape
    sector_beamwidth_deg = Column(Float, nullable=True, default=120)  # deg — only for sector
    sector_azimuth_deg = Column(Float, nullable=True, default=0)      # deg from True North

    # Coverage / Link Budget Parameters (Phase 15)
    target_rss = Column(Float, nullable=True)          # dBm — target RSS at cell edge
    shadow_margin = Column(Float, nullable=True)       # dB — shadow fade margin
    building_loss = Column(Float, nullable=True, default=0)  # dB — building penetration
    propagation_model = Column(String(50), nullable=True)    # which model was used
    coverage_classification = Column(String(30), nullable=True)  # OUTDOOR_GOOD etc.

    # Deployment type (Phase 29)
    indoor_pct = Column(Float, nullable=True, default=0)  # 0-100, % of indoor deployment

    # Polygon/Shape mode (Phase 35)
    polygon_geojson = Column(String, nullable=True)  # GeoJSON polygon geometry
    tower_positions = Column(String, nullable=True)  # JSON array of {lat, lon, eirp}
    network_total_eirp_dbm = Column(Float, nullable=True)

    # Status
    status = Column(String(20), default="pending")  # pending/active/rejected/expired
    approved_by = Column(String(255), nullable=True)

    # Validity
    valid_from = Column(Date, nullable=True)
    valid_until = Column(Date, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<IMTAllocation {self.name} [{self.status}]>"


class SpectrumBlock(Base):
    __tablename__ = "spectrum_blocks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    allocation_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    freq_low = Column(Float, nullable=False)   # MHz — must be multiple of 10
    freq_high = Column(Float, nullable=False)  # freq_low + 10
    status = Column(String(10), default="allocated")  # allocated/guard/unavailable
    max_eirp = Column(Float, nullable=True)  # dBm — limited per block if needed

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f"<SpectrumBlock {self.freq_low}-{self.freq_high} [{self.status}]>"
