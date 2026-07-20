-- Migration 005: Rename IMT operator → site_owner, add station_type
-- PAFC Phase 38 — IMT Owner/Type fields

BEGIN;

-- Step 1: Rename operator column to site_owner
ALTER TABLE imt_allocations RENAME COLUMN operator TO site_owner;

-- Step 2: Add station_type column with CHECK constraint
ALTER TABLE imt_allocations ADD COLUMN station_type VARCHAR(20);
ALTER TABLE imt_allocations ADD CONSTRAINT chk_imt_station_type
    CHECK (station_type IN ('MNO', 'PNO', 'Enterprise'));

COMMIT;
