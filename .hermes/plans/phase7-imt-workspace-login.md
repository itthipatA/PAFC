# PAFC Phase 7 — IMT Workspace + Login Redesign
Date: 2026-07-02

## User Requirements
1. ระบบเพิ่ม IMT ใหม่: ปุ่ม "เพิ่ม IMT" ใน tab IMT → เปิด workspace
2. Workspace แบ่ง: ซ้าย 20% mini map, ขวา 80% workspace
3. Workspace section: inputs → คำนวณ → log (scroll) → spectrum bar
4. Spectrum bar: แต่ละ block มี border สีดำ
5. Login page: diagonal split — ซ้ายรูป, ขวา form
6. รัศมี coverage: แสดงบน mini map

## Tasks

### Task 1: Login Page — Diagonal Split Redesign
- Layout: diagonal divider (SVG clip-path หรือ CSS transform)
- Left side: dark navy (#1A1A2E) with image placeholder (user will provide image later)
- Right side: white/light bg with login form centered
- Keep existing auth logic, just redesign visual
- Files: LoginPage.tsx

### Task 2: IMTAddWorkspace Component (NEW)
- 80%/20% split layout
- Left 20%: mini MapView component showing:
  - Center at entered lat/lon
  - Coverage circle (cell_radius) from @turf/turf
  - Nearby IMT markers
- Right 80%: vertical sections
  - Section 1: Input form (lat, lon, cell_radius, antenna_height, antenna_gain, max_eirp, propagation model, name, operator)
  - Section 2: "คำนวณ" button
  - Section 3: Calculation log (scrollable, auto-scroll, 4-step animation)
  - Section 4: Spectrum bar results (black borders on blocks)
  - Section 5: "บันทึก" button (save IMT allocation)
- Files: NEW src/components/IMTAddWorkspace.tsx

### Task 3: Spectrum Bar — Black Borders
- Add border: 1px solid #000 to each block in BlockPanel
- Also apply in IMTAddWorkspace results
- Files: BlockPanel.tsx, IMTAddWorkspace.tsx

### Task 4: IMT Tab — Add "เพิ่ม IMT" Button
- Top of IMTManager: เพิ่มปุ่ม "➕ เพิ่ม IMT"
- Click → render IMTAddWorkspace instead of IMTManager
- Toggle state in App.tsx or IMTManager
- Files: IMTManager.tsx, App.tsx

### Task 5: Simplify Dashboard Map Click
- Remove showAddButton / 2-step flow from App.tsx
- Revert to single-click → AllocationForm (quick analysis only)
- Remove onConfirmAdd prop from MapView
- Keep the analyze-with-JWT fix from Phase 6
- Files: App.tsx, MapView.tsx

### Task 6: Verify
- tsc --noEmit
- npm run build
- Test: login → IMT tab → เพิ่ม IMT → workspace → input → คำนวณ → log → spectrum → save
- Test: dashboard click → quick analysis still works
