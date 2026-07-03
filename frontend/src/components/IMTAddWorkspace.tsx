import { useState, useEffect, useRef, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { circle } from '@turf/turf'
import { Search, Save, ArrowLeft, PlusCircle, CheckCircle, Shield, XCircle, MapPin, AlertTriangle, Zap, ArrowRight, ToggleLeft, ToggleRight, Radio, Signal } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { MAP_STYLES } from './MapView'
import type { BlockResult, Pair, PairResult as PairResultType, AnalyzeSummary, BackendVerification, CoverageInfo, TradeOff, AssumptionItem } from '../types'

interface IMTAddWorkspaceProps {
  onBack: () => void
  mode?: 'full' | 'panel'
  onCellRadiusChange?: (r: number) => void
  onConfirmLocation?: (lat: number, lon: number, cellRadius: number) => void
}

const LAYER_IDS = {
  miniCellFill: 'mini-cell-fill',
  miniCellSource: 'mini-cell-source',
  miniFSLine: 'mini-fs-line',
  miniFSSource: 'mini-fs-source',
  miniIMTFill: 'mini-imt-fill',
  miniIMTOutline: 'mini-imt-outline',
  miniIMTSource: 'mini-imt-source',
}

// ─── Helper: Parse conflict reason from backend ─────────────────────────────

interface ParsedReason {
  conflictType: 'FS' | 'IMT_COCHANNEL' | 'GUARD' | 'UNKNOWN' | 'AVAILABLE'
  linkName?: string      // FS link or IMT name
  iValue?: string         // Interference dBm (FS)
  threshold?: string      // Threshold dBm (FS) or separation distance
  exceedDb?: string       // Exceed value (FS) or actual distance
  imtDistance?: string    // Actual IMT separation distance
  neededSeparation?: string // Required separation distance
  raw: string
}

function parseReason(reason: string): ParsedReason {
  const raw = reason || ''

  // FS conflict: "FS conflict: BKK-01-Link (I=-54.4 dBm > threshold -114.0 dBm, exceed 59.6 dB | ...)"
  const fsMatch = raw.match(/FS conflict:\s*(.+?)\s*\(I=([-\d.]+)\s*dBm\s*>\s*threshold\s*([-\d.]+)\s*dBm/)
  if (fsMatch) {
    const linkName = fsMatch[1].trim()
    const iValue = fsMatch[2]
    const threshold = fsMatch[3]
    const exceedDb = (parseFloat(iValue) - parseFloat(threshold)).toFixed(1)

    // Extract causal info if present (exceed, distance, PL)
    const exceedMatch = raw.match(/exceed\s*([-\d.]+)\s*dB/)
    const distMatch = raw.match(/ระยะ\s*([\d.]+)\s*m/)
    const plMatch = raw.match(/PL≈?([\d.]+)\s*dB/)

    return {
      conflictType: 'FS',
      linkName,
      iValue,
      threshold,
      exceedDb: exceedMatch ? exceedMatch[1] : exceedDb,
      imtDistance: distMatch ? (parseFloat(distMatch[1]) / 1000).toFixed(1) : undefined,
      neededSeparation: plMatch ? `PL≈${plMatch[1]} dB` : undefined,
      raw,
    }
  }

  // IMT co-channel: "IMT co-channel conflict: TEST-IMT-01 (1.2 km < 3.0 km)" 
  // or new format: "...(1.2 km < ขั้นต่ำ 1.7 km | I=-45.0 dBm, PL≈110 dB)"
  const imtMatch = raw.match(/IMT co-channel conflict:\s*(.+?)\s*\(([\d.]+)\s*km\s*<\s*(?:ขั้นต่ำ\s*)?([\d.]+)\s*km/)
  if (imtMatch) {
    const linkName = imtMatch[1].trim()
    const imtDistance = imtMatch[2]
    const neededSeparation = imtMatch[3]

    // Extract extra causal info
    const iMatch = raw.match(/I=([-\d.]+)\s*dBm/)
    const plMatch = raw.match(/PL≈?([\d.]+)\s*dB/)

    return {
      conflictType: 'IMT_COCHANNEL',
      linkName,
      imtDistance,
      neededSeparation,
      iValue: iMatch ? iMatch[1] : undefined,
      raw,
    }
  }

  // Guard band: "Guard band: adjacent to TEST-IMT-01 (0.6 km < 1.5 km)"
  const guardMatch = raw.match(/Guard band:\s*(.+?)\s*\(([\d.]+)\s*km\s*<\s*([\d.]+)\s*km\)/)
  if (guardMatch) {
    const linkName = guardMatch[1].trim().replace('adjacent to ', '')
    const imtDistance = guardMatch[2]
    const neededSeparation = guardMatch[3]
    return { conflictType: 'GUARD', linkName, imtDistance, neededSeparation, raw }
  }

  if (raw.toLowerCase().includes('available')) {
    return { conflictType: 'AVAILABLE', raw }
  }

  return { conflictType: 'UNKNOWN', raw }
}

// ─── Result Verification Engine ─────────────────────────────────────────────

interface VerificationResult {
  passed: boolean
  warnings: string[]
  errors: string[]
}

function verifyResults(blocks: BlockResult[]): VerificationResult {
  const warnings: string[] = []
  const errors: string[] = []

  const greenBlocks = blocks.filter(b => b.status === 'green')
  const redBlocks = blocks.filter(b => b.status === 'red')
  const grayBlocks = blocks.filter(b => b.status === 'gray')

  // Check 1: Total block count (4800-4990 MHz = 190 MHz / 10 MHz = 19 blocks)
  if (blocks.length !== 19) {
    errors.push(`Expected 19 blocks (4800-4990 MHz), got ${blocks.length}`)
  }

  // Check 2: Frequency continuity (each block should be 10 MHz, sequential)
  for (let i = 0; i < blocks.length; i++) {
    if (Math.abs(blocks[i].freq_low - (4800 + i * 10)) > 0.1) {
      errors.push(`Block ${i}: expected freq_low=${4800 + i * 10}, got ${blocks[i].freq_low}`)
    }
  }

  // Check 3: Guard band adjacency — green blocks should not be adjacent to red without gray
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i - 1].status === 'green' && blocks[i].status === 'red') {
      warnings.push(`Green block ${blocks[i - 1].freq_low}-${blocks[i - 1].freq_high} adjacent to red without guard. Possible missed guard band.`)
    }
    if (blocks[i - 1].status === 'red' && blocks[i].status === 'green') {
      warnings.push(`Red block ${blocks[i - 1].freq_low}-${blocks[i - 1].freq_high} adjacent to green without guard. Possible missed guard band.`)
    }
  }

  // Check 4: Total MHz consistency
  const totalMHz = greenBlocks.length * 10 + redBlocks.length * 10 + grayBlocks.length * 10
  if (totalMHz !== 190) {
    errors.push(`Total MHz mismatch: ${totalMHz} != 190`)
  }

  // Check 5: Guard band reason should mention adjacent conflict
  for (const b of grayBlocks) {
    if (!b.reason.toLowerCase().includes('adjacent') && !b.reason.toLowerCase().includes('guard')) {
      warnings.push(`Gray block ${b.freq_low}-${b.freq_high}: reason doesn't mention adjacency/guard`)
    }
  }

  return {
    passed: errors.length === 0,
    warnings,
    errors,
  }
}

const PROPAGATION_MODEL_INFO: Record<string, { label: string; description: string; params?: { name: string; label: string; unit: string; defaultValue: any }[] }> = {
  free_space: {
    label: 'Free Space',
    description: 'ITU-R P.525 — Free Space Path Loss ไม่มีสิ่งกีดขวาง (conservative upper bound)',
    params: [],
  },
  p452: {
    label: 'ITU-R P.452',
    description: 'ITU-R P.452 — Clear-air basic transmission loss คำนึงถึง % เวลา + clutter environment',
    params: [
      { name: 'time_pct', label: 'Time %', unit: '%', defaultValue: 50 },
    ],
  },
  p2108: {
    label: 'ITU-R P.2108 Clutter',
    description: 'ITU-R P.2108 — Clutter loss จากสิ่งกีดขวาง (อาคาร/ต้นไม้) สำคัญเมื่อ terminal อยู่ต่ำกว่า rooftop',
    params: [
      { name: 'clutter_type', label: 'สภาพแวดล้อม', unit: '', defaultValue: 'urban' },
    ],
  },
  p1411: {
    label: 'ITU-R P.1411',
    description: 'ITU-R P.1411 — Short-range outdoor สำหรับ IMT-to-IMT ระดับถนน (street canyon)',
    params: [
      { name: 'environment', label: 'สภาพแวดล้อม', unit: '', defaultValue: 'urban' },
    ],
  },
  hata: {
    label: 'Hata/COST-231',
    description: 'Okumura-Hata COST-231 extension สำหรับ IMT coverage ในพื้นที่เมือง',
    params: [
      { name: 'environment', label: 'สภาพแวดล้อม', unit: '', defaultValue: 'urban' },
    ],
  },
}

// ─── Coverage Engine helpers (Phase 15) ──────────────────────────────────

function coverageClassificationThai(cls: string): string {
  const labels: Record<string, string> = {
    OUTDOOR_GOOD: 'ครอบคลุมดีเยี่ยม',
    OUTDOOR_BASIC: 'ครอบคลุมพื้นฐาน',
    MARGINAL: 'ครอบคลุมขั้นต่ำ',
    INADEQUATE: 'สัญญาณไม่เพียงพอ',
  }
  return labels[cls] || cls
}

function coverageStatusColor(cls: string): string {
  const colors: Record<string, string> = {
    OUTDOOR_GOOD: '#16A34A',
    OUTDOOR_BASIC: '#16A34A',
    MARGINAL: '#F59E0B',
    INADEQUATE: '#DC2626',
  }
  return colors[cls] || '#9CA3AF'
}

/** Local EIRP estimate using FSPL link budget (same formula as backend).
 *  FSPL = 32.4 + 20*log10(d_km) + 20*log10(f_MHz)
 *  EIRP = target_RSS + FSPL - G_UE + shadow_margin
 *  default: target_RSS=-95 dBm, G_UE=0 dBi, shadow_margin=8 dB, f=4900 MHz */
function estimateEirp(cellRadiusM: number): number {
  const dKm = cellRadiusM / 1000
  if (dKm <= 0) return 0
  const fspl = 32.4 + 20 * Math.log10(dKm) + 20 * Math.log10(4900)
  const targetRss = -95
  const gUe = 0
  const shadowMargin = 8
  return targetRss + fspl - gUe + shadowMargin
}

// ─── Narrative ASCII Log Generator ────────────────────────────────────────

