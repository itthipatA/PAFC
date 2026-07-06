# Impact Plan — 2026-07-06 12:36:34 ICT

## Change
- **What:** test change
- **Files changed:** backend/app/main.py, frontend/src/App.tsx

## Graph Analysis (Understand-Anything)
- Changed nodes: file:frontend/src/App.tsx, file:backend/app/main.py
- Consumer count: 17

### Consumers (from graph):
1. `file:frontend/src/components/MapView.tsx` (imports)
2. `file:frontend/src/components/LoginPage.tsx` (imports)
3. `file:frontend/src/components/FSLinkManager.tsx` (imports)
4. `file:frontend/src/components/IMTManager.tsx` (imports)
5. `file:frontend/src/components/IMTAddWorkspace.tsx` (imports)
6. `file:frontend/src/components/QueryPanel.tsx` (imports)
7. `file:frontend/src/contexts/AuthContext.tsx` (imports)
8. `file:backend/app/api/auth.py` (api_calls)
9. `config:backend/app/core/config.py` (imports)
10. `module:backend/app/api/__init__.py` (imports)
11. `file:backend/app/api/auth.py` (registers_router)
12. `file:backend/app/api/propagation.py` (registers_router)
13. `file:backend/app/api/coverage.py` (registers_router)
14. `service:backend/app/core/auth.py` (imports)
15. `file:backend/app/api/allocation.py` (registers_router)
16. `file:backend/app/api/fs_links.py` (registers_router)
17. `file:backend/app/api/imt.py` (registers_router)

## Verification Checklist
- [ ] All consumers from graph addressed?
- [ ] All regex matches checked?
- [ ] New consumers discovered during implementation?

## Post-Implementation
- Run `impact-verify.py` to audit