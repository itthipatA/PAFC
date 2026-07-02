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
    max_eirp = Column(Float, nullable=False)           # dBm
    antenna_gain = Column(Float, nullable=True)        # dBi

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
