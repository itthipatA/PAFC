# PAFC Project State

> Updated after every milestone. Read by session-startup.

## Current

- **Phase:** 38 (Gridgeist UI Redesign)
- **Git commit:** pending
- **Services:** backend=8001 (running), frontend=5173 (running), db=5432 (running)

## Engineering Status

- **Phase 37 Engine:** ✅ Complete — 3 rules (FS -120dBm, IMT 100m buffer, Frame Structure)
- **Phase 37 Backend:** ✅ Complete — 4 new services + updated API
- **Phase 37 DB:** ✅ Complete — Migration 004 applied
- **Phase 38 Frontend:** ✅ Complete — Gridgeist Constitution v1.0

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
- **Tasks:** Phase 38 Gridgeist UI Redesign — fixed PAFC accessibility, full Gridgeist grid redesign
