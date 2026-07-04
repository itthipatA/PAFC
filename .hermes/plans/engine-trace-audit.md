# PAFC Interference Engine — Data Trace Audit
## วันที่: 4 กรกฎาคม 2569

---

## 1. Data Flow Overview

```
analyze() [entry point]
  │
  ├─ self.model_params = model_params or {}     ← STORED ON INSTANCE
  │
  ├─ Phase 0: phase0_identify_pairs()
  │   Inputs:  center_lat, center_lon, cell_radius, antenna_height,
  │             antenna_gain, max_eirp, fs_links, neighbor_imts,
  │             antenna_type, sector_beamwidth_deg, sector_azimuth_deg
  │   Uses:    self.model, self._compute_spatial_filter_km(),
  │            freq_overlap(), haversine_m(), dist_to_path_m()
  │   Outputs: list[InterferencePair] → pairs
  │   Consumed by: Phase 1
  │
  ├─ Phase 1: phase1_compute_pairs()
  │   Inputs:  pairs (from Phase 0), all spatial params,
  │             antenna_type, sector_beamwidth_deg, sector_azimuth_deg
  │   Uses:    self.model, _compute_imt_to_fs(), _compute_fs_to_imt(),
  │            _compute_imt_to_imt_cochannel(), _compute_imt_to_imt_adjacent(),
  │            _compute_fs_to_imt_adjacent()
  │   Outputs: list[PairResult] → pair_results
  │   Consumed by: Phase 2, verify, allocation.py (response)
  │
  ├─ Phase 2: phase2_aggregate()
  │   Inputs:  pair_results, band_start, band_end, max_eirp
  │   Uses:    freq_overlap()
  │   Outputs: list[BlockResult] → blocks
  │   Consumed by: allocation.py (response), verify
  │
  ├─ _verify_blocks()
  │   Inputs:  blocks, band_start, band_end, pair_results
  │   Outputs: dict → verification
  │   Consumed by: allocation.py (response)
  │
  └─ get_assumptions()
      Inputs:  NONE (uses only self.model_name)
      Outputs: dict → assumptions
      Consumed by: allocation.py (response)
```

---

## 2. Orphan Calculation #1: `model_params` NOT propagated to all path_loss_db calls

**Severity: HIGH**

### Description
`analyze()` receives `model_params` (e.g., `time_pct=50`, `clutter_type="urban"`, `environment="suburban"`) and stores it as `self.model_params`. However, only ONE of the five Phase 1 calculation methods passes `self.model_params` to `self.model.path_loss_db()`:

| Method | Passes model_params? | Impact |
|--------|---------------------|--------|
| `_compute_imt_to_fs` | ❌ NO | P.452 time_pct, P.2108 clutter_type ignored |
| `_compute_fs_to_imt` | ❌ NO | P.452 time_pct, P.2108 clutter_type ignored |
| `_compute_imt_to_imt_cochannel` | ❌ NO | P.1411 environment, Hata environment ignored |
| `_compute_imt_to_imt_adjacent` | ✅ YES (line 1137) | Only one that works correctly |
| `_compute_fs_to_imt_adjacent` | ❌ NO | P.452 time_pct, P.2108 clutter_type ignored |

Also: Phase 0 `phase0_identify_pairs()` does NOT pass `model_params` to ANY of its `self.model.path_loss_db()` calls (lines 637-642, 686-691, 755-759, 777-782).

### Fix
Pass `**self.model_params` to ALL `self.model.path_loss_db()` calls in Phase 0 and Phase 1.

---

## 3. Orphan Calculation #2: `get_assumptions()` uses hardcoded values

**Severity: HIGH**

### Description
`get_assumptions()` (lines 381-479) hardcodes:
- Line 463-465: `"value": "Omni-directional"` — always shows Omni even when user selects Sector
- Line 451-454: description always mentions "FSPL = ไม่มีสิ่งกีดขวาง (free space)" regardless of model
- No parameters accepted — cannot show user-selected `cell_radius`, `antenna_height`, etc.

### Fix
Modify `get_assumptions()` to accept `antenna_type`, `model_params`, and other context. Show actual model-specific info.

---

## 4. Orphan Calculation #3: `preliminary_risk` computed but unused in Phase 1/2

**Severity: LOW (by design)**

### Description
Phase 0 `_classify_risk()` classifies pairs as HIGH/MEDIUM/LOW. This `preliminary_risk` field:
- Is used for sorting pairs (line 820-821) ✅
- Is returned in API response ✅
- Is displayed in frontend pairs panel ✅
- Is NOT used in Phase 1 calculations — Phase 1 recalculates everything from scratch
- Is NOT used in Phase 2 aggregation

This is by design (pre-screen only). Not a bug but worth documenting.

---

## 5. No orphan outputs detected

All computed values flow through to consumers:

| Value | Produced by | Consumed by |
|-------|-----------|------------|
| `pairs` | Phase 0 | Phase 1, API response |
| `pair_results` | Phase 1 | Phase 2, _verify_blocks, API response |
| `blocks` | Phase 2 | API response, _verify_blocks |
| `summary` | analyze() | API response |
| `verification` | _verify_blocks() | API response |
| `assumptions` | get_assumptions() | API response |
| `computation_time_ms` | analyze() | API response |
| `spatial_filter_km` | _compute_spatial_filter_km() | Phase 0, API response |

---

## 6. No duplicate calculations

Each calculation is performed once:
- Path loss: computed in Phase 1 per pair (not recomputed in Phase 2)
- Aggregate interference: computed in Phase 2 (linear sum per victim type)
- Risk classification: computed in Phase 0 only

---

## Summary

| # | Issue | Severity | Action |
|---|-------|----------|--------|
| 1 | `model_params` not propagated to all `path_loss_db` calls | HIGH | Fix → pass `**self.model_params` everywhere |
| 2 | `get_assumptions()` hardcodes antenna type + model description | HIGH | Fix → accept params, show dynamic values |
| 3 | `preliminary_risk` unused in later phases | LOW | By design — document |
| 4 | No orphan outputs | PASS | — |
| 5 | No duplicate calculations | PASS | — |
