# PAFC Phase 5 Plan — Map Visualization + Spectrum Bar + UX

## User Feedback (2026-07-02)

1. FS links ต้องแสดงบน map (marker + เส้นลากระหว่าง Tx/Rx + รัศมี coverage)
2. รัศมีวงกลมต้อง fix ระยะ coverage — ห้ามเปลี่ยนขนาดตาม zoom
3. IMT ต้องมีระบบเพิ่ม allocation + marker บน map
4. Block panel ต้องเป็น spectrum bar (สี่เหลี่ยมผืนผ้า แบ่ง block)
5. Allocation form ต้องปิดได้ (X button + ESC key)
6. ต้องมี tab query ข้อมูลทั้ง FS และ IMT

## Tasks

### Task 1: MapView Overhaul
**File:** `frontend/src/components/MapView.tsx`

- FS links: โหลดผ่าน fetchWithAuth (รับ token จาก context)
  - เส้นลากระหว่าง Tx→Rx (สีกรม #1A365D, dashed)
  - Marker Tx: tower/radio icon สีแดง, Rx: antenna icon สีน้ำเงิน
  - คลิกที่เส้นหรือ marker → popup แสดง name, operator, freq, block
  - รัศมี coverage: คำนวณจาก Tx→Rx ระยะทาง + Fresnel zone
    - ใช้ formula: radius_m = sqrt(λ * d1 * d2 / (d1+d2)) * 0.6 (first Fresnel zone)
    - λ = c/f (c=3e8, f=center freq MHz)
    - d1, d2 = distances along path
    - Simplified: coverage = max(500m, distance * 0.1) for visual representation

- IMT allocations: โหลดผ่าน fetchWithAuth
  - Marker: cell-tower/site icon สีเขียวน้ำเงิน
  - รัศมี coverage ตาม cell_radius ที่กำหนด (fixed, ไม่เปลี่ยนตาม zoom)
  - คลิก → popup แสดง blocks ที่ allocated, operator, date

- Fixed radius (MUST NOT CHANGE WITH ZOOM):
  - ใช้ formula: pixelRadius = metersToPixelsAtLat(meters, lat, zoom)
  - สูตร: const pixels = meters / (Math.cos(lat * Math.PI/180) * 156543.03392 / Math.pow(2, zoom))
  - Update circle-radius ทุกครั้งที่ zoom change (map.on('zoom'))
  - หรือใช้ turf.js `circle()` สร้าง GeoJSON polygon

### Task 2: Spectrum Bar Redesign
**File:** `frontend/src/components/BlockPanel.tsx`

- เปลี่ยนจาก grid 4x5 มาเป็น bar แนวนอน
- ดีไซน์: spectrum bar แบบสี่เหลี่ยมผืนผ้า
  ```
  [=====|------|====]
   4800  4830  4860 ... 4990 MHz
  ```
- แต่ละ block: ความกว้างตาม bandwidth (10 MHz), สีตาม status
- Label MHz ด้านล่าง
- ตารางสรุปด้านบน (Available/Guard/Blocked counts)
- Hover tooltip แสดงรายละเอียด block

### Task 3: AllocationForm Fixes
**File:** `frontend/src/components/AllocationForm.tsx`

- เพิ่มปุ่ม X (Close) มุมขวาบน
- รับ callback `onClose`
- เพิ่ม ESC key listener (useEffect + keydown)
- Form ปิดเมื่อ click outside? (optional)

### Task 4: Query/Search Tab
**File:** `frontend/src/components/QueryPanel.tsx` (NEW)

- Tab ใหม่ใน nav: "ค้นหา" (Search)
- ค้นหา FS links: filter by name, operator, frequency range
- ค้นหา IMT: filter by operator, location, block
- ตารางแสดงผลลัพธ์แบบ paginated
- คลิก row → zoom to location on map

### Task 5: IMT Allocation Management
**File:** `frontend/src/components/IMTManager.tsx` (NEW)

- เหมือน FSLinkManager แต่สำหรับ IMT/Private Network
- CRUD: name, operator, center lat/lon, cell_radius, antenna params
- Block assignment (เลือก block ที่ allocate ได้)
- Show on map with coverage polygon

## Technical Notes

- อย่าลืม import `useAuth` ใน MapView เพื่อ fetchWithAuth
- turf.js `@turf/turf` สำหรับ circle/polygon หากใช้ GeoJSON approach
- หรือ manual meter-to-pixel calculation ก็พอ
- NBTC theme เหมือนเดิม — ห้าม emoji, Lucide icons เท่านั้น
