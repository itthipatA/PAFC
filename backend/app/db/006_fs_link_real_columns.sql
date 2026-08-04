-- Migration 006: Real AWN FS link columns (2026-08-04)
-- Adds license-detail columns from the AWN fixed-link inventory (60 links, 4800-4990 MHz)
-- Idempotent: re-runnable with IF NOT EXISTS
BEGIN;

ALTER TABLE fs_links
  ADD COLUMN IF NOT EXISTS class_of_emission VARCHAR(20),
  ADD COLUMN IF NOT EXISTS antenna_diameter DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS eirp DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tx_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS rx_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS distance_km DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS tx_address TEXT,
  ADD COLUMN IF NOT EXISTS rx_address TEXT;

COMMIT;