function directionLabelForLog(direction: string): string {
  const labels: Record<string, string> = {
    'IMT→FS': 'IMT→Fixed Service',
    'FS→IMT': 'Fixed Service→IMT',
    'FS→IMT_ADJACENT': 'Fixed Service→IMT (adjacent)',
    'IMT↔IMT_COCHANNEL': 'IMT↔IMT (co-channel)',
    'IMT↔IMT_ADJACENT': 'IMT↔IMT (adjacent)',
  }
  return labels[direction] || direction
}

function generateNarrativeLog(
  params: { lat: number; lon: number; cellRadius: number; antH: number; antG: number; eirp: number; model: string },
  response: any,
  elapsedMs: number,
  pairs: Pair[],
  pairResults: PairResultType[],
  backendVerification: BackendVerification | null,
  coverage: CoverageInfo | null,
  assumptions: Record<string, AssumptionItem> | null,
): string[] {
  const lines: string[] = []
  const blocks = response.blocks || []
  const modelLabel = PROPAGATION_MODEL_INFO[params.model]?.label || params.model
  const green = blocks.filter((b: any) => b.status === 'green')
  const red = blocks.filter((b: any) => b.status === 'red')
  const gray = blocks.filter((b: any) => b.status === 'gray')

  // ═══════════════════════════════════════════════════════════
  // HEADER — Frame the tutorial
  // ═══════════════════════════════════════════════════════════
  lines.push('+===========================================================+')
  lines.push('|  PAFC INTERFERENCE ANALYSIS — ENGINEERING TUTORIAL       |')
  lines.push('|                                                           |')
  lines.push('|  This report teaches how spectrum coordination works.     |')
  lines.push('|  Each step explains WHAT we do, WHY we do it, and HOW    |')
  lines.push('|  the calculation works — like teaching a junior engineer. |')
  lines.push('+===========================================================+')
  lines.push('')

  // ═══════════════════════════════════════════════════════════
  // STEP 1: INPUT PARAMETERS — "Know your system"
  // ═══════════════════════════════════════════════════════════
  lines.push('STEP 1: KNOW YOUR SYSTEM')
  lines.push('────────────────────────────────────────────────────────')
  lines.push('')
  lines.push('  Before we can analyze interference, we need to know:')
  lines.push('  1. WHERE is the new station? (location)')
  lines.push('  2. HOW BIG is its coverage? (cell radius)')
  lines.push('  3. HOW MUCH power does it transmit? (EIRP)')
  lines.push('  4. HOW does the signal propagate? (model + frequency)')
  lines.push('')
  lines.push('  New IMT Station Parameters:')
  lines.push(`    Location        : (${params.lat.toFixed(4)}, ${params.lon.toFixed(4)})`)
  lines.push(`    Cell Radius     : ${params.cellRadius} m`)
  lines.push(`    Antenna Height  : ${params.antH} m AGL`)
  lines.push(`    Antenna Gain    : ${params.antG} dBi`)
  if (coverage?.auto_eirp) {
    lines.push(`    Max EIRP        : ${coverage.used_eirp_dbm.toFixed(1)} dBm (auto-calculated)`)
  } else {
    lines.push(`    Max EIRP        : ${params.eirp} dBm`)
  }
  lines.push(`    Propagation     : ${modelLabel}`)
  lines.push(`    Frequency Band  : 4800 - 4990 MHz (19 blocks x 10 MHz)`)
  lines.push('')
  lines.push('  [ASCII: Spectrum Band Diagram]')
  lines.push('   4800                                                4990 MHz')
  lines.push('   |---||---||---||---||---||---||---||---||---||---|')
  lines.push('   Each |---| = 10 MHz block (19 blocks = 190 MHz total)')
  lines.push('')

  // ═══════════════════════════════════════════════════════════
  // STEP 2: ENGINEERING ASSUMPTIONS — "What we assume about physics"
  // ═══════════════════════════════════════════════════════════
  if (assumptions && Object.keys(assumptions).length > 0) {
    lines.push('STEP 2: ENGINEERING ASSUMPTIONS')
    lines.push('────────────────────────────────────────────────────────')
    lines.push('')
    lines.push('  Every engineering calculation rests on assumptions.')
    lines.push('  These are the "rules of the game" — if they change,')
    lines.push('  the results change. A good engineer knows their assumptions.')
    lines.push('')
    lines.push('  KEY ASSUMPTIONS:')
    const key = ['interference_threshold', 'cochannel_protection', 'adjacent_protection',
                 'fs_beamwidth', 'propagation']
    for (const k of key) {
      const a = assumptions[k]
      if (!a) continue
      lines.push(`  ${a.label}: ${a.value}`)
      lines.push(`    ${a.description}`)
      lines.push(`    Reality check: ${a.reality_check || 'N/A'}`)
      lines.push('')
    }
    lines.push('  [ASCII: Interference Threshold Concept]')
    lines.push('')
    lines.push('   IMT EIRP -----> FSPL(distance) -----> FS Receiver')
    lines.push('   35 dBm          100 dB loss          I = -65 dBm')
    lines.push('                                         |')
    lines.push('                                    threshold = -114 dBm')
    lines.push('                                         |')
    lines.push('                                    -65 > -114? YES --> CONFLICT!')
    lines.push('')
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 3: VICTIM/INTERFERER IDENTIFICATION — "Who could interfere?"
  // ═══════════════════════════════════════════════════════════
  if (pairs.length > 0) {
    const filterKm = response.spatial_filter_km || '5.0'
    const highRisk = pairs.filter(p => p.preliminary_risk === 'HIGH')
    const medRisk = pairs.filter(p => p.preliminary_risk === 'MEDIUM')
    const lowRisk = pairs.filter(p => p.preliminary_risk === 'LOW')

    lines.push('STEP 3: VICTIM/INTERFERER IDENTIFICATION (Phase 0 Pre-Screen)')
    lines.push('────────────────────────────────────────────────────────')
    lines.push('')
    lines.push('  PURPOSE: Before calculating exact interference levels,')
    lines.push('  we do a fast pre-scan to identify WHICH systems could')
    lines.push('  potentially interfere — saving computation time.')
    lines.push('')
    lines.push('  HOW IT WORKS:')
    lines.push(`  1. Spatial filter: search radius = ${filterKm} km around new IMT`)
    lines.push('     (max IMT radius + max FS coordination distance + margin)')
    lines.push('  2. Frequency filter: only systems whose bands overlap with 4800-4990')
    lines.push('  3. Generate pairs in 4 directions:')
    lines.push('     - IMT -> FS receiver        (IMT interferes with fixed link)')
    lines.push('     - FS transmitter -> IMT     (fixed link interferes with IMT)')
    lines.push('     - IMT <-> IMT co-channel    (same frequency, different location)')
    lines.push('     - IMT <-> IMT adjacent      (nearby frequencies)')
    lines.push('')
    lines.push(`  Systems checked: ${(response.fs_links_checked || 0)} FS links + ${(response.neighbor_imts_checked || 0)} IMT blocks`)
    lines.push(`  Pairs identified: ${pairs.length} total`)
    lines.push('')
    lines.push('  [ASCII: Interference Topology]')
    lines.push('')
    lines.push('            FS Link (incumbent)')
    lines.push('          Tx ----------------> Rx')
    lines.push('           |                    ^')
    lines.push('           | FS-->IMT           | IMT-->FS')
    lines.push('           v                    |')
    lines.push('         [New IMT] <----------> [Existing IMT]')
    lines.push('                    co-channel')
    lines.push('')
    lines.push(`  Risk distribution: ${highRisk.length} HIGH, ${medRisk.length} MEDIUM, ${lowRisk.length} LOW`)
    lines.push('  (Criteria: margin > +20 dB = HIGH, margin > -10 dB = MEDIUM)')
    lines.push('')

    if (highRisk.length > 0) {
      lines.push('  HIGH RISK PAIRS (will be analyzed in detail):')
      highRisk.forEach((p, i) => {
        const dirLabel = directionLabelForLog(p.direction)
        const freqStr = p.freq_overlap_low && p.freq_overlap_high
          ? `${p.freq_overlap_low.toFixed(0)}-${p.freq_overlap_high.toFixed(0)} MHz`
          : 'N/A'
        lines.push(`  ${i + 1}. ${dirLabel}`)
        lines.push(`     ${p.interferer_name} ----interferes----> ${p.victim_name}`)
        lines.push(`     Freq: ${freqStr} | Dist: ${(p.distance_m / 1000).toFixed(2)} km | Est.I: ${p.estimated_i_dbm.toFixed(1)} dBm`)
        if (p.direction === 'FS→IMT' && p.within_beam !== null) {
          lines.push(`     FS beam: ${p.within_beam ? 'IMT IS IN the main beam (worst case!)' : 'IMT is outside main beam (-25 dB side-lobe)'}`)
        }
      })
    }
    lines.push('')
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 4: LINK BUDGET — "How much power do we need?"
  // ═══════════════════════════════════════════════════════════
  if (coverage?.auto_eirp) {
    const dKm = params.cellRadius / 1000
    const fsplEdge = 32.4 + 20 * Math.log10(dKm || 0.001) + 20 * Math.log10(4900)
    const thaiClass = coverageClassificationThai(coverage.coverage_classification)

    lines.push('STEP 4: LINK BUDGET (Coverage Engine)')
    lines.push('────────────────────────────────────────────────────────')
    lines.push('')
    lines.push('  PURPOSE: Before analyzing interference, we need to know')
    lines.push('  HOW MUCH POWER the new IMT actually needs. The coverage')
    lines.push('  engine calculates this from the desired cell radius.')
    lines.push('')
    lines.push('  THE PHYSICS: Signal gets weaker with distance (Free Space Path Loss).')
    lines.push('  At the cell edge, the received signal must be above the')
    lines.push('  receiver sensitivity (target RSS). This determines the')
    lines.push('  minimum transmitter power (EIRP) we need.')
    lines.push('')
    lines.push('  [ASCII: Signal Strength vs Distance]')
    lines.push('')
    lines.push('  TX Power (EIRP)')
    lines.push('       |')
    lines.push('       |\\')
    lines.push('       | \\         <-- FSPL loss = 32.4 + 20log(d) + 20log(f)')
    lines.push('       |  \\')
    lines.push('       |   \\___ Target RSS = -95 dBm @ cell edge')
    lines.push('       |        \\')
    lines.push('       +---------+---------+---------> Distance')
    lines.push('       0       250m      500m     ')
    lines.push('')
    lines.push('  Input Parameters:')
    lines.push(`    Cell Radius        : ${params.cellRadius} m (${dKm.toFixed(2)} km)`)
    lines.push(`    Target RSS         : ${coverage.target_rss_dbm} dBm`)
    lines.push(`    Shadow Margin      : ${coverage.shadow_margin_db} dB`)
    lines.push(`    UE Antenna Gain    : 0 dBi (mobile terminal)`)
    lines.push('')
    lines.push('  Formula:')
    lines.push('    EIRP_req = RSS_target + FSPL(d, f) - G_UE + Shadow_Margin')
    lines.push('')
    lines.push('  Calculation (worked example):')
    lines.push(`    FSPL at ${dKm.toFixed(2)} km: 32.4 + 20*log10(${dKm.toFixed(2)}) + 20*log10(4900)`)
    lines.push(`                              = 32.4 + ${(20 * Math.log10(dKm || 0.001)).toFixed(1)} + 73.8`)
    lines.push(`                              = ${fsplEdge.toFixed(1)} dB`)
    lines.push(`    Required EIRP = ${coverage.target_rss_dbm} + ${fsplEdge.toFixed(1)} - 0 + ${coverage.shadow_margin_db}`)
    lines.push(`                  = ${coverage.required_eirp_dbm?.toFixed(1)} dBm`)
    lines.push(`    Used EIRP     = ${coverage.used_eirp_dbm?.toFixed(1)} dBm`)
    lines.push(`    Cell Edge RSS = ${coverage.cell_edge_rss_dbm?.toFixed(1)} dBm`)
    lines.push('')
    lines.push(`  Coverage Classification: ${coverage.coverage_classification} (${thaiClass})`)
    lines.push('')
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 5: PROPAGATION MODEL — "How does the signal travel?"
  // ═══════════════════════════════════════════════════════════
  lines.push('STEP 5: PROPAGATION MODEL')
  lines.push('────────────────────────────────────────────────────────')
  lines.push('')
  lines.push('  PURPOSE: The path loss model determines how much the')
  lines.push('  signal weakens over distance. This directly affects')
  lines.push('  whether interference reaches harmful levels.')
  lines.push('')
  if (params.model === 'free_space') {
    const fspl1km = 32.4 + 20 * Math.log10(1) + 20 * Math.log10(4900)
    lines.push('  Model: Free Space Path Loss (ITU-R P.525)')
    lines.push('')
    lines.push('  FSPL is the SIMPLEST model — assumes NO obstacles')
    lines.push('  between transmitter and receiver. This gives the')
    lines.push('  LOWEST path loss → HIGHEST interference → MOST conservative.')
    lines.push('')
    lines.push('  [ASCII: FSPL Curve]')
    lines.push('')
    lines.push('  Path Loss (dB)')
    lines.push('  140 |                              *')
    lines.push('      |                          *')
    lines.push('  120 |                      *')
    lines.push('      |                  *')
    lines.push('  100 |              *    <-- at 1 km: ~106 dB')
    lines.push('      |          *')
    lines.push('   80 |      *')
    lines.push('      +---------------------------------> Distance (km)')
    lines.push('      0.1   0.5    1     2     5    10')
    lines.push('')
    lines.push('  Formula: FSPL(dB) = 32.4 + 20*log10(d_km) + 20*log10(f_MHz)')
    lines.push(`  At 1 km, 4900 MHz: FSPL = 32.4 + 0 + 73.8 = ${fspl1km.toFixed(1)} dB`)
    lines.push('')
    lines.push('  LIMITATIONS: No clutter, terrain, or atmospheric effects.')
    lines.push('  Real-world path loss is typically 10-30 dB HIGHER.')
    lines.push('  This model is CONSERVATIVE — it will find MORE interference')
    lines.push('  than actually occurs (safer for protection, may block more).')
  } else {
    lines.push(`  Model: ${modelLabel}`)
    lines.push(`  ${PROPAGATION_MODEL_INFO[params.model]?.description || ''}`)
  }
  lines.push('')

  // ═══════════════════════════════════════════════════════════
  // STEP 6: CONFLICT ANALYSIS — Per-Pair Calculation Results
  // ═══════════════════════════════════════════════════════════
  lines.push('STEP 6: INTERFERENCE CALCULATION (Phase 1 Results)')
  lines.push('────────────────────────────────────────────────────────')
  lines.push('')
  lines.push('  PURPOSE: For each pair identified in Step 3, we now')
  lines.push('  calculate the EXACT interference power at the victim.')
  lines.push('')
  lines.push('  HOW IT WORKS (for each pair):')
  lines.push('  1. Calculate path loss between interferer and victim')
  lines.push('  2. Compute interference: I = EIRP - PathLoss + G_victim')
  lines.push('  3. Compare I vs threshold → CONFLICT or CLEAR')
  lines.push('')
  lines.push('  [ASCII: Interference Calculation Diagram]')
  lines.push('')
  lines.push('  Interferer                        Victim')
  lines.push('  [TX]--EIRP--> (FSPL loss) -->[RX]')
  lines.push('   |                             |')
  lines.push('   +-- I = EIRP - PL + G_RX ----+')
  lines.push('   |                             |')
  lines.push('   If I > threshold (-114 dBm): CONFLICT')
  lines.push('   If I < threshold: CLEAR')
  lines.push('')
  
  // FS Link conflicts
  const fsConflicts = red.filter((b: any) => b.reason?.includes('FS conflict'))
  if (fsConflicts.length > 0) {
    lines.push(`  FS Link Conflicts: ${fsConflicts.length} block(s) affected`)
    lines.push('')
    lines.push('  WHY: FS links are high-power microwave connections')
    lines.push('  (EIRP up to 65 dBm). They are VERY sensitive receivers')
    lines.push('  (threshold -114 dBm). If an IMT is nearby, its signal')
    lines.push('  can overwhelm the FS receiver.')
    lines.push('')
    fsConflicts.forEach((b: any) => {
      const m = b.reason.match(/FS conflict:\s*(.+?)\s*\(I=([-\d.]+)\s*dBm\s*>\s*threshold\s*([-\d.]+)\s*dBm/)
      if (m) {
        const exceed = (parseFloat(m[2]) - parseFloat(m[3])).toFixed(1)
        lines.push(`  ${b.freq_low.toFixed(0)}-${b.freq_high.toFixed(0)} MHz: ${m[1].trim()}`)
        lines.push(`    I = ${m[2]} dBm  >  threshold = ${m[3]} dBm  (exceeds by ${exceed} dB)`)
        lines.push(`    --> CONFLICT — this block CANNOT be used`)
      }
    })
  } else {
    lines.push('  FS Link Conflicts: None — all FS links are far enough')
  }

  // IMT co-channel
  const imtConflicts = red.filter((b: any) => b.reason?.includes('IMT co-channel'))
  if (imtConflicts.length > 0) {
    lines.push('')
    lines.push(`  IMT Co-Channel Conflicts: ${imtConflicts.length} block(s)`)
    lines.push('')
    lines.push('  WHY: Two IMTs using the SAME frequency block')
    lines.push('  interfere if they are too close. Co-channel has')
    lines.push('  NO frequency separation — only distance helps.')
    lines.push('')
    imtConflicts.forEach((b: any) => {
      lines.push(`  ${b.freq_low.toFixed(0)}-${b.freq_high.toFixed(0)} MHz: ${b.reason}`)
    })
  }
  lines.push('')

  // Adjacent channel
  const adjPairs = pairResults.filter(pr => pr.direction === 'IMT↔IMT_ADJACENT')
  if (adjPairs.length > 0) {
    lines.push('STEP 6.5: ADJACENT CHANNEL ANALYSIS')
    lines.push('────────────────────────────────────────────────────────')
    lines.push('')
    lines.push('  PURPOSE: Adjacent channels are like neighbors sharing')
    lines.push('  a wall — close but not the same room. ACS (Adjacent')
    lines.push('  Channel Selectivity) provides 33 dB of "soundproofing".')
    lines.push('')
    lines.push('  [ASCII: Adjacent vs Co-Channel Concept]')
    lines.push('')
    lines.push('  Co-channel:           Adjacent channel:')
    lines.push('  [====IMT A====]       [====IMT A====]')
    lines.push('  [====IMT B====]         [====IMT B====]')
    lines.push('      ^                        ^')
    lines.push('  Full interference     ACS 33 dB isolation')
    lines.push('  2000m separation      134m separation')
    lines.push('')
    lines.push(`  Adjacent pairs: ${adjPairs.length} found`)
    adjPairs.forEach((pr, i) => {
      lines.push(`  ${i+1}. ${pr.interferer} -> ${pr.victim}: ${pr.detail}`)
    })
    lines.push('')
  }

  // Guard Band
  const guardBlocks = gray.filter((b: any) => b.reason?.includes('Guard band'))
  if (guardBlocks.length > 0) {
    lines.push('STEP 7: GUARD BAND ANALYSIS')
    lines.push('────────────────────────────────────────────────────────')
    lines.push('')
    lines.push('  PURPOSE: Guard bands are "buffer zones" in frequency.')
    lines.push('  By leaving blocks empty between allocations, we add')
    lines.push('  extra frequency separation = extra electrical isolation.')
    lines.push('')
    lines.push('  [ASCII: Guard Band Isolation Model]')
    lines.push('')
    lines.push('  Guard Width | Isolation  | Required Distance')
    lines.push('  ------------|-----------|-------------------')
    lines.push('  0 MHz (adj) |   33 dB   | ~134 m')
    lines.push('  10 MHz      |   45 dB   | ~ 30 m')
    lines.push('  20 MHz      |   61 dB   | ~  4 m')
    lines.push('  40+ MHz     |   88+ dB  | < 0.1 m (co-locate!)')
    lines.push('')
    lines.push('  KEY INSIGHT: More guard band = LESS physical distance')
    lines.push('  needed. At 40 MHz guard, you can co-locate (same tower).')
    lines.push('')
    guardBlocks.forEach((b: any) => {
      lines.push(`  ${b.freq_low.toFixed(0)}-${b.freq_high.toFixed(0)} MHz: ${b.reason}`)
    })
    lines.push('')
  }

  // ═══════════════════════════════════════════════════════════
  // FINAL STEP: RESULTS — "The Verdict"
  // ═══════════════════════════════════════════════════════════
  lines.push('FINAL STEP: SPECTRUM ALLOCATION RESULTS')
  lines.push('────────────────────────────────────────────────────────')
  lines.push('')
  lines.push('  [ASCII: Frequency Spectrum Bar]')
  let barLine = '  ['
  blocks.forEach((b: any) => {
    barLine += b.status === 'green' ? '#' : b.status === 'red' ? 'X' : '-'
  })
  barLine += ']'
  lines.push(barLine)
  lines.push('   4800    4850    4900    4950    4990 MHz')
  lines.push('   # = Available   X = Blocked   - = Guard Band')
  lines.push('')
  lines.push(`  Total    : ${blocks.length} blocks (190 MHz)`)
  lines.push(`  Available: ${green.length} (${green.length * 10} MHz) = ${((green.length * 10 / 190) * 100).toFixed(1)}% of band`)
  lines.push(`  Blocked  : ${red.length} (${red.length * 10} MHz)`)
  lines.push(`  Guard    : ${gray.length} (${gray.length * 10} MHz)`)
  lines.push('')

  // Aggregate interference
  const blocksWithI = blocks.filter((b: any) => b.i_total_dbm != null && b.i_total_dbm > -200)
  if (blocksWithI.length > 0) {
    lines.push('  Aggregate Interference Note:')
    lines.push('  I_total = 10*log10( sum of all interferers in linear domain )')
    lines.push('  This accounts for MULTIPLE interferers hitting the')
    lines.push('  same receiver simultaneously — more realistic than')
    lines.push('  checking only the worst single pair.')
    const worst = blocksWithI.reduce((a: any, b: any) => (b.i_total_dbm || -200) > (a.i_total_dbm || -200) ? b : a, blocksWithI[0])
    lines.push(`  Worst block: ${worst.freq_low.toFixed(0)}-${worst.freq_high.toFixed(0)} MHz | I_total = ${worst.i_total_dbm?.toFixed(1)} dBm`)
    lines.push('')
  }

  // Trade-off
  if (response.tradeoff) {
    const t = response.tradeoff
    lines.push('  TRADE-OFF SUGGESTION:')
    lines.push(`  ${t.message}`)
    if (t.resolution_type !== 'relocation_required') {
      lines.push(`  EIRP: ${t.original_eirp_dbm} -> ${t.suggested_eirp_dbm} dBm`)
      lines.push(`  Radius: ${t.original_radius_m}m -> ${t.suggested_radius_m}m (${t.radius_reduction_pct > 0 ? '-' : ''}${t.radius_reduction_pct}%)`)
    }
    lines.push('')
  }

  // Verification
  if (backendVerification) {
    lines.push('  VERIFICATION (sanity checks):')
    const allPass = backendVerification.all_pass
    lines.push(`  Status: ${allPass ? 'ALL CHECKS PASSED' : 'SOME CHECKS NEED REVIEW'}`)
    if (!allPass) {
      for (const [k, v] of Object.entries(backendVerification)) {
        if (k === 'all_pass') continue
        const check = v as any
        if (!check.pass) {
          lines.push(`  ! ${k}: ${check.reason || 'failed'}`)
        }
      }
    }
    lines.push('')
  }

  lines.push(`  Response time: ${elapsedMs} ms`)
  lines.push('')
  lines.push('+===========================================================+')
  lines.push('|  END OF TUTORIAL                                         |')
  lines.push('|  Key principle: Spectrum coordination balances            |')
  lines.push('|  PHYSICAL DISTANCE and FREQUENCY SEPARATION              |')
  lines.push('|  Trade one for the other — that is engineering.          |')
  lines.push('+===========================================================+')

  return lines
}



export default function IMTAddWorkspace({ onBack, mode = 'full', onCellRadiusChange, onConfirmLocation }: IMTAddWorkspaceProps) {
  const { fetchWithAuth } = useAuth()

  // Form state
  const [lat, setLat] = useState(13.75)
  const [lon, setLon] = useState(100.50)
  const [cellRadius, setCellRadius] = useState(500)
  const [antennaHeight, setAntennaHeight] = useState(15)
  const [antennaGain, setAntennaGain] = useState(12)
  const [maxEirp, setMaxEirp] = useState(23)
  const [autoEirp, setAutoEirp] = useState(false)
  const [coverageInfo, setCoverageInfo] = useState<CoverageInfo | null>(null)
  const [tradeoff, setTradeoff] = useState<TradeOff | null>(null)
  const [propagationModel, setPropagationModel] = useState('free_space')
  const [name, setName] = useState('')
  const [operator, setOperator] = useState('')

  // Calculation state
  const [loading, setLoading] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const [blocks, setBlocks] = useState<BlockResult[]>([])
  const [pairs, setPairs] = useState<Pair[]>([])
  const [pairResults, setPairResults] = useState<PairResultType[]>([])
  const [analysisSummary, setAnalysisSummary] = useState<AnalyzeSummary | null>(null)
  const [backendVerification, setBackendVerification] = useState<BackendVerification | null>(null)

  // Save state
  const [saving, setSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  // Mini map refs
  const miniMapContainerRef = useRef<HTMLDivElement>(null)
  const miniMapRef = useRef<maplibregl.Map | null>(null)
  const miniMarkerRef = useRef<maplibregl.Marker | null>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  // Init mini map
  useEffect(() => {
    if (!miniMapContainerRef.current) return

    const style = MAP_STYLES.voyager
    const map = new maplibregl.Map({
      container: miniMapContainerRef.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: [style.url],
            tileSize: 256,
            attribution: style.attribution,
          },
        },
        layers: [{ id: 'basemap-mini', type: 'raster', source: 'basemap' }],
      },
      center: [lon, lat],
      zoom: 11,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: false, showZoom: true }), 'top-right')

    miniMapRef.current = map

    // Load FS links and IMT when map is ready
    const loadData = () => {
      loadMiniFSLinks(map, fetchWithAuth)
      loadMiniIMT(map, fetchWithAuth)
    }
    map.once('load', loadData)
    if (map.loaded()) loadData()

    return () => {
      miniMarkerRef.current?.remove()
      miniMarkerRef.current = null
      map.remove()
      miniMapRef.current = null
    }
  }, [])

  // Auto-pan when lat/lon changes
  useEffect(() => {
    if (!miniMapRef.current) return
    const map = miniMapRef.current

    map.flyTo({ center: [lon, lat], zoom: 12, duration: 800 })

    // Update marker
    if (miniMarkerRef.current) miniMarkerRef.current.remove()
    miniMarkerRef.current = new maplibregl.Marker({ color: '#C00000' })
      .setLngLat([lon, lat])
      .addTo(map)

    // Draw cell circle
    drawMiniCellRadius(map, lat, lon, cellRadius)
  }, [lat, lon, cellRadius])

  // Auto-scroll log
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logLines])

  // Notify parent when cellRadius changes
  useEffect(() => {
    onCellRadiusChange?.(cellRadius)
  }, [cellRadius, onCellRadiusChange])

  // ESC key triggers/dismisses close confirmation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showCloseConfirm) {
          setShowCloseConfirm(false)
        } else {
          setShowCloseConfirm(true)
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [showCloseConfirm])

  const handleCalculate = useCallback(async () => {
    const startTime = performance.now()
    setLoading(true)
    setBlocks([])
    setSavedMessage('')
    setSaveError('')
    setCoverageInfo(null)
    setLogLines([
      '═══════════════════════════════════════════════',
      '  Sending analysis request to backend...',
      '═══════════════════════════════════════════════',
    ])
    try {
      const body: Record<string, unknown> = {
        center_lat: lat,
        center_lon: lon,
        cell_radius: cellRadius,
        antenna_height: antennaHeight,
        antenna_gain: antennaGain,
        model: propagationModel,
      }
      if (autoEirp) {
        body.auto_eirp = true
      } else {
        body.max_eirp = maxEirp
      }
      const res = await fetchWithAuth('/api/allocate/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      const elapsedMs = Math.round(performance.now() - startTime)
      setBlocks(data.blocks || [])
      setPairs(data.pairs || [])
      setPairResults(data.pair_results || [])
      setAnalysisSummary(data.summary || null)
      setBackendVerification(data.verification || null)
      if (data.coverage) {
        setCoverageInfo(data.coverage)
      }
      if (data.tradeoff) {
        setTradeoff(data.tradeoff)
      }
      // Use backend-provided EIRP if autoEIRP was used
      const effectiveEirp = data.coverage?.used_eirp_dbm ?? maxEirp
      setLogLines(generateNarrativeLog(
        { lat, lon, cellRadius, antH: antennaHeight, antG: antennaGain, eirp: effectiveEirp, model: propagationModel },
        data,
        elapsedMs,
        data.pairs || [],
        data.pair_results || [],
        data.verification || null,
        data.coverage || null,
        data.assumptions || null,
      ))
    } catch (err) {
      console.error('Analysis failed:', err)
      setLogLines((prev) => [...prev, '', 'ERROR: การวิเคราะห์ล้มเหลว กรุณาลองใหม่'])
      setSaveError('การวิเคราะห์ล้มเหลว กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }, [lat, lon, cellRadius, antennaHeight, antennaGain, maxEirp, autoEirp, propagationModel, fetchWithAuth])

  const handleSave = useCallback(async () => {
    if (!name.trim() || !operator.trim()) {
      setSaveError('กรุณากรอกชื่อสถานีและชื่อผู้ให้บริการ')
      return
    }
    if (blocks.length === 0) {
      setSaveError('กรุณาคำนวณคลื่นความถี่ก่อนบันทึก')
      return
    }

    setSaving(true)
    setSaveError('')
    try {
      const res = await fetchWithAuth('/api/imt/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          center_lat: lat,
          center_lon: lon,
          cell_radius: cellRadius,
          antenna_height: antennaHeight,
          antenna_gain: antennaGain,
          max_eirp: maxEirp,
          name: name.trim(),
          operator: operator.trim(),
          status: 'active',
          // Coverage params (Phase 15)
          ...(coverageInfo ? {
            target_rss: coverageInfo.target_rss_dbm,
            shadow_margin: coverageInfo.shadow_margin_db,
            building_loss: coverageInfo.building_loss_db ?? 0,
            propagation_model: propagationModel,
            coverage_classification: coverageInfo.coverage_classification,
          } : {}),
          blocks: blocks.map((b) => ({
            freq_low: b.freq_low,
            freq_high: b.freq_high,
            status: b.status,
          })),
        }),
      })

      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: 'ไม่สามารถบันทึกได้' }))
        throw new Error(detail.detail || 'ไม่สามารถบันทึกข้อมูล IMT ได้')
      }

      setSavedMessage('บันทึก IMT สำเร็จ')
      // Go back after short delay
      setTimeout(() => onBack(), 1200)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึก')
    } finally {
      setSaving(false)
    }
  }, [name, operator, lat, lon, cellRadius, antennaHeight, antennaGain, maxEirp, blocks, coverageInfo, fetchWithAuth, onBack])

  // Spectrum summary
  const statusCounts = {
    available: blocks.filter((b) => b.status === 'green').length,
    guard: blocks.filter((b) => b.status === 'gray').length,
    blocked: blocks.filter((b) => b.status === 'red').length,
  }
  const totalMhz = statusCounts.available * 10
  const sorted = [...blocks].sort((a, b) => a.freq_low - b.freq_low)
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null)

  const statusColor = (status: string): string => {
    if (status === 'green') return '#16A34A'
    if (status === 'gray') return '#9CA3AF'
    return '#DC2626'
  }

  const isPanel = mode === 'panel'

  return (
    <div className="h-full flex bg-[#F5F5F0]">
      {!isPanel && (
        /* Left 20% — Mini Map (full mode only) */
        <div className="w-[20%] min-w-[240px] flex flex-col border-r border-gray-300 bg-white">
          <div ref={miniMapContainerRef} className="flex-1" />
          <div className="p-2 text-xs text-gray-500 bg-gray-50 border-t border-gray-200 font-mono">
            {lat.toFixed(4)}, {lon.toFixed(4)}
          </div>
        </div>
      )}

      {/* Workspace Content */}
      <div className={`${isPanel ? 'flex-1' : 'flex-1'} overflow-y-auto`}>
        <div className="w-full p-4 space-y-4">
          {/* Header: Back button (full) or Close X (panel) */}
          {isPanel ? (
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#1A1A2E] flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-[#C00000]" />
                เพิ่ม IMT ใหม่
              </h2>
              <button
                onClick={() => setShowCloseConfirm(true)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="ปิด"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-[#C00000] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              กลับ
            </button>
          )}

          {/* SECTION 1: Input Form */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            {/* Location */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-100">
                ตำแหน่ง
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lat}
                    onChange={(e) => setLat(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lon}
                    onChange={(e) => setLon(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
                </div>
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => onConfirmLocation?.(lat, lon, cellRadius)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-[#C00000] text-white border-[#C00000] hover:bg-[#8B0000] transition-colors"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  ตกลง
                </button>
              </div>
            </div>

            {/* Radio params */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-100">
                พารามิเตอร์วิทยุ
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    รัศมีเซลล์ (m)
                  </label>
                  <input
                    type="number"
                    value={cellRadius}
                    onChange={(e) => setCellRadius(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    ความสูงเสาอากาศ (m AGL)
                  </label>
                  <input
                    type="number"
                    value={antennaHeight}
                    onChange={(e) => setAntennaHeight(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Antenna Gain (dBi)
                  </label>
                  <input
                    type="number"
                    value={antennaGain}
                    onChange={(e) => setAntennaGain(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Max EIRP — รวม TX Power + Antenna Gain (dBm)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={autoEirp ? (coverageInfo?.used_eirp_dbm ?? estimateEirp(cellRadius)).toFixed(1) : maxEirp}
                      onChange={(e) => setMaxEirp(Number(e.target.value))}
                      disabled={autoEirp}
                      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none ${
                        autoEirp ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
                      }`}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAutoEirp(!autoEirp)
                        setCoverageInfo(null)
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        autoEirp
                          ? 'bg-[#C00000]/10 text-[#C00000] border border-[#C00000]/30'
                          : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                      }`}
                    >
                      {autoEirp ? (
                        <ToggleRight className="w-4 h-4" />
                      ) : (
                        <ToggleLeft className="w-4 h-4" />
                      )}
                      คำนวณกำลังส่งอัตโนมัติ
                    </button>
                    {autoEirp && (
                      <span className="text-xs text-[#C00000] font-medium flex items-center gap-1">
                        <Radio className="w-3 h-3" />
                        Auto EIRP
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Propagation Model
                </label>
                <select
                  value={propagationModel}
                  onChange={(e) => setPropagationModel(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                >
                  <option value="free_space">Free Space (ITU-R P.525)</option>
                  <option value="p452">ITU-R P.452 (Interference)</option>
                  <option value="p2108">ITU-R P.2108 (Clutter Loss)</option>
                  <option value="p1411">ITU-R P.1411 (Short-Range)</option>
                  <option value="hata">Hata/COST-231</option>
                </select>
                {/* Model description */}
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  {PROPAGATION_MODEL_INFO[propagationModel]?.description}
                </p>
                {/* Model-specific params */}
                {PROPAGATION_MODEL_INFO[propagationModel]?.params?.map((p: any) => (
                  <div key={p.name} className="mt-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      {p.label} {p.unit && `(${p.unit})`}
                    </label>
                    {p.name === 'clutter_type' || p.name === 'environment' ? (
                      <select
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                        defaultValue={p.defaultValue}
                      >
                        <option value="urban">Urban (เมือง)</option>
                        <option value="suburban">Suburban (ชานเมือง)</option>
                        <option value="rural">Rural (ชนบท)</option>
                        <option value="water">Water (พื้นน้ำ)</option>
                      </select>
                    ) : (
                      <input
                        type="number"
                        defaultValue={p.defaultValue}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Station info */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-100">
                ข้อมูลสถานี
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    ชื่อสถานี *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="เช่น BKK-IMT-01"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    ผู้ให้บริการ *
                  </label>
                  <input
                    type="text"
                    value={operator}
                    onChange={(e) => setOperator(e.target.value)}
                    placeholder="เช่น NT, AIS, True"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Analyze button — inside Section 1 */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <button
                onClick={handleCalculate}
                disabled={loading}
                className="w-full bg-[#C00000] hover:bg-[#8B0000] text-white font-semibold py-3 rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
              >
                <Search className="w-4 h-4" />
                {loading ? 'กำลังคำนวณ...' : 'Analyze'}
              </button>
            </div>
          </section>

          {/* ─── DIVIDER 1: between Input+Analyze and Log ─── */}
          {blocks.length > 0 && (
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, #D1D5DB)' }} />
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(to left, transparent, #D1D5DB)' }} />
            </div>
          )}

          {/* SECTION 2: Calculation Running Log — always visible after first calculation */}
          {logLines.length > 0 && (
            <section className="bg-gray-50 rounded-lg border border-gray-200 p-4 animate-fade-in-up">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Detailed Analysis Report</h3>
              <div
                ref={logContainerRef}
                className="max-h-[500px] overflow-y-auto text-xs font-mono text-gray-800 whitespace-pre-wrap leading-snug"
              >
                {logLines.map((line, i) => (
                  <div key={i}>{line || '\u00A0'}</div>
                ))}
              </div>
            </section>
          )}

          {/* SECTION 2.5: Pairs Report — Victim/Interferer Analysis */}
          {(pairs.length > 0 || pairResults.length > 0) && (
            <>
              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, #C00000, #D1D5DB)' }} />
                <span className="text-xs font-medium text-[#C00000] tracking-wider">PAIRS REPORT</span>
                <div className="flex-1 h-px" style={{ background: 'linear-gradient(to left, #C00000, #D1D5DB)' }} />
              </div>

              <section className="bg-white rounded-xl border border-gray-200 p-5 font-serif animate-fade-in-up">
                <h3 className="text-base font-bold text-[#1A1A2E] mb-3 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-[#C00000]" />
                  รายงานคู่รบกวนและผู้ถูกรบกวน (Victim/Interferer Pairs)
                </h3>

                {/* ─── Summary Cards ─── */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="text-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="text-2xl font-bold text-[#1A1A2E]">{pairs.length}</div>
                    <div className="text-xs text-gray-500 mt-1">คู่รบกวนทั้งหมด</div>
                    <div className="text-xs text-gray-400">Total Pairs</div>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded-lg border border-red-200">
                    <div className="text-2xl font-bold text-[#DC2626]">
                      {pairs.filter(p => p.preliminary_risk === 'HIGH').length}
                    </div>
                    <div className="text-xs text-red-700 mt-1 flex items-center justify-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      ความเสี่ยงสูง
                    </div>
                  </div>
                  <div className="text-center p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <div className="text-2xl font-bold text-[#F59E0B]">
                      {pairs.filter(p => p.preliminary_risk === 'MEDIUM').length}
                    </div>
                    <div className="text-xs text-amber-700 mt-1 flex items-center justify-center gap-1">
                      <Shield className="w-3 h-3" />
                      ความเสี่ยงปานกลาง
                    </div>
                  </div>
                </div>

                {/* ─── Per-Pair Cards (Phase 0: Estimated) ─── */}
                {pairs.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
                      Phase 0 — ระบุคู่รบกวน (Preliminary)
                    </h4>
                    <div className="space-y-2">
                      {pairs.map((pair, idx) => {
                        const directionLabel: Record<string, string> = {
                          'IMT→FS': 'IMT → Fixed Service',
                          'FS→IMT': 'Fixed Service → IMT',
                          'IMT↔IMT_COCHANNEL': 'IMT ↔ IMT (ความถี่เดียวกัน)',
                          'IMT↔IMT_ADJACENT': 'IMT ↔ IMT (ความถี่ข้างเคียง)',
                          'IMT↔IMT': 'IMT ↔ IMT',
                        }
                        const riskColor =
                          pair.preliminary_risk === 'HIGH' ? '#DC2626' :
                          pair.preliminary_risk === 'MEDIUM' ? '#F59E0B' : '#16A34A'
                        const riskBg =
                          pair.preliminary_risk === 'HIGH' ? 'bg-red-50 border-red-300' :
                          pair.preliminary_risk === 'MEDIUM' ? 'bg-amber-50 border-amber-300' : 'bg-green-50 border-green-300'

                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg border ${riskBg}`}
                            style={{ borderLeftWidth: '4px', borderLeftColor: riskColor }}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white border border-gray-300 text-gray-700">
                                {directionLabel[pair.direction] || pair.direction}
                              </span>
                              <span
                                className="text-xs font-bold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: riskColor, color: '#fff' }}
                              >
                                {pair.preliminary_risk === 'HIGH' ? 'ความเสี่ยงสูง' :
                                 pair.preliminary_risk === 'MEDIUM' ? 'ความเสี่ยงปานกลาง' : 'ความเสี่ยงต่ำ'}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-sm mb-1">
                              <span className="font-semibold text-[#1A1A2E]">{pair.interferer_name}</span>
                              <span className="text-xs text-gray-400">({pair.interferer_type.replace(/_/g, ' ')})</span>
                              <ArrowRight className="w-4 h-4 text-[#C00000]" />
                              <span className="font-semibold text-[#1A1A2E]">{pair.victim_name}</span>
                              <span className="text-xs text-gray-400">({pair.victim_type.replace(/_/g, ' ')})</span>
                            </div>

                            <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 mt-2 pt-2 border-t border-gray-200">
                              <div>
                                <span className="text-gray-400">ระยะห่าง:</span>{' '}
                                <span className="font-mono font-semibold text-gray-800">{(pair.distance_m).toLocaleString()} m</span>
                              </div>
                              <div>
                                <span className="text-gray-400">I ประมาณ:</span>{' '}
                                <span className="font-mono font-semibold" style={{ color: riskColor }}>
                                  {pair.estimated_i_dbm.toFixed(1)} dBm
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400">ความถี่:</span>{' '}
                                <span className="font-mono font-semibold text-gray-800">
                                  {pair.freq_overlap_low}-{pair.freq_overlap_high} MHz
                                </span>
                              </div>
                              {pair.within_beam !== null && (
                                <div className="col-span-3">
                                  <span className="text-gray-400">ภายในลำคลื่น:</span>{' '}
                                  <span className={pair.within_beam ? 'text-red-600 font-semibold' : 'text-green-600'}>
                                    {pair.within_beam ? 'ใช่' : 'ไม่ใช่'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* ─── Phase 1: Computed Results ─── */}
                {pairResults.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
                      Phase 1 — ผลคำนวณ I[dBm] (Computed)
                    </h4>
                    <div className="space-y-2">
                      {pairResults.map((pr, idx) => {
                        const verdictBg =
                          pr.verdict === 'CONFLICT' ? 'bg-red-600' :
                          pr.verdict === 'GUARD_BAND' ? 'bg-gray-500' : 'bg-green-600'
                        const verdictThai =
                          pr.verdict === 'CONFLICT' ? 'พบการรบกวน' :
                          pr.verdict === 'GUARD_BAND' ? 'ต้องการ Guard Band' : 'ไม่มีการรบกวน'
                        const cardBorder =
                          pr.verdict === 'CONFLICT' ? 'border-red-300 bg-red-50/30' :
                          pr.verdict === 'GUARD_BAND' ? 'border-gray-300 bg-gray-50' : 'border-green-300 bg-green-50/30'

                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg border ${cardBorder}`}
                            style={{
                              borderLeftWidth: '4px',
                              borderLeftColor:
                                pr.verdict === 'CONFLICT' ? '#DC2626' :
                                pr.verdict === 'GUARD_BAND' ? '#6B7280' : '#16A34A',
                            }}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white border border-gray-300 text-gray-700">
                                {pr.direction}
                              </span>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white ${verdictBg}`}>
                                {verdictThai}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-sm mb-1">
                              <span className="font-semibold text-[#1A1A2E]">{pr.interferer}</span>
                              <ArrowRight className="w-4 h-4 text-[#C00000]" />
                              <span className="font-semibold text-[#1A1A2E]">{pr.victim}</span>
                            </div>

                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 mt-2 pt-2 border-t border-gray-200">
                              <div>
                                <span className="text-gray-400">I[dBm]:</span>{' '}
                                <span className={`font-mono font-bold ${
                                  pr.verdict === 'CONFLICT' ? 'text-red-600' :
                                  pr.verdict === 'GUARD_BAND' ? 'text-amber-600' : 'text-green-600'
                                }`}>{pr.i_dbm.toFixed(1)} dBm</span>
                              </div>
                              <div>
                                <span className="text-gray-400">Threshold:</span>{' '}
                                <span className="font-mono font-semibold text-gray-800">{pr.threshold_dbm.toFixed(1)} dBm</span>
                              </div>
                              <div>
                                <span className="text-gray-400">Margin:</span>{' '}
                                <span className={`font-mono font-bold ${
                                  pr.margin_db > 0 && pr.verdict === 'CONFLICT' ? 'text-red-600' : 'text-green-600'
                                }`}>
                                  {pr.margin_db > 0 ? '+' : ''}{pr.margin_db.toFixed(1)} dB
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400">Path Loss:</span>{' '}
                                <span className="font-mono font-semibold text-gray-800">{pr.path_loss_db.toFixed(1)} dB</span>
                              </div>
                              <div>
                                <span className="text-gray-400">ระยะ:</span>{' '}
                                <span className="font-mono font-semibold text-gray-800">{pr.effective_distance_m.toLocaleString()} m</span>
                              </div>
                              <div>
                                <span className="text-gray-400">ผล:</span>{' '}
                                <span className={`font-semibold ${
                                  pr.verdict === 'CONFLICT' ? 'text-red-600' :
                                  pr.verdict === 'GUARD_BAND' ? 'text-gray-600' : 'text-green-600'
                                }`}>{verdictThai}</span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          {/* ─── DIVIDER 2: between Log and Calculation Details ─── */}
          {blocks.length > 0 && (
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, #D1D5DB)' }} />
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(to left, transparent, #D1D5DB)' }} />
            </div>
          )}

          {/* SECTION 3: Calculation Report */}
          {blocks.length > 0 && (() => {
            const availableMhz = statusCounts.available * 10
            const totalMhz = blocks.length * 10
            const pct = totalMhz > 0 ? ((availableMhz / totalMhz) * 100).toFixed(1) : '0.0'
            const modelLabel = PROPAGATION_MODEL_INFO[propagationModel]?.label || propagationModel
            const modelDesc = PROPAGATION_MODEL_INFO[propagationModel]?.description || ''
            const guardMhz = statusCounts.guard * 10

            return (
              <section className="bg-white rounded-xl border border-gray-200 p-5 font-serif animate-fade-in-up">
                <h3 className="text-base font-bold text-gray-900 mb-3">Calculation Report</h3>

                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Parameters</h4>
                  <div className="space-y-1 text-sm text-gray-800">
                    <div>position     = ({lat.toFixed(4)}, {lon.toFixed(4)})</div>
                    <div>cell_radius  = {cellRadius.toLocaleString()} m</div>
                    <div>ant_height   = {antennaHeight} m AGL</div>
                    <div>ant_gain     = {antennaGain} dBi</div>
                    <div>max_eirp     = {coverageInfo?.used_eirp_dbm ? `${coverageInfo.used_eirp_dbm.toFixed(1)} dBm (auto)` : `${maxEirp} dBm`}</div>
                    <div>name         = {name || '-'}</div>
                    <div>operator     = {operator || '-'}</div>
                  </div>
                </div>

                <hr className="my-3 border-gray-200" />

                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Model: {modelLabel}</h4>
                  <div className="space-y-1 text-sm text-gray-800">
                    <div className="italic text-gray-600"># FSPL(dB) = 32.4 + 20\u00b7log10(d) + 20\u00b7log10(f)</div>
                    <div className="italic text-gray-600"># {modelDesc}</div>
                  </div>
                </div>

                <hr className="my-3 border-gray-200" />

                {/* Coverage Engine Card (Phase 15) */}
                {coverageInfo && (
                  <>
                    <div className="mb-4">
                      <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
                        Coverage Engine
                      </h4>
                      <div
                        className="p-3 rounded-lg border"
                        style={{
                          borderLeftWidth: '4px',
                          borderLeftColor: coverageStatusColor(coverageInfo.coverage_classification),
                          backgroundColor:
                            coverageInfo.coverage_classification === 'OUTDOOR_GOOD' || coverageInfo.coverage_classification === 'OUTDOOR_BASIC'
                              ? '#F0FDF4'
                              : coverageInfo.coverage_classification === 'MARGINAL'
                              ? '#FFFBEB'
                              : '#FEF2F2',
                          borderColor:
                            coverageInfo.coverage_classification === 'OUTDOOR_GOOD' || coverageInfo.coverage_classification === 'OUTDOOR_BASIC'
                              ? '#BBF7D0'
                              : coverageInfo.coverage_classification === 'MARGINAL'
                              ? '#FDE68A'
                              : '#FECACA',
                        }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Signal className="w-4 h-4" style={{ color: coverageStatusColor(coverageInfo.coverage_classification) }} />
                          <span className="text-sm font-semibold text-[#1A1A2E]">
                            การคำนวณกำลังส่งอัตโนมัติ (Auto EIRP)
                          </span>
                          <span
                            className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: coverageStatusColor(coverageInfo.coverage_classification) }}
                          >
                            {coverageClassificationThai(coverageInfo.coverage_classification)}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                          <div>
                            <span className="text-gray-400">EIRP ที่ใช้:</span>{' '}
                            <span className="font-mono font-bold text-gray-800">
                              {coverageInfo.used_eirp_dbm.toFixed(1)} dBm
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-400">EIRP ที่ต้องการ:</span>{' '}
                            <span className="font-mono font-bold text-gray-800">
                              {coverageInfo.required_eirp_dbm.toFixed(1)} dBm
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-400">RSS ขอบเซลล์:</span>{' '}
                            <span className="font-mono font-bold text-gray-800">
                              {coverageInfo.cell_edge_rss_dbm.toFixed(1)} dBm
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-400">Target RSS:</span>{' '}
                            <span className="font-mono text-gray-800">
                              {coverageInfo.target_rss_dbm} dBm
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-400">Shadow Margin:</span>{' '}
                            <span className="font-mono text-gray-800">
                              {coverageInfo.shadow_margin_db} dB
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-400">สถานะ:</span>{' '}
                            <span className="font-semibold" style={{ color: coverageStatusColor(coverageInfo.coverage_classification) }}>
                              {coverageClassificationThai(coverageInfo.coverage_classification)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <hr className="my-3 border-gray-200" />

                    {/* ─── Trade-off Suggestion ─── */}
                    {tradeoff && (
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">ข้อเสนอแนะ (Trade-off)</h4>
                        <div className={`p-3 rounded-lg border-l-4 ${
                          tradeoff.resolution_type === 'relocation_required'
                            ? 'bg-red-50 border-red-500'
                            : tradeoff.resolution_type === 'partial'
                            ? 'bg-amber-50 border-amber-500'
                            : 'bg-blue-50 border-blue-500'
                        }`}>
                          <div className="flex items-start gap-2 mb-2">
                            <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                              tradeoff.resolution_type === 'relocation_required' ? 'text-red-600' :
                              tradeoff.resolution_type === 'partial' ? 'text-amber-600' : 'text-blue-600'
                            }`} />
                            <p className="text-sm text-gray-800">{tradeoff.message}</p>
                          </div>
                          {tradeoff.resolution_type !== 'relocation_required' && (
                            <div className="grid grid-cols-2 gap-2 text-xs mt-2 pt-2 border-t border-gray-200">
                              <div>
                                <span className="text-gray-400">EIRP เดิม:</span>{' '}
                                <span className="font-mono font-semibold">{tradeoff.original_eirp_dbm} dBm</span>
                              </div>
                              <div>
                                <span className="text-gray-400">EIRP แนะนำ:</span>{' '}
                                <span className="font-mono font-semibold text-blue-700">{tradeoff.suggested_eirp_dbm} dBm</span>
                              </div>
                              <div>
                                <span className="text-gray-400">รัศมีเดิม:</span>{' '}
                                <span className="font-mono">{tradeoff.original_radius_m}m</span>
                              </div>
                              <div>
                                <span className="text-gray-400">รัศมีที่ทำได้:</span>{' '}
                                <span className="font-mono font-semibold text-blue-700">{tradeoff.suggested_radius_m}m ({tradeoff.radius_reduction_pct > 0 ? '−' : ''}{tradeoff.radius_reduction_pct}%)</span>
                              </div>
                            </div>
                          )}
                          {tradeoff.conflicting_systems.length > 0 && (
                            <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-200">
                              ระบบที่ขัดแย้ง: {tradeoff.conflicting_systems.join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Guard Band Analysis</h4>
                  <div className="text-sm text-gray-800">
                    <p>Guard bands (10 MHz) separate adjacent frequency blocks between different IMT networks to prevent adjacent-channel interference.</p>
                    <p className="mt-1">When two IMT stations operate in close proximity (&lt; 1.5 km), adjacent blocks require guard bands regardless of operator.</p>
                    {statusCounts.guard === 0 ? (
                      <p className="text-green-700 mt-1">No guard bands required — sufficient frequency separation exists between all neighboring IMT networks.</p>
                    ) : (
                      <p className="text-amber-700 mt-1">Guard bands required: {statusCounts.guard} blocks ({guardMhz} MHz) — blocks adjacent to conflicting IMT networks.</p>
                    )}
                  </div>
                </div>

                <hr className="my-3 border-gray-200" />

                <div>
                  <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Results</h4>
                  <div className="space-y-1 text-sm text-gray-800">
                    <div>total_blocks   = {blocks.length} (4800-4990 MHz)</div>
                    <div>available      = {statusCounts.available} ({availableMhz} MHz)</div>
                    <div>blocked        = {statusCounts.blocked} ({(statusCounts.blocked * 10)} MHz)</div>
                    <div>guard_bands    = {statusCounts.guard}</div>
                  </div>
                  <div className="mt-3 py-2 px-3 bg-gray-50 rounded text-sm font-mono text-gray-900">
                    SUMMARY: {availableMhz}/{totalMhz} MHz available ({pct}%)
                  </div>

                  {/* ─── Verification ─── */}
                  {(() => {
                    // Use backend verification if available, fall back to frontend
                    if (backendVerification) {
                      const bv = backendVerification
                      const checks = [
                        { label: 'Block Count', key: 'block_count', val: bv.block_count },
                        { label: 'Frequency Continuity', key: 'frequency_continuity', val: bv.frequency_continuity },
                        { label: 'Guard Adjacency', key: 'guard_adjacency', val: bv.guard_adjacency },
                        { label: 'Total MHz', key: 'total_mhz', val: bv.total_mhz },
                        { label: 'Guard Reasons', key: 'guard_reasons', val: bv.guard_reasons },
                      ]
                      return (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Verification</h4>
                          <div className="space-y-1.5">
                            {checks.map(({ label, key, val }) => (
                              <div key={key} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded border ${
                                val.pass ? 'bg-green-50 border-green-200 text-green-700' :
                                'bg-red-50 border-red-200 text-red-700'
                              }`}>
                                {val.pass ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                                <span className="font-medium">{label}</span>
                                <span className="text-gray-500">
                                  {(val as any).reason || (
                                    key === 'block_count' || key === 'total_mhz'
                                      ? `(expected ${(val as any).expected}, actual ${(val as any).actual})`
                                      : key === 'guard_adjacency'
                                        ? `(warnings: ${(val as any).warnings})`
                                        : key === 'guard_reasons'
                                          ? `(invalid: ${(val as any).invalid_count})`
                                          : ''
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className={`mt-2 text-xs font-semibold px-3 py-1.5 rounded ${
                            bv.all_pass
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {bv.all_pass ? 'All 10 verification checks passed' : 'Some verification checks need review'}
                          </div>
                        </div>
                      )
                    }
                    // Fallback: frontend verifyResults
                    const vr = verifyResults(blocks)
                    return (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Verification</h4>
                        {vr.passed && vr.warnings.length === 0 ? (
                          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                            <CheckCircle className="w-4 h-4" />
                            Verification: All checks passed
                          </div>
                        ) : vr.errors.length > 0 ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                              <XCircle className="w-4 h-4" />
                              Verification failed: {vr.errors.length} error{vr.errors.length > 1 ? 's' : ''}
                            </div>
                            {vr.errors.map((e, i) => (
                              <div key={i} className="text-xs text-red-700 bg-red-50/60 border border-red-100 rounded px-3 py-1.5">{e}</div>
                            ))}
                          </div>
                        ) : vr.errors.length === 0 && vr.warnings.length > 0 ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                              <Shield className="w-4 h-4" />
                              Warnings: {vr.warnings.length} issue{vr.warnings.length > 1 ? 's' : ''} (non-critical)
                            </div>
                            {vr.warnings.map((w, i) => (
                              <div key={i} className="text-xs text-amber-700 bg-amber-50/60 border border-amber-100 rounded px-3 py-1.5">{w}</div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })()}
                </div>
              </section>
            )
          })()}

          {/* ─── DIVIDER 3: between Calc Details and Spectrum Results ─── */}
          {blocks.length > 0 && (
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, #D1D5DB)' }} />
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(to left, transparent, #D1D5DB)' }} />
            </div>
          )}

          {/* SECTION 4: Spectrum Analysis Results */}
          {blocks.length > 0 && (
            <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in-up">
              <h2 className="text-base font-bold text-[#1A365D] mb-3">
                ผลการวิเคราะห์คลื่นความถี่
              </h2>

              {/* Summary */}
              <div className="flex gap-2 mb-3 text-sm">
                <div className="flex-1 text-center p-2 bg-green-50 rounded border border-green-100">
                  <div className="font-bold text-[#16A34A]">{statusCounts.available}</div>
                  <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
                    <CheckCircle className="w-3 h-3" /> ว่าง
                  </div>
                </div>
                <div className="flex-1 text-center p-2 bg-gray-50 rounded border border-gray-100">
                  <div className="font-bold text-gray-500">{statusCounts.guard}</div>
                  <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
                    <Shield className="w-3 h-3" /> Guard
                  </div>
                </div>
                <div className="flex-1 text-center p-2 bg-red-50 rounded border border-red-100">
                  <div className="font-bold text-[#DC2626]">{statusCounts.blocked}</div>
                  <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
                    <XCircle className="w-3 h-3" /> ถูกจอง
                  </div>
                </div>
              </div>

              <div className="text-xs text-gray-400 mb-3">
                {totalMhz} MHz ว่าง จากทั้งหมด 190 MHz
              </div>

              {/* Spectrum bar */}
              <div className="mb-1 flex h-8 rounded overflow-hidden border border-gray-300">
                {sorted.map((b, i) => (
                  <div
                    key={i}
                    title={`${b.freq_low.toFixed(0)}-${b.freq_high.toFixed(0)} MHz: ${b.reason}`}
                    className="flex-1 cursor-pointer hover:brightness-110 relative"
                    style={{
                      backgroundColor: statusColor(b.status),
                      minWidth: `${Math.max(100 / sorted.length, 1)}%`,
                      border: '1px solid #000',
                    }}
                    onClick={() => setSelectedBlockIndex(selectedBlockIndex === i ? null : i)}
                  />
                ))}
              </div>

              {/* X-axis labels — one per 20MHz, aligned to block boundaries */}
              <div className="flex mb-4">
                {sorted.map((b, i) => (
                  <div key={i} className="flex-1" style={{ minWidth: `${Math.max(100 / sorted.length, 1)}%`, position: 'relative' }}>
                    {b.freq_low % 20 === 0 && (
                      <span className="absolute -left-2 top-0 text-xs text-gray-400 font-mono">
                        {b.freq_low}
                      </span>
                    )}
                    {i === sorted.length - 1 && (
                      <span className="absolute -right-1 top-0 text-xs text-gray-400 font-mono">
                        {b.freq_high}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Selected block detail — ENHANCED */}
              {selectedBlockIndex !== null && sorted[selectedBlockIndex] && (
                (() => {
                  const block = sorted[selectedBlockIndex]
                  const parsed = parseReason(block.reason)
                  return (
                    <div
                      className={`mb-3 p-3 rounded border shadow-sm ${
                        block.status === 'green'
                          ? 'bg-green-50 border-green-200'
                          : block.status === 'red'
                          ? 'bg-red-50 border-red-200'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                      style={{
                        borderLeftWidth: '4px',
                        borderLeftColor:
                          block.status === 'green' ? '#16A34A' :
                          block.status === 'red' ? '#DC2626' : '#9CA3AF',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-mono font-bold text-[#1A1A2E]">
                          {block.freq_low.toFixed(0)}-{block.freq_high.toFixed(0)} MHz
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          block.status === 'green' ? 'bg-green-100 text-green-700' :
                          block.status === 'gray' ? 'bg-gray-100 text-gray-600' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {block.status === 'green' ? 'ว่าง' :
                           block.status === 'gray' ? 'Guard Band' : 'ถูกจอง'}
                        </span>
                      </div>

                      {block.status === 'green' && (
                        <div className="text-xs text-green-700 space-y-1">
                          <div className="flex items-center gap-1 font-medium">
                            <CheckCircle className="w-3.5 h-3.5" />
                            สามารถจัดสรรได้
                          </div>
                        </div>
                      )}

                      {block.status === 'red' && parsed.conflictType === 'FS' && (
                        <div className="text-xs space-y-1.5">
                          <div className="flex items-center gap-1 font-medium text-red-700">
                            <XCircle className="w-3.5 h-3.5" />
                            ไม่สามารถจัดสรรได้
                          </div>
                          <div className="text-red-700 pl-5">
                            สาเหตุ: ทับซ้อนกับ Fixed Service Link
                          </div>
                          <div className="text-red-700 pl-5 space-y-0.5">
                            <div className="font-medium">รายละเอียดสัญญาณรบกวน:</div>
                            <div>&nbsp;&nbsp;&nbsp;• ชื่อ FS Link: {parsed.linkName}</div>
                            <div>&nbsp;&nbsp;&nbsp;• กำลังสัญญาณรบกวน (I): {parsed.iValue} dBm</div>
                            <div>&nbsp;&nbsp;&nbsp;• Threshold ที่ยอมรับได้: {parsed.threshold} dBm</div>
                            <div>&nbsp;&nbsp;&nbsp;• เกิน Threshold: {parsed.exceedDb} dB</div>
                          </div>
                          <div className="text-xs text-red-600 bg-red-100/50 rounded p-2 mt-1 leading-relaxed">
                            คำอธิบาย: FS Link {parsed.linkName} ส่งสัญญาณในช่วงความถี่ที่ทับซ้อน
                            กับบล็อก {block.freq_low.toFixed(0)}-{block.freq_high.toFixed(0)} MHz กำลังสัญญาณรบกวนที่คำนวณได้
                            ({parsed.iValue} dBm) สูงกว่า threshold การป้องกัน ({parsed.threshold} dBm)
                            อยู่ {parsed.exceedDb} dB จึงไม่สามารถจัดสรรคลื่นความถี่บล็อกนี้ให้กับ IMT ได้
                          </div>
                        </div>
                      )}

                      {block.status === 'red' && parsed.conflictType === 'IMT_COCHANNEL' && (
                        <div className="text-xs space-y-1.5">
                          <div className="flex items-center gap-1 font-medium text-red-700">
                            <XCircle className="w-3.5 h-3.5" />
                            ไม่สามารถจัดสรรได้
                          </div>
                          <div className="text-red-700 pl-5">
                            สาเหตุ: ทับซ้อนกับ IMT เครือข่ายอื่น (Co-Channel)
                          </div>
                          <div className="text-red-700 pl-5 space-y-0.5">
                            <div className="font-medium">รายละเอียด:</div>
                            <div>&nbsp;&nbsp;&nbsp;• ชื่อ IMT: {parsed.linkName}</div>
                            <div>&nbsp;&nbsp;&nbsp;• ระยะห่างจริง: {parsed.imtDistance} km</div>
                            <div>&nbsp;&nbsp;&nbsp;• ระยะห่างขั้นต่ำที่ต้องการ: {parsed.neededSeparation} km</div>
                          </div>
                          <div className="text-xs text-red-600 bg-red-100/50 rounded p-2 mt-1 leading-relaxed">
                            IMT "{parsed.linkName}" ใช้ความถี่เดียวกันกับบล็อก {block.freq_low.toFixed(0)}-{block.freq_high.toFixed(0)} MHz
                            และอยู่ห่างเพียง {parsed.imtDistance} km ซึ่งน้อยกว่าระยะห่างขั้นต่ำ {parsed.neededSeparation} km
                            ที่ต้องการสำหรับ Co-Channel protection จึงไม่สามารถใช้บล็อกนี้ได้
                          </div>
                        </div>
                      )}

                      {block.status === 'gray' && parsed.conflictType === 'GUARD' && parsed.linkName && (
                        <div className="text-xs space-y-1.5">
                          <div className="flex items-center gap-1 font-medium text-gray-700">
                            <Shield className="w-3.5 h-3.5" />
                            Guard Band
                          </div>
                          <div className="text-gray-600 pl-5 space-y-0.5">
                            <div>&nbsp;&nbsp;&nbsp;• ช่องว่างป้องกันระหว่าง IMT: {parsed.linkName}</div>
                            <div>&nbsp;&nbsp;&nbsp;• ระยะห่างจริง: {parsed.imtDistance} km</div>
                            <div>&nbsp;&nbsp;&nbsp;• ระยะขั้นต่ำ: {parsed.neededSeparation} km</div>
                          </div>
                          <div className="text-xs text-gray-600 bg-gray-100 rounded p-2 mt-1 leading-relaxed">
                            บล็อก {block.freq_low.toFixed(0)}-{block.freq_high.toFixed(0)} MHz อยู่ติดกับความถี่ของ IMT "{parsed.linkName}"
                            (Adjacent Channel) ระยะห่าง {parsed.imtDistance} km ต่ำกว่าระยะขั้นต่ำ {parsed.neededSeparation} km
                            จึงต้องเว้นเป็น Guard Band เพื่อป้องกันสัญญาณรบกวนระหว่างช่องความถี่
                          </div>
                        </div>
                      )}

                      {block.status === 'gray' && (!parsed.linkName) && (
                        <div className="text-xs text-gray-600">
                          <div className="flex items-center gap-1 font-medium">
                            <Shield className="w-3.5 h-3.5" />
                            Guard Band — {block.reason}
                          </div>
                        </div>
                      )}

                      {block.status === 'red' && parsed.conflictType !== 'FS' && (
                        <div className="text-xs text-red-700">
                          <div className="flex items-center gap-1 font-medium">
                            <XCircle className="w-3.5 h-3.5" />
                            ไม่สามารถจัดสรรได้ — {block.reason}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()
              )}

              {/* Legend */}
              <div className="flex gap-3 text-xs text-gray-500 mb-2">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: '#16A34A' }} />
                  ว่าง
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: '#9CA3AF' }} />
                  Guard Band
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: '#DC2626' }} />
                  ถูกจอง
                </div>
              </div>

              {/* Conflicts detail — ENHANCED */}
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {blocks
                  .filter((b) => b.status !== 'green')
                  .map((b, i) => {
                    const parsed = parseReason(b.reason)
                    return (
                      <div
                        key={i}
                        className={`text-xs p-3 rounded border ${
                          b.status === 'red' ? 'bg-red-50/50 border-red-200' : 'bg-gray-50 border-gray-200'
                        }`}
                        style={{
                          borderLeftWidth: '3px',
                          borderLeftColor: b.status === 'red' ? '#DC2626' : '#9CA3AF',
                        }}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="font-mono font-bold text-[#1A1A2E]">
                            {b.freq_low.toFixed(0)}-{b.freq_high.toFixed(0)} MHz
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            b.status === 'red' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {b.status === 'red' ? 'ไม่สามารถจัดสรร' : 'Guard Band'}
                          </span>
                        </div>

                        {parsed.conflictType === 'FS' && (
                          <div className="text-gray-600 space-y-0.5 pl-1">
                            <div className="text-red-600">ทับซ้อนกับ FS Link: <span className="font-medium">{parsed.linkName}</span></div>
                            <div className="text-red-600">I={parsed.iValue} dBm {'>'} threshold {parsed.threshold} dBm (เกิน {parsed.exceedDb} dB)</div>
                          </div>
                        )}

                        {parsed.conflictType !== 'FS' && (
                          <div className="text-gray-500">{b.reason}</div>
                        )}
                      </div>
                    )
                  })}
              </div>

              {/* Save button — inside Section 4 at bottom */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-semibold py-3 rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'กำลังบันทึก...' : 'บันทึก IMT'}
                </button>

                {savedMessage && (
                  <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                    {savedMessage}
                  </div>
                )}

                {saveError && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    {saveError}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Close confirmation dialog */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCloseConfirm(false)}>
          <div
            className="bg-white rounded-xl shadow-2xl p-6 w-[360px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-[#1A1A2E] mb-2">ยกเลิกการทำงาน</h3>
            <p className="text-sm text-gray-600 mb-6">แน่ใจใช่ไหม? ข้อมูลที่ใส่ไว้ทั้งหมดจะสูญหาย</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={onBack}
                className="px-4 py-2 text-sm font-medium text-white bg-[#C00000] hover:bg-[#8B0000] rounded-lg transition-colors"
              >
                ยืนยัน
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Mini Map helper functions ─────────────────────────────────────────────

function drawMiniCellRadius(map: maplibregl.Map, lat: number, lon: number, radiusM: number) {
  const sid = LAYER_IDS.miniCellSource
  const fid = LAYER_IDS.miniCellFill

  if (map.getLayer(fid)) map.removeLayer(fid)
  if (map.getSource(sid)) map.removeSource(sid)

  // Use turf circle for real-world distance
  try {
    const circlePoly = circle([lon, lat], radiusM / 1000, {
      steps: 64,
      units: 'kilometers',
    })

    map.addSource(sid, {
      type: 'geojson',
      data: circlePoly,
    })

    map.addLayer({
      id: fid,
      type: 'fill',
      source: sid,
      paint: {
        'fill-color': '#C00000',
        'fill-opacity': 0.15,
      },
    })

    // Add outline
    const outlineId = fid + '-outline'
    if (map.getLayer(outlineId)) map.removeLayer(outlineId)
    map.addLayer({
      id: outlineId,
      type: 'line',
      source: sid,
      paint: {
        'line-color': '#C00000',
        'line-width': 2,
        'line-opacity': 0.6,
      },
    })
  } catch (e) {
    console.warn('Failed to draw mini cell radius:', e)
  }
}

async function loadMiniFSLinks(map: maplibregl.Map, fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>) {
  try {
    const res = await fetchWithAuth('/api/fs-links/')
    if (!res.ok) return
    const data = await res.json()
    const links = data.links || data || []

    const features = links.map((link: any) => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [link.tx?.lon ?? link.tx_lon, link.tx?.lat ?? link.tx_lat],
          [link.rx?.lon ?? link.rx_lon, link.rx?.lat ?? link.rx_lat],
        ],
      },
      properties: {
        name: link.name,
        operator: link.operator,
      },
    }))

    const sid = LAYER_IDS.miniFSSource
    const lid = LAYER_IDS.miniFSLine
    if (map.getLayer(lid)) map.removeLayer(lid)
    if (map.getSource(sid)) map.removeSource(sid)

    map.addSource(sid, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    })

    map.addLayer({
      id: lid,
      type: 'line',
      source: sid,
      paint: {
        'line-color': '#1A365D',
        'line-width': 1.5,
        'line-dasharray': [4, 2],
        'line-opacity': 0.6,
      },
    })
  } catch (err) {
    console.warn('Mini FS links not available:', err)
  }
}

async function loadMiniIMT(map: maplibregl.Map, fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>) {
  try {
    const res = await fetchWithAuth('/api/imt/')
    if (!res.ok) return
    const data = await res.json()
    const allocations = data.allocations || data || []

    const features: any[] = []
    allocations.forEach((alloc: any) => {
      try {
        const coveragePoly = circle(
          [alloc.center_lon, alloc.center_lat],
          alloc.cell_radius / 1000,
          { steps: 64, units: 'kilometers' },
        )
        coveragePoly.properties = { name: alloc.name, operator: alloc.operator }
        features.push(coveragePoly)
      } catch {}
    })

    const sid = LAYER_IDS.miniIMTSource
    const fid = LAYER_IDS.miniIMTFill
    const oid = LAYER_IDS.miniIMTOutline

    if (map.getLayer(fid)) map.removeLayer(fid)
    if (map.getLayer(oid)) map.removeLayer(oid)
    if (map.getSource(sid)) map.removeSource(sid)

    if (features.length === 0) return

    map.addSource(sid, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    })

    map.addLayer({
      id: fid,
      type: 'fill',
      source: sid,
      paint: {
        'fill-color': '#16A34A',
        'fill-opacity': 0.12,
      },
    })

    map.addLayer({
      id: oid,
      type: 'line',
      source: sid,
      paint: {
        'line-color': '#16A34A',
        'line-width': 1,
        'line-opacity': 0.5,
      },
    })
  } catch (err) {
    console.warn('Mini IMT not available:', err)
  }
}
