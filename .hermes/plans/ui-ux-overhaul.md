# PAFC UI/UX Overhaul Plan
Date: 2026-07-02

## User Requirements
1. Topbar: move map style selector to nav bar, remove propagation model from Header
2. Propagation model: move into AllocationForm
3. Map click: shouldn't auto-open form — need explicit "Add" step
4. Fix analyze button (currently not calculating — 401 auth issue)
5. Calculation feedback: loading animation + step-by-step log
6. Results: clickable blocks with detail, show calculation derivation, spectrum block visualization
7. Login page: rename to "Private Network Automatic Frequency Coordination" / "ระบบ PAFC"
8. Login persistence: survive refresh

## Root Cause Analysis
- Analyze endpoint returns 401 because App.tsx uses `fetch()` without JWT
- AuthContext has no localStorage persistence
- Map click immediately shows AllocationForm — confusing UX

## Tasks

### Task 1: Topbar Redesign
- Move map style selector into main nav bar (between tabs and user info)
- Remove Header.tsx (no longer needed)
- Remove Header import in App.tsx
- Files: App.tsx, delete Header.tsx

### Task 2: AllocationForm Overhaul
- Add propagation model selector
- Add calculation log section with auto-scroll
- Add step animation during loading
- Files: AllocationForm.tsx

### Task 3: Map Click Flow
- Click map → place red pin + small floating "เพิ่มจุด IMT" button
- Click button → open AllocationForm
- Files: MapView.tsx, App.tsx

### Task 4: Fix Analyze Button
- Change `fetch()` to `fetchWithAuth()` in handleAnalyze
- Files: App.tsx

### Task 5: BlockPanel Enhancement
- Clickable blocks → expand detail panel
- Show per-block calculation details
- Better spectrum visualization
- Files: BlockPanel.tsx

### Task 6: Login Page Rename
- Title: "Private Network Automatic Frequency Coordination"
- Subtitle: "ระบบ PAFC"
- Button: "Login" / "เข้าสู่ระบบ"
- Files: LoginPage.tsx

### Task 7: Login Persistence
- Save token + user to localStorage on login
- Restore on AuthProvider mount
- Handle expired token (clear and redirect to login)
- Files: AuthContext.tsx

### Task 8: Verify
- npx tsc --noEmit
- npm run dev
- Test: login → refresh → still logged in
- Test: click map → pin appears → "เพิ่มจุด IMT" → form → analyze → results
