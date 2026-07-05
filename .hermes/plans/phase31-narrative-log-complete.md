# Phase 31: Complete Narrative Log — Show Every Engine Calculation

## Summary
Rewrite `generateNarrativeLog()` in `IMTAddWorkspace.tsx` to expose ALL engine calculations
that currently happen in the backend but are invisible in the frontend log.

## Files to Change
- **Modify**: `frontend/src/components/IMTAddWorkspace.tsx`
  - `generateNarrativeLog()` function (line 392-773)
  - `handleCalculate` call site (line 1005)

## Signature Changes
```typescript
function generateNarrativeLog(
  params: { 
    lat: number; lon: number; cellRadius: number; antH: number; antG: number; eirp: number; 
    model: string; indoorPct: number  // NEW
  },
  response: any,
  elapsedMs: number,
  pairs: Pair[],
  pairResults: PairResultType[],
  backendVerification: BackendVerification | null,
  coverage: CoverageInfo | null,
  assumptions: Record<string, AssumptionItem> | null,
  blockLimits: BlockEirpLimit[],  // NEW
): string[]
```

Call site update:
```typescript
setLogLines(generateNarrativeLog(
  { lat, lon, cellRadius, antH: antennaHeight, antG: antennaG, eirp: effectiveEirp, model: propagationModel, indoorPct },
  data,
  elapsedMs,
  data.pairs || [],
  data.pair_results || [],
  data.verification || null,
  data.coverage || null,
  data.assumptions || null,
  blockLimits,  // NEW
))
```

## Sections to Add/Modify

### A. Section 1.1: Building Loss (Phase 29) — NEW
- Show `indoorPct` → `building_loss = X dB`
- Show `effective_eirp = max_eirp − building_loss`
- Explain how this flows into all interference calculations

### B. Section 1.2: Spatial Filter Detail — ENHANCE
- Show actual formula: `filter = max_imt_r + max_fs_coord + margin`
- Show FSPL derivation: `d = 10^((PL − 32.4 − 20·log(f))/20)`
- Show per-link coordination distances (max FS EIRP vs actual)

### C. Section 1.3: Phase 0 Enhanced — ENHANCE
- Add risk classification criteria section: `_classify_risk()` thresholds
- For each HIGH/MEDIUM risk pair in ➀/➀b/➁/➁b:
  - Show actual estimated I formula with values: `est_i = EIRP − PL(d,f) + G − disc`
  - Show sector_disc value if IMT is sector type
  - Show adjacent calculations with ACS+ACLR

### D. NEW Section 3.0: Phase 1 — Full Calculation Detail
For EVERY pair_result (all 6 directions), show the actual formula with real numbers:

**Format per direction:**

➀ IMT→FS:
```
I = EIRP_IMT[dBm] − PL[dB] + G_FS_RX[dBi] − sector_disc[dB]
  = 23.0 − 126.7 + 35.0 − 0.0
  = −68.7 dBm
Margin = I − threshold = −68.7 − (−114) = +45.3 dB → CONFLICT
```

➀b IMT→FS_ADJACENT:
```
I = EIRP − PL + G_RX − sector_disc − ACS(33) − ACLR(45) − guard_iso(X)
  = 23.0 − 126.7 + 35.0 − 0.0 − 33 − 45 − 0
  = −146.7 dBm
Margin = −146.7 − (−114) = −32.7 dB → CLEAR
```

➁ FS→IMT (with F.699):
```
FS_EIRP = tx_power[dBm] + tx_antenna_gain[dBi] = 30 + 35 = 65 dBm
Beam angle phi = XX° → F.699 region: main lobe / 1st side-lobe / far side-lobe / back lobe
beam_disc = max_gain − actual_gain = 35 − XX = YY dB
I = FS_EIRP − PL + G_IMT − beam_disc − building_loss
  = 65 − 140.2 + 12 − 25 − 0
  = −88.2 dBm
```

➁b FS→IMT_ADJACENT:
```
I = FS_EIRP − PL + G_IMT − beam_disc − building_loss − ACS(33) − ACLR(45) − guard_iso
  = 65 − 140.2 + 12 − 25 − 0 − 33 − 45 − 0
  = −166.2 dBm
```

