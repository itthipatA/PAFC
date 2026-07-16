# PAFC Project State

> Updated after every milestone. Read by session-startup.

## Current

- **Phase:** 37 (FS Coverage + Frame Structure + Simplified Allocation)
- **Git commit:** pending
- **Services:** backend=8001 (running), frontend=5173 (pending restart), db=5432 (running)

## Engineering Status

- **Phase 37 Engine:** ✅ Complete — 3 rules (FS -120dBm, IMT 100m buffer, Frame Structure)
- **Phase 37 Backend:** ✅ Complete — 4 new services + updated API
- **Phase 37 DB:** ✅ Complete — Migration 004 applied
- **Phase 37 Frontend:** 🔄 In progress — IMTAddWorkspace rewrite

## Architecture (Phase 37)

```
Backend:
  services/
    fs_coverage.py        — ITU-R F.699 + FSPL, -120dBm coverage polygons
    imt_buffer.py          — Polygon buffer +100m, intersection checks
    frame_structure.py     — TDD comparison, guard band determination
    allocation_engine.py   — 3-rule allocation engine + narrative log

API:
  POST /api/allocate/analyze     — Full analysis (replaces check-availability)
  POST /api/allocate/save        — Save with block status (allocated/guard)
  GET  /api/allocate/frame-options — TDD pattern list
  
DB:
  migration 004: antenna_pattern, link_polygon (FSLink), frame_structure (IMT)
  Dropped 13 unused columns (circle packing, coverage, sector, indoor)
```

## Removed Features (Phase 37)
- Circle packing / tower count / SA optimization
- Single-cell / Omni / Sector modes
- Coverage engine
- Indoor % deployment
- Phase 0-3 interference pipeline (archived)
- PN buffer (replaced by IMT 100m buffer)
- Fresnel zone LoS check (replaced by FS -120dBm radius)

## Known Issues
- FS test data has inflated EIRP → max distances too large (cosmetic, detection still works)
- Frontend IMTAddWorkspace pending rewrite
- Frontend types.ts may need test dependency fixes

## Last Session
- **Date:** 2026-07-16
- **Tasks:** Phase 37 full redesign — new engine, simplified UI, DB cleanup
