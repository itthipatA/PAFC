# PAFC Project State

> Updated after every milestone. Read by session-startup.

## Current

- **Phase:** 38.3 (Real AWN FS Link Data — 2026-08-04)
- **Git commit:** (after 7fe254e) — "feat: ingest 60 real AWN FS links + ITU-R F.699-9 antenna patterns"
- **Services (restored 2026-09-16 ~11:05 ICT):** backend=8001 (running, pid 75458), frontend=5173 (running, pid 75498), db=5432 pafc-db-1 (healthy), ngrok → lilith-whalelike-lisa.ngrok-free.dev (SAME URL, --url flag, verified public 200 + login 200)
- **Note:** state below (Phase 38.3, 2026-08-04) is stale — newer commits exist (9685d71 CARTO→OpenFreeMap, 6f19a23 TUC offshore links). Next session: rewrite Current section.
- **2026-09-24 Google Maps PREP (Phase A):** `@vis.gl/react-google-maps@^1.10.1` installed + NEW `frontend/src/lib/googleMaps.ts` (loader cached-promise th/TH, provider flag) + `frontend/.env.example`. MapLibre stays default. `.env.local` added to .gitignore. Phase B (port MapView layers) waits for user's API key. Service restarted same day: BE 8001 + FE 5173 + ngrok lisa-whale, all 200.
- **DB:** fs_links = 60 REAL AWN links (mock 11 rows cleared). Migration 006 added: class_of_emission, antenna_diameter, eirp, quantity, tx_code, rx_code, distance_km, tx_address, rx_address. antenna_pattern/link_polygon model = JSONB (match schema).
- **Data source:** Google Sheet 19L21No7tBfcX7QrqezM-gAa-3CfGwbzzbBgI6eTdOUU tabs FS_Links_Geocoded / FS_Stations_Geocoded (60 links, operator AWN, 4800-4990 MHz, 28M0D7W). Pailin 7 GHz link excluded per user.
- **Tools:** backend/app/services/antenna_pattern.py (ITU-R F.699-9, section 2.2.1, 0.1° = 3601 pts) + backend/scripts/ingest_fs_links.py (CSV → TRUNCATE → insert). Re-ingest: export FS_Stations_Geocoded → CSV → run ingest with --clear.
- **Phase 38.4 (same day):** fs_coverage.py consumes per-link `antenna_pattern` JSONB (pattern_discrimination_from_doc) instead of the simplified hardcoded model — dogbone/corridor now use real F.699-9 patterns. FSLinkManager table shows license fields (Class of Emission, เสา ม.). Commits b2ec156, a7f6638 pushed to phase36-simplify.
- **Phase 38.5 (same day):** Coverage visual fix — API /coverage uses victim_rx_gain_dbi=0.0 (omni) + RX_THRESHOLD_DBM_VIS=-85 → directional beam visible (was circle due to far-dish 29.2 dBi applied as victim gain + -120 dBm saturation). Allocation engine unchanged (-120, own params). Commit a2b93e6.
- **Phase 38.6 (same day):** FSLinkManager pair-grouped view (แนวทาง B ที่ user เลือกจาก sketch) — group header (TX⇄RX + freq/BW/COE/ระยะ/EIRP + edit/delete) + 2 station rows (ที่ตั้ง/พิกัด/azimuth/ความสูง + hub tag). Fixed font TH_Sarabun_New→Sarabun. Commit 6fc1491.

## Engineering Status

- **Phase 37 Engine:** ✅ Complete — 3 rules (FS -120dBm, IMT 100m buffer, Frame Structure)
- **Phase 37 Backend:** ✅ Complete — 4 new services + updated API
- **Phase 37 DB:** ✅ Complete — Migration 004 applied
- **Phase 38 Frontend:** ✅ Complete — Gridgeist Constitution v1.0
- **Phase 38.1 IMT Registration:** ✅ Complete — 3 fields (name, site_owner, station_type MNO/PNO/Enterprise)

## Phase 38 — Gridgeist UI Redesign (2026-07-19)

### DESIGN.md — Gridgeist Constitution

**Thesis:** "An operational workspace for Thai spectrum regulators built on aligned data tracks, compressed hierarchy, and real frequency allocation states."

### Grid System
```
┌────┬──────────────────────────────┬──────────┐
│  S │                              │   Panel  │
│  I │         MAP AREA             │  (400px) │
│  D │      (flex-1, hero)          │  slide   │
│  E │                              │  drawer  │
│  B │                              │          │
│  A │                              │          │
│  R │                              │          │
│ 56 │                              │          │
│ px │                              │          │
└────┴──────────────────────────────┴──────────┘
```

### Files Changed
- `DESIGN.md` — Gridgeist Constitution added
- `src/index.css` — Grid system rewrite (339 lines)
- `src/App.tsx` — 3-track sidebar layout (370 lines)
- `src/components/LoginPage.tsx` — 2-column Gridgeist grid

### Architecture (Phase 38)
```
Frontend:
  App.tsx
    ├── Sidebar (56px, #1A1A2E)
    │   ├── Shield logo
    │   ├── NAV_ITEMS (icons only, tooltips)
    │   │   ├── Layout → Dashboard
    │   │   ├── Map → FS Links
    │   │   ├── Radio → IMT
    │   │   ├── Octagon → Polygon
    │   │   └── Search → Query
    │   ├── Map style selector (Globe icon + dropdown)
    │   ├── User avatar (first letter, red circle)
    │   └── Logout
    ├── Main Content (flex-1)
    │   ├── Dashboard: Map + floating "เพิ่ม IMT" + panel slide
    │   ├── FS Links: FSLinkManager
    │   ├── IMT: IMTManager
    │   ├── Polygon: Map + PolygonCreator panel
    │   └── Search: QueryPanel
    └── Panel (400px slide from right)
        ├── IMTAddWorkspace
        └── PolygonCreator
```

## Known Issues
- FS test data has inflated EIRP → max distances too large (cosmetic)
- Test files missing @testing-library/react deps (pre-existing)
- Map style dropdown buttons visible in sidebar snapshot (visual only, functional)

## Last Session
- **Date:** 2026-07-19
- **Tasks:** Phase 38 IMT Block Selection UX + Marker Popup Spectrum Bar
- **Key Changes:**
  - Available blocks: gray→green (#2E7D32) + Check icon on selection
  - Guard blocks: orange (#E65100) + Shield icon, guard suggestion light orange (#FFE0B2)
  - IMT marker: new 3-tower SVG icon (44×52px)
  - Popup: full 4800-4990 MHz proportional spectrum bar with block divisions + allocation text
  - MultiPolygon GeoJSON support added
  - No auto-select blocks — user must pick every block
