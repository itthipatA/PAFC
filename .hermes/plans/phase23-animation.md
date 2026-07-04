# PAFC Phase 23 — Animation System

**Goal:** Add coordinated animations across all 10 components with workspace↔map sync
**Start:** 4 Jul 2026 10:30 ICT
**Base Commit:** `9686a06`

---

## Impact Analysis

### Files to Change (10 total, 5,847 lines)

| # | File | Lines | Change Complexity |
|---|------|-------|-------------------|
| 1 | `index.css` + `tailwind.config.js` | 2 files | Foundation — new keyframes, custom props |
| 2 | `src/hooks/useReducedMotion.ts` | NEW | Simple hook |
| 3 | `src/utils/animation.ts` | NEW | Utility library |
| 4 | `src/components/AnimatePresence.tsx` | NEW | Animation wrappers |
| 5 | `src/components/Button.tsx` | NEW | Press + ripple |
| 6 | `src/components/InputField.tsx` | NEW | Focus glow |
| 7 | `src/components/Skeleton.tsx` | NEW | Loading shimmer |
| 8 | `src/components/MiniMap.tsx` | NEW | Sync animation map |
| 9 | `src/components/IMTAddWorkspace.tsx` | 2137 | Sync engine wiring |
| 10 | `src/components/MapView.tsx` | 1018 | Marker drop, coverage, pulse |
| 11 | `src/components/App.tsx` | 265 | Tab transitions |
| 12 | `src/components/IMTManager.tsx` | 864 | Micro-interactions |
| 13 | `src/components/FSLinkManager.tsx` | 669 | Micro-interactions |
| 14 | `src/components/BlockPanel.tsx` | 153 | Stagger reveal |
| 15 | `src/components/AllocationForm.tsx` | 178 | Log reveal |
| 16 | `src/components/LoginPage.tsx` | 208 | Form focus |
| 17 | `src/components/QueryPanel.tsx` | 283 | Tab indicator |

### Consumer Trace (Cross-component impact)

- `useReducedMotion` → imported by: ALL components
- `animation-utils` → imported by: IMTAddWorkspace, BlockPanel, MapView
- `AnimatePresence` → imported by: App.tsx, IMTAddWorkspace
- `Button` → imported by: ALL components with buttons
- `MiniMap` → imported by: IMTAddWorkspace
- `Skeleton` → imported by: IMTAddWorkspace, IMTManager, FSLinkManager
- CSS variables → used by: ALL tsx files

### NO backend changes required — 100% frontend

---

## Tasks

### Batch 1: Foundation (Senior writes — architecture)
- **T1:** `index.css` — custom properties + keyframes + reduced-motion
- **T2:** `tailwind.config.js` — animation classes
- **T3:** `useReducedMotion.ts` — hook
- **T4:** `animation.ts` — stagger, sequence, debounce-animate utils

### Batch 2: Base Components (delegate)
- **T5:** `AnimatePresence.tsx` — fade, slideUp, slideRight, scale wrappers
- **T6:** `Button.tsx` — ripple + pulse variants
- **T7:** `InputField.tsx` — focus glow + border animation
- **T8:** `Skeleton.tsx` — shimmer bars

### Batch 3: Sync Engine (Senior designs, delegate implements)
- **T9:** `useSyncAnimation.ts` — hook: syncLatLon, syncRadius, syncAntenna, syncAnalyze
- **T10:** `MiniMap.tsx` — CoverageCircle, SectorWedge, PinDrop, PulseWave
- **T11:** `IMTAddWorkspace.tsx` — wire ALL sync triggers

### Batch 4: Application Layer 1-2 (delegate)
- **T12:** App.tsx — tab transitions (AnimatePresence)
- **T13:** IMTManager.tsx — button press, card hover, modal
- **T14:** FSLinkManager.tsx — row appear, modal transitions
- **T15:** BlockPanel.tsx — stagger cards
- **T16:** AllocationForm.tsx — button press, log reveal

### Batch 5: Application Layer 3-4 (delegate)
- **T17:** LoginPage.tsx — form field focus, button pulse
- **T18:** QueryPanel.tsx — tab indicator slide
- **T19:** MapView.tsx — marker drop, coverage expand, pulse

### Batch 6: Verify
- **T20:** tsc --noEmit + npm run build
- **T21:** Gate 3 quick-scan
- **T22:** Reduced-motion test
- **T23:** Git commit + push + Honcho conclude

---

## Success Criteria
- [ ] All animations respect prefers-reduced-motion
- [ ] tsc + build pass with zero errors
- [ ] Workspace↔map synchronized: lat/lon → pan, radius → circle, analyze → pulse
- [ ] No AI slop patterns (Gate 3 clean)
- [ ] Visual consistency across all 10 components
