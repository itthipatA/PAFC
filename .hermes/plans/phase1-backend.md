# PAFC — Phase 1 Implementation Plan

## Project
Private Automated Frequency Coordinator — 4800-4990 MHz IMT Private Network
Repo: https://github.com/itthipatA/PAFC

## Context
- ITU-R Footnote 5.441B (Thailand identified for IMT in 4800-4990)
- Architecture: 6 modules (see SAM-Spectrum-Allocation-Manager.md)
- Tech Stack: Python FastAPI + React + PostgreSQL + MapLibre GL JS + OpenMapTiles
- Deployment: Local dev → EC2 later

## What's Already Done (Architecture)
- [x] Project scaffold + GitHub repo
- [x] Database schema (001_init.sql — 4 tables: fs_links, imt_allocations, spectrum_blocks, audit_log)
- [x] Core config (settings.py — band params, propagation models)
- [x] Database connection (async SQLAlchemy + PostGIS-ready)
- [x] Models: FSLink, IMTAllocation, SpectrumBlock
- [x] Propagation Registry (Free Space, P.452 placeholder, Hata)
- [x] Interference Engine (core logic: per-block FS/IMT/guard analysis)
- [x] FS Links CRUD API (FastAPI router)
- [x] FS Mockup CSV (10 sample links across Thailand)
- [x] FastAPI main app skeleton

## Remaining for Phase 1

### Task 1: Complete Backend API Routes
- [ ] IMT Allocation CRUD (`app/api/imt.py`)
- [ ] Allocation Engine endpoint (`app/api/allocation.py`) — POST /analyze
- [ ] Propagation model list endpoint (`app/api/propagation.py`)

### Task 2: Seed Database + Verify
- [ ] Docker Compose for PostgreSQL
- [ ] Import fs_links mockup CSV
- [ ] Verify CRUD works

### Task 3: Interference Engine Test
- [ ] Unit test: FS link blocking
- [ ] Unit test: IMT neighbor collision
- [ ] Unit test: Guard band logic
- [ ] Integration test: full 19-block analysis

### Task 4: Frontend Setup
- [ ] React + TypeScript + Vite scaffold
- [ ] MapLibre GL JS + OpenMapTiles basemap
- [ ] FS links display layer
- [ ] Basic spectrum block heatmap overlay

### Task 5: Admin Panel MVP
- [ ] Login (JWT)
- [ ] FS Link table view + CRUD
- [ ] Map click → "analyze this location" button
- [ ] Results display (🟢⚪🔴 grid)

## Delegation Strategy
- Tasks 1-2: Claude Code (CRUD + Docker — mechanical)
- Task 3: Hermes (core logic verification — reasoning-heavy)
- Task 4-5: Claude Code (frontend scaffold — boilerplate)
