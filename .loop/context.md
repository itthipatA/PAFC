# PAFC Project Context — Single Source of Truth

> Auto-injected into subagent context. Updated after every milestone.

## Project

- **Name:** PAFC (Private Automated Frequency Coordinator)
- **Purpose:** Spectrum coordination for IMT Private Network (4800-4990 MHz, n79 band)
- **User:** NBTC / Spectrum regulator
- **Repo:** https://github.com/itthipatA/PAFC (branch: `main`)

## Structure

```
/Volumes/New Volume/coding/PAFC/
├── backend/                    # FastAPI + SQLAlchemy + PostgreSQL/PostGIS
│   ├── app/
│   │   ├── api/               # Routes: auth, fs_links, imt, allocation, coverage, polygon
│   │   ├── models/            # SQLAlchemy: FSLink, IMTAllocation, SpectrumBlock
│   │   ├── services/          # Interference engine + coverage + circle packing + propagation
│   │   └── db/                # Migrations (001_init, 002_indoor, 003_polygon)
│   └── .venv/                 # Python venv
├── frontend/                   # React 18 + TypeScript + Vite 6 + MapLibre GL 4
│   └── src/
│       ├── components/        # MapView, IMTAddWorkspace, PolygonCreator, BlockPanel, etc.
│       ├── contexts/          # AuthContext (JWT)
│       └── types.ts
└── docker-compose.yml         # PostgreSQL 16 + PostGIS
```

## Services

| Service | Port | Command |
|---------|------|---------|
| PostgreSQL | 5432 | `docker compose up -d` (OrbStack) |
| FastAPI | 8001 | `.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8001` |
| React | 5173 | `npm run dev -- --host 0.0.0.0` |

## Stack Versions

- Python: 3.11+
- FastAPI: latest
- React: 18
- TypeScript: 5.x
- Vite: 6
- MapLibre GL: 4
- Tailwind CSS: 3.x
- PostgreSQL: 16 + PostGIS

## Key Files

- Interference Engine: `backend/app/services/interference.py` (2325 lines)
- Coverage Engine: `backend/app/services/coverage.py` (424 lines)
- Circle Packing: `backend/app/services/circle_packing.py` (812 lines)
- MapView: `frontend/src/components/MapView.tsx` (1639 lines)
- IMTAddWorkspace: `frontend/src/components/IMTAddWorkspace.tsx`
- Types: `frontend/src/types.ts`