➂/➃ IMT↔IMT_COCHANNEL:
```
➂ NEW→EXISTING: I = EIRP_NEW − PL + G_EXISTING − sector_disc_NEW
  = 23 − 135.0 + 12 − 0 = −100.0 dBm
➃ EXISTING→NEW: I = EIRP_EXIST − PL + G_NEW − sector_disc_EXIST − building_loss
  = 35 − 135.0 + 12 − 0 − 0 = −88.0 dBm
Required separation: r1 + r2 + 2000m = 500 + 500 + 2000 = 3000m
Actual distance: 600m → VIOLATES (0.6 < 3.0 km)
```

IMT↔IMT_ADJACENT:
```
total_iso = guard_band_isolation(0MHz) + ACS(33) + ACLR(45) = 33 + 33 + 45 = 111 dB
I = EIRP − PL + G − total_iso − building_loss
Required separation = 2000 / 10^(111/20) = 2000 / 354813 ≈ 0.006m
```

### E. Section 5: Guard Band Analysis — ENHANCE
- Show `guard_band_isolation_db()` formula with actual guard width
- Show calculation: `ACS 33 + roll_off(12/10MHz first, 15/10MHz beyond)`
- Replace static table with dynamic calculation

### F. Section 6: Phase 2 Aggregation — ENHANCE
For worst-case block, show:
```
Phase 2 Aggregation (บล็อก 4810-4820 MHz):
  Pairs contributing:
    → IMT ใหม่: FS→IMT (−88.2 dBm → 1.5e-9 W) + EXISTING→NEW (−88.0 → 1.6e-9)
      i_to_new_imt_linear = 1.5e-9 + 1.6e-9 = 3.1e-9 W
      I_total → IMT ใหม่ = 10·log₁₀(3.1e-9) = −85.1 dBm
    → FS RX: IMT→FS (−68.7 dBm → 1.3e-7 W)
      I_total → FS = 10·log₁₀(1.3e-7) = −68.7 dBm
  Combined = 10·log₁₀(3.1e-9 + 1.3e-7) = −68.3 dBm
```

### G. NEW Section 7: Phase 3 — EIRP Limits
For each block with limits, show:
```
Phase 3: Per-Block Max EIRP (บล็อก 4810-4820 MHz):
  Realistic regulatory cap = 24 + (43−24) × (1−0/100) = 43 dBm
  Per-pair margins:
    BKK-01-Link (IMT→FS): margin = −114 − (−68.7) = 45.3 dB
    BKK-02-Link (IMT→FS): margin = −114 − (−72.1) = 41.9 dB → RESTRICTIVE
  Max EIRP = current_eirp + min(margin) = 23 + 41.9 = 64.9 → capped at 43.0 dBm
  Verdict: GREEN — can transmit up to 43 dBm (coverage-needed: 23 dBm)
```

RED blocks:
```
บล็อก 4820-4830 MHz [RED — reducible]:
  I_total → IMT ใหม่ = −58.0 dBm > threshold −114 dBm
  BUT all interferers are "FS/existing-IMT" (not NEW_IMT)
  → reducing own EIRP won't help → reducible: false
  การลดกำลังส่งไม่ช่วย — ถูกรบกวนจากระบบอื่น
```

### H. NEW Section 8: Building Loss Trace
```
Building Loss Trace (indoor_pct=30%):
  building_loss = 30/100 × 20 = 6 dB
  effective_eirp = 23 − 6 = 17 dBm
  
  Effects on interference:
  ➤ IMT as INTERFERER: 6 dB lower EIRP → I reduced by 6 dB for directions ➀/➀b/➂
  ➤ IMT as VICTIM:     6 dB attenuation → I reduced by 6 dB for directions ➁/➁b/➃
  
  Net effect: bidirectional protection (−6 dB outgoing + −6 dB incoming)
```

## Rules
1. ALL generic formulas MUST be replaced with actual numbers from pair_results data
2. Show `I = A[dBm] − B[dB] + C[dBi] − D[dB] = RESULT dBm` format
3. Group pairs by direction, sort by |margin| descending (worst first)
4. Use `pair_results[].detail` strings as fallback/detail supplement
5. Use `blockLimits[]` for Phase 3 display
6. Use `pair_results[].path_loss_db`, `.i_dbm`, `.margin_db`, `.effective_distance_m` for all numbers
7. Use `pair_results[].pair.within_beam` for F.699 beam info
8. No emoji, no box-drawing chars. Use `===` separators, `───` section headers (same as existing)
9. Thai labels for section headers

## Verification
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds
- [ ] Function signature matches call site
- [ ] blockLimits and indoorPct passed correctly
- [ ] No unused imports/variables
