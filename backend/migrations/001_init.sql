-- PAFC Initial Migration
-- Run: psql -U pafc -d pafc -f 001_init.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Fixed Service Links (incumbent microwave links)
CREATE TABLE IF NOT EXISTS fs_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    operator VARCHAR(255) NOT NULL,

    -- Transmitter
    tx_lat DOUBLE PRECISION NOT NULL,
    tx_lon DOUBLE PRECISION NOT NULL,
    tx_altitude DOUBLE PRECISION,  -- m AGL

    -- Receiver
    rx_lat DOUBLE PRECISION NOT NULL,
    rx_lon DOUBLE PRECISION NOT NULL,
    rx_altitude DOUBLE PRECISION,  -- m AGL

    -- Frequency
    freq_low DOUBLE PRECISION NOT NULL,
    freq_high DOUBLE PRECISION NOT NULL,
    bandwidth DOUBLE PRECISION NOT NULL,

    -- RF Parameters
    tx_power DOUBLE PRECISION NOT NULL,           -- dBm
    tx_antenna_gain DOUBLE PRECISION NOT NULL,    -- dBi
    rx_antenna_gain DOUBLE PRECISION,             -- dBi
    azimuth DOUBLE PRECISION,                     -- deg from True North
    polarization VARCHAR(10),                     -- H, V, dual

    -- Additional
    channel_plan VARCHAR(50),
    modulation VARCHAR(50),
    status VARCHAR(20) DEFAULT 'active',

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_fs_links_freq ON fs_links (freq_low, freq_high);
CREATE INDEX idx_fs_links_status ON fs_links (status);

-- IMT Private Network Allocations
CREATE TABLE IF NOT EXISTS imt_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    operator VARCHAR(255) NOT NULL,

    -- Area (WKT polygon)
    area_wkt TEXT NOT NULL,
    cell_radius DOUBLE PRECISION NOT NULL,  -- m

    -- RF Parameters
    antenna_height DOUBLE PRECISION NOT NULL,  -- m AGL
    max_eirp DOUBLE PRECISION NOT NULL,        -- dBm
    antenna_gain DOUBLE PRECISION,             -- dBi

    -- Status
    status VARCHAR(20) DEFAULT 'pending',  -- pending/active/rejected/expired
    approved_by VARCHAR(255),

    -- Validity
    valid_from DATE,
    valid_until DATE,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_imt_status ON imt_allocations (status);
CREATE INDEX idx_imt_validity ON imt_allocations (valid_until) WHERE status = 'active';

-- Spectrum Block Allocations (per-IMT, per-10MHz block)
CREATE TABLE IF NOT EXISTS spectrum_blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    allocation_id UUID NOT NULL REFERENCES imt_allocations(id) ON DELETE CASCADE,
    freq_low DOUBLE PRECISION NOT NULL,   -- must be multiple of 10
    freq_high DOUBLE PRECISION NOT NULL,  -- freq_low + 10
    status VARCHAR(10) DEFAULT 'allocated',  -- allocated/guard/unavailable
    max_eirp DOUBLE PRECISION,            -- dBm, per-block limit

    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_blocks_freq ON spectrum_blocks (freq_low, freq_high);
CREATE INDEX idx_blocks_allocation ON spectrum_blocks (allocation_id);
CREATE INDEX idx_blocks_status ON spectrum_blocks (status);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    user_name VARCHAR(255),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log (created_at DESC);
