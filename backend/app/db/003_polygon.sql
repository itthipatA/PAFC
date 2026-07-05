-- Migration 003: Polygon/Shape mode support
-- Add polygon_geojson and tower_positions columns to imt_allocations

ALTER TABLE imt_allocations 
  ADD COLUMN IF NOT EXISTS polygon_geojson JSONB,
  ADD COLUMN IF NOT EXISTS tower_positions JSONB,
  ADD COLUMN IF NOT EXISTS network_total_eirp_dbm FLOAT;
