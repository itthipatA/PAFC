# PAFC Coding Conventions — Single Source of Truth

> Injected into ALL subagent contexts. Violations = rejected code.

## Hard Rules (NON-NEGOTIABLE)

| Rule | Enforcement |
|------|------------|
| **NO emoji anywhere** | Lucide React icons only. grep check: `[\⚠️✅❌🔴🟢📍🔍📡]` |
| **Thai text for all labels, buttons, explanations** | Except "Analyze" button (English per user) |
| **Button component: variant only** | No `size` prop. Variants: `primary`/`secondary`/`danger`/`ghost` |
| **Map pan-only default** | `clickMode='pan'`, grab cursor, separate "Add" button |
| **Spectrum blocks: black border** | `border: 1px solid #000` |
| **No box-drawing chars in logs** | No ╔╗╚╝┌┐└┘. Use `===` separators |
| **Lat/Lon: 7 decimal places** | `step="0.0000001"`, `.toFixed(7)` |
| **EIRP already includes BS antenna gain** | Never double-count |

## NBTC Theme Colors

| Token | Hex | Usage |
|-------|-----|-------|
| Primary | `#C00000` | Buttons, accents |
| Secondary | `#1A1A2E` | Nav bar |
| Background | `#F5F5F0` | Page bg |
| Green (available) | `#16A34A` | Allocated blocks |
| Red (blocked) | `#DC2626` | Conflict blocks |
| Gray (guard) | `#9CA3AF` | Guard band |
| Light gray | `#E5E7EB` | Unallocated |
| IMT Strong (inner) | `#0D9488` | Teal — excellent coverage |
| IMT Medium (mid) | `#8B5CF6` | Violet — good coverage |
| IMT Weak (outer) | `#F472B6` | Pink — marginal coverage |
| FS TX marker | `#EF4444` / `#DC2626` | Red — interferer |
| FS RX marker | `#BFDBFE` / `#93C5FD` | Blue — victim |

## Thai Terminology

| English | Thai |
|---------|------|
| Available | ว่าง / พร้อมใช้งาน |
| Blocked | ถูกจอง / ไม่สามารถจัดสรร |
| Guard Band | ย่านป้องกัน |
| Coverage: OUTDOOR_GOOD | ครอบคลุมดีเยี่ยม |
| Coverage: OUTDOOR_BASIC | ครอบคลุมพื้นฐาน |
| Coverage: MARGINAL | ครอบคลุมขั้นต่ำ |
| Coverage: INADEQUATE | สัญญาณไม่เพียงพอ |

## Frontend Patterns

- `fetchWithAuth()` from `useAuth()` for ALL protected endpoints — NEVER bare `fetch()`
- `useRef` pattern for callback props in `useEffect[]` (stale closure fix)
- MapLibre `isStyleLoaded()` guard before ANY `addSource()`
- Animation wrappers need `flex-1` className (flex layout breakage)
- NEVER literal `\n` in JSX — search with `grep -r '\\\\n' src/`

## Backend Patterns

- Dataclasses for models, Pydantic for API schemas
- All endpoints use JWT auth
- AsyncSession for DB queries
- Migration pattern: `app/db/00X_description.sql`
- CoverageEngine MUST be called before analyze/analyze_parcel
- Restart uvicorn after ANY backend change: `lsof -ti:8001 | xargs kill -9`
