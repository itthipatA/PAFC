-- Phase 29: Indoor % deployment
-- Add indoor_pct column for proportional indoor/outdoor deployment classification
ALTER TABLE imt_allocations ADD COLUMN IF NOT EXISTS indoor_pct FLOAT DEFAULT 0;
COMMENT ON COLUMN imt_allocations.indoor_pct IS 'สัดส่วน Indoor (%) — 0=outdoor ทั้งหมด, 100=indoor ทั้งหมด';
