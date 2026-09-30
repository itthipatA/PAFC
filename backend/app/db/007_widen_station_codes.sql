-- Migration 007: Widen station code columns for Thai full names (2026-09-30)
-- RTAF formal filing uses full station names (e.g. สถทค.เขาสลัดได) exceeding VARCHAR(20)
-- Idempotent: re-runnable
BEGIN;

ALTER TABLE fs_links ALTER COLUMN tx_code TYPE VARCHAR(255);
ALTER TABLE fs_links ALTER COLUMN rx_code TYPE VARCHAR(255);

COMMIT;
