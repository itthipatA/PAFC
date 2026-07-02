# PAFC Phase 4 Plan — Auth + Public Dashboard + FS CRUD

## Scope
- Backend: update auth credentials (admin/admin123)
- Frontend: JWT auth flow (login, token storage, protected routes)
- Frontend: Public dashboard (read-only, no login)
- Frontend: FS Links CRUD admin panel

## Tasks

### Task 1: Backend Auth Update
- File: `backend/app/core/auth.py`
- Change: admin password → "admin123", remove officer user

### Task 2: Frontend Auth Infrastructure
- Create: `frontend/src/contexts/AuthContext.tsx` — token state, login/logout, user info
- Create: `frontend/src/components/LoginPage.tsx` — login form
- Modify: `frontend/src/main.tsx` — wrap with AuthProvider
- Modify: `frontend/src/App.tsx` — route: login vs main app
- Auth flow: login → get token → store in state → attach to API calls

### Task 3: Public Dashboard
- Create: `frontend/src/components/PublicDashboard.tsx` — read-only map + block view
- No auth required
- Shows existing allocations, can't modify

### Task 4: FS Links CRUD Admin
- Create: `frontend/src/components/FSLinkManager.tsx` — table + add/edit/delete
- Admin-only (requires JWT)
- CRUD against /api/fs-links/

### Task 5: Verify + Deploy
- Start PostgreSQL + FastAPI + Vite
- Test login flow → protected API → analyze
- Test public dashboard
- Commit + push
