"""
Fixed Service Link Model — incumbent microwave links
"""
from sqlalchemy import Column, String, Float, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.db.database import Base


class FSLink(Base):
    __tablename__ = "fs_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, index=True)
    operator = Column(String(255), nullable=False)

    # Transmitter
    tx_lat = Column(Float, nullable=False)
    tx_lon = Column(Float, nullable=False)
    tx_altitude = Column(Float, nullable=True)  # m AGL

    # Receiver
    rx_lat = Column(Float, nullable=False)
    rx_lon = Column(Float, nullable=False)
    rx_altitude = Column(Float, nullable=True)  # m AGL

    # Frequency
    freq_low = Column(Float, nullable=False)   # MHz
    freq_high = Column(Float, nullable=False)  # MHz
    bandwidth = Column(Float, nullable=False)   # MHz

    # RF Parameters
    tx_power = Column(Float, nullable=False)       # dBm
    tx_antenna_gain = Column(Float, nullable=False)  # dBi
    rx_antenna_gain = Column(Float, nullable=True)   # dBi
    beamwidth_deg = Column(Float, nullable=True, default=3.0)  # deg — half-power beamwidth
    azimuth = Column(Float, nullable=True)          # deg from True North
    polarization = Column(String(10), nullable=True)  # H, V, or dual

    # Additional
    channel_plan = Column(String(50), nullable=True)
    modulation = Column(String(50), nullable=True)
    status = Column(String(20), default="active")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<FSLink {self.name} {self.freq_low}-{self.freq_high} MHz>"
