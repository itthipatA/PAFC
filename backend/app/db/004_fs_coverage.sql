-- Migration 004: Phase 37 — FS Coverage + Frame Structure + Cleanup

-- FS Link: add antenna pattern for directional calculation
ALTER TABLE fs_links 
  ADD COLUMN IF NOT EXISTS antenna_pattern JSONB;

-- FS Link: add computed link corridor polygon (GeoJSON)
ALTER TABLE fs_links 
  ADD COLUMN IF NOT EXISTS link_polygon JSONB;

-- IMT: add frame structure (TDD configuration)
ALTER TABLE imt_allocations 
  ADD COLUMN IF NOT EXISTS frame_structure VARCHAR(20);

-- IMT: drop unused columns from Phase 35-36 (circle packing, coverage, sector)
ALTER TABLE imt_allocations
  DROP COLUMN IF EXISTS cell_radius,
  DROP COLUMN IF EXISTS tower_positions,
  DROP COLUMN IF EXISTS network_total_eirp_dbm,
  DROP COLUMN IF EXISTS antenna_gain,
  DROP COLUMN IF EXISTS antenna_type,
  DROP COLUMN IF EXISTS sector_beamwidth_deg,
  DROP COLUMN IF EXISTS sector_azimuth_deg,
  DROP COLUMN IF EXISTS target_rss,
  DROP COLUMN IF EXISTS shadow_margin,
  DROP COLUMN IF EXISTS building_loss,
  DROP COLUMN IF EXISTS propagation_model,
  DROP COLUMN IF EXISTS coverage_classification,
  DROP COLUMN IF EXISTS indoor_pct;
