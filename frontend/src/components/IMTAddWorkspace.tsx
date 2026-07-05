import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import { circle } from '@turf/turf'
import { Search, Save, ArrowLeft, PlusCircle, CheckCircle, Shield, XCircle, MapPin, AlertTriangle, Zap, ArrowRight, ToggleLeft, ToggleRight, Radio, Signal, ChevronUp, ChevronDown, ChevronRight, Eye, Upload, Calculator, Octagon } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { MAP_STYLES } from './MapView'
import type { BlockResult, BlockEirpLimit, Pair, PairResult as PairResultType, AnalyzeSummary, BackendVerification, CoverageInfo, TradeOff, AssumptionItem } from '../types'
import type { HighlightStation } from './MapView'
import { useSyncAnimation } from '../hooks/useSyncAnimation'
import { MiniMap, getCoverageColorForModel } from './MiniMap'
import { Button } from './Button'

interface IMTAddWorkspaceProps {
  onBack: () => void
  mode?: 'full' | 'panel'
  onCellRadiusChange?: (r: number) => void
  onConfirmLocation?: (lat: number, lon: number, cellRadius: number) => void
  onShowStations?: (stations: HighlightStation[]) => void
  onPlotPolygon?: (vertices: [number, number][]) => void
  onCentroidUpdate?: (c: {lat: number, lon: number} | null) => void
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

// ─── Aggregate Row Component (collapsible) ──────────────────────────────

function AggregateRow({ row, thresholdDbm, marginDb, trendIsWorse, buildFormula }: {
  row: { label: string; iTotal: number | undefined; interferers: PairResultType[]; uniqueNames: string[]; worst: PairResultType | null; conflict: boolean }
  thresholdDbm: number
  marginDb: number | undefined
  trendIsWorse: boolean
  buildFormula: (interferers: PairResultType[], iTotal: number) => string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <tr
        className={`cursor-pointer ${row.conflict ? 'bg-red-50/30' : 'bg-green-50/30'} hover:bg-gray-50`}
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-2 text-gray-400">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </td>
        <td className="py-2 pr-3 font-medium text-[#1A1A2E]">{row.label}</td>
        <td className="py-2 pr-3 font-mono text-gray-700">{row.iTotal?.toFixed(1) ?? '—'}</td>
        <td className="py-2 pr-3 font-mono">
          <span className={marginDb != null ? (marginDb > 0 ? 'text-red-600' : 'text-green-600') : 'text-gray-400'}>
            {marginDb != null ? (marginDb > 0 ? '+' : '') + marginDb.toFixed(1) : '—'}
          </span>
        </td>
        <td className="py-2 pr-3 font-mono text-gray-600">{row.uniqueNames.length}</td>
        <td className="py-2 pr-3 font-medium text-gray-700">
          {row.worst
            ? `${row.worst.interferer.replace(/\(.*\)$/, '').trim()} → ${row.worst.victim.replace(/\(.*\)$/, '').trim()}`
            : '—'}
        </td>
        <td className="py-2 pr-3">
          {trendIsWorse ? (
            <span className="text-red-600 font-bold flex items-center gap-0.5">
              <ChevronUp className="w-3.5 h-3.5" /> แย่ลง
            </span>
          ) : (
            <span className="text-green-600 font-bold flex items-center gap-0.5">
              <ChevronDown className="w-3.5 h-3.5" /> ดีขึ้น
            </span>
          )}
        </td>
        <td className="py-2">
          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            row.conflict ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}>
            {row.conflict ? 'CONFLICT' : 'CLEAR'}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="mx-4 my-2 p-3 bg-gray-50 rounded border border-gray-200 space-y-2">
              {/* I_total formula */}
              {row.iTotal != null && (
                <div className="text-xs">
                  <span className="font-semibold text-gray-700">สูตร I_total:</span>{' '}
                  <span className="font-mono text-gray-600">{buildFormula(row.interferers, row.iTotal)}</span>
                </div>
              )}
              {/* Margin vs threshold */}
              {marginDb != null && (
                <div className="text-xs">
                  <span className="font-semibold text-gray-700">Margin vs Threshold:</span>{' '}
                  <span className={`font-mono ${marginDb > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    I_total ({row.iTotal?.toFixed(1)} dBm) − threshold ({thresholdDbm} dBm) = {marginDb > 0 ? '+' : ''}{marginDb.toFixed(1)} dB
                  </span>
                  <span className="text-gray-400 ml-1">
                    ({marginDb > 0 ? 'เกิน threshold' : 'ต่ำกว่า threshold'})
                  </span>
                </div>
              )}
              {/* List all interferers */}
              {row.interferers.length > 0 && (
                <div className="text-xs">
                  <div className="font-semibold text-gray-700 mb-1">Interferers ทั้งหมด ({row.interferers.length}):</div>
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-500">
                        <th className="py-1 pr-2 font-medium">Interferer</th>
                        <th className="py-1 pr-2 font-medium">I (dBm)</th>
                        <th className="py-1 pr-2 font-medium">ระยะทาง</th>
                        <th className="py-1 font-medium">ประเภท</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {row.interferers.map((pr, idx) => {
                        const typeLabel: Record<string, string> = {
                          'IMT→FS': 'IMT → FS',
                          'IMT→FS_ADJACENT': 'IMT → FS (adj)',
                          'FS→IMT': 'FS → IMT',
                          'FS→IMT_ADJACENT': 'FS → IMT (adj)',
                          'IMT↔IMT_COCHANNEL': 'IMT ↔ IMT (co)',
                          'IMT↔IMT_ADJACENT': 'IMT ↔ IMT (adj)',
                        }
                        return (
                          <tr key={idx} className="text-gray-700">
                            <td className="py-1 pr-2">{pr.interferer.replace(/\(.*\)$/, '').trim()} → {pr.victim.replace(/\(.*\)$/, '').trim()}</td>
                            <td className="py-1 pr-2 font-mono">{pr.i_dbm.toFixed(1)}</td>
                            <td className="py-1 pr-2 font-mono">{(pr.effective_distance_m / 1000).toFixed(1)} km</td>
                            <td className="py-1 text-gray-500">{typeLabel[pr.direction] || pr.direction}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
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
function estimateEirp(cellRadiusM: number, model: string = 'free_space'): number {
  // Use the actual selected propagation model for consistent EIRP calculation
  const dKm = cellRadiusM / 1000
  if (dKm <= 0) return 0

  // For each model, approximate path loss at cell edge
  let pl: number
  switch (model) {
    case 'free_space':
      pl = 32.4 + 20 * Math.log10(dKm) + 20 * Math.log10(4900)
      break
    case 'hata':
      // COST-231 Hata for urban: 46.3 + 33.9*log10(f) - 13.82*log10(hb) - a(hm) + (44.9-6.55*log10(hb))*log10(d)
      pl = 46.3 + 33.9 * Math.log10(4900) - 13.82 * Math.log10(15) + (44.9 - 6.55 * Math.log10(15)) * Math.log10(dKm)
      break
    case 'p452':
    case 'p2108':
    case 'p1411':
    default:
      // Default to FSPL for complex models as conservative estimate
      pl = 32.4 + 20 * Math.log10(dKm) + 20 * Math.log10(4900)
      break
  }

  const targetRss = -95
  const gUe = 0
  const shadowMargin = 8
  return targetRss + pl - gUe + shadowMargin
}

// ─── Narrative ASCII Log Generator ────────────────────────────────────────

function directionLabelForLog(direction: string): string {
  const labels: Record<string, string> = {
    'IMT→FS': '➀ IMT→Fixed Service (co-channel)',
    'IMT→FS_ADJACENT': '➀b IMT→Fixed Service (adjacent/ACLR)',
    'FS→IMT': '➁ Fixed Service→IMT (co-channel)',
    'FS→IMT_ADJACENT': '➁b Fixed Service→IMT (adjacent)',
    'IMT↔IMT_COCHANNEL': '➂/➃ IMT↔IMT (co-channel)',
    'IMT↔IMT_ADJACENT': 'IMT↔IMT (adjacent)',
  }
  return labels[direction] || direction
}





export default function IMTAddWorkspace({ onBack, mode = 'full', onCellRadiusChange, onConfirmLocation, onShowStations, onPlotPolygon, onCentroidUpdate }: IMTAddWorkspaceProps) {
  const { fetchWithAuth } = useAuth()

  // Form state
  const [lat, setLat] = useState(13.75)
  const [lon, setLon] = useState(100.50)
  const [cellRadius, setCellRadius] = useState(500)
  const [antennaHeight, setAntennaHeight] = useState(15)
  const [antennaGain, setAntennaGain] = useState(12)
  const [maxEirp, setMaxEirp] = useState(23)
  const [autoEirp, setAutoEirp] = useState(true)
  const [indoorPct, setIndoorPct] = useState(0)  // Phase 29: 0-100% indoor
  const [coverageInfo, setCoverageInfo] = useState<CoverageInfo | null>(null)
  const [blockLimits, setBlockLimits] = useState<BlockEirpLimit[]>([])
  const [tradeoff, setTradeoff] = useState<TradeOff | null>(null)
  const [propagationModel, setPropagationModel] = useState('free_space')
  const [antennaType, setAntennaType] = useState('shape')
  const [sectorBeamwidth, setSectorBeamwidth] = useState(120)
  const [sectorAzimuth, setSectorAzimuth] = useState(0)
  const [towerAntennaPattern, setTowerAntennaPattern] = useState<'omni' | 'sector'>('omni')
  const [modelParams, setModelParams] = useState<Record<string, any>>({})
  const [name, setName] = useState('')
  const [operator, setOperator] = useState('')

  // Parcel/Shape mode state
  const [parcelCalculating, setParcelCalculating] = useState(false)
  const [parcelCalcError, setParcelCalcError] = useState('')
  const [parcelBlockResults, setParcelBlockResults] = useState<any[] | null>(null)
  // Store cached pack-circles result for shape mode
  const [packResult, setPackResult] = useState<any>(null)

  // ─── Sync Animation ──────────────────────────────────────────
  const [syncCoverageColor, setSyncCoverageColor] = useState<'inner' | 'mid' | 'outer'>('inner')
  const [syncAntennaType, setSyncAntennaType] = useState<'omni' | 'sector'>('omni')

  const sync = useSyncAnimation({
    onSyncLatLon: (latVal, lonVal) => {
      // Update map fly-to
      if (miniMapRef.current) {
        miniMapRef.current.flyTo({ center: [lonVal, latVal], zoom: 12, duration: 800 })
        // Update marker
        if (miniMarkerRef.current) miniMarkerRef.current.remove()
        miniMarkerRef.current = new maplibregl.Marker({ color: '#C00000' })
          .setLngLat([lonVal, latVal])
          .addTo(miniMapRef.current)
        drawMiniCellRadius(miniMapRef.current, latVal, lonVal, cellRadius)
      }
    },
    onSyncRadius: (r) => {
      // Update coverage circle on mini map
      if (miniMapRef.current) {
        drawMiniCellRadius(miniMapRef.current, lat, lon, r)
      }
    },
    onSyncAntenna: (type) => {
      setSyncAntennaType(type)
    },
    onSyncModel: (model) => {
      setSyncCoverageColor(getCoverageColorForModel(model))
    },
    onSyncAnalyze: () => {
      // MiniMap pulse wave is triggered by analyzePhase change
    },
    onSyncResults: (_count) => {
      // Results panels stagger is handled by CSS animation classes
    },
  })

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
  
  // Block selection for allocation
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set())

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
    // Trigger analyze animation
    sync.syncAnalyze()

    const startTime = performance.now()
    setLoading(true)
    setBlocks([])
    setSavedMessage('')
    setSaveError('')
    setCoverageInfo(null)
    setSelectedBlocks(new Set())  // Clear block selection on new analysis
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
        antenna_type: antennaType,
        sector_beamwidth_deg: sectorBeamwidth,
        sector_azimuth_deg: sectorAzimuth,
        model_params: modelParams,
        indoor_pct: indoorPct,  // Phase 29
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
      setBlockLimits(data.block_limits || [])
      // Narrative log now generated by backend engine — single source of truth
      setLogLines(data.narrative_log || [])

      // Trigger result reveal animation with stagger
      const resultCount = (data.blocks?.length || 0) + (data.pairs?.length || 0)
      sync.syncResults(resultCount)

      // Flag that analysis is complete — next render will auto-highlight stations
      highlightStationsRef.current = true
    } catch (err) {
      console.error('Analysis failed:', err)
      setLogLines((prev) => [...prev, '', 'ERROR: การวิเคราะห์ล้มเหลว กรุณาลองใหม่'])
      setSaveError('การวิเคราะห์ล้มเหลว กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }, [lat, lon, cellRadius, antennaHeight, antennaGain, maxEirp, autoEirp, propagationModel, fetchWithAuth])

  // ─── Draw polygon on mini map when pack result loads ─────────────────
  useEffect(() => {
    if (antennaType === 'shape' && packResult?._coords && miniMapRef.current) {
      drawMiniPolygon(miniMapRef.current, packResult._coords)
    }
  }, [packResult, antennaType])

  // ─── Parcel Mode Handlers ─────────────────────────────────────────────

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const geoJSON = JSON.parse(text)

      // Extract polygon vertices
      let coords: [number, number][] = []
      if (geoJSON.type === 'Feature' && geoJSON.geometry?.type === 'Polygon') {
        coords = geoJSON.geometry.coordinates[0].map((c: number[]) => [c[0], c[1]])
      } else if (geoJSON.type === 'Polygon') {
        coords = geoJSON.coordinates[0].map((c: number[]) => [c[0], c[1]])
      }

      if (coords.length < 3) {
        throw new Error('Polygon ต้องมีอย่างน้อย 3 จุดมุม')
      }

      // Call circle packing API with animation
      const res = await fetchWithAuth('/api/polygon/pack-circles', {
        method: 'POST',
        body: JSON.stringify({
          polygon: { type: 'Polygon', coordinates: [coords] },
          cell_radius_m: 0,  // 0 = auto-calculate from polygon geometry
          animate: true,
        }),
      })
      const packResultData = await res.json()

      if (packResultData.centroid) {
        setLat(packResultData.centroid.lat)
        setLon(packResultData.centroid.lon)
        onCentroidUpdate?.(packResultData.centroid)
      }
      
      // Play animation steps
      if (packResultData.steps && packResultData.steps.length > 0) {
        setParcelCalculating(true)
        const stepDelay = 350
        for (let i = 0; i < packResultData.steps.length; i++) {
          const step = packResultData.steps[i]
          setTimeout(() => {
            setPackResult({
              ...packResultData,
              points: step.points,
              coverage_pct: step.cov_pct,
              _step: i + 1,
              _total_steps: packResultData.steps.length,
              _action: step.action,
              _coords: coords,
            })
          }, i * stepDelay)
        }
        setTimeout(() => {
          setPackResult({ ...packResultData, _step: packResultData.steps.length, _total_steps: packResultData.steps.length, _action: 'done', _coords: coords })
          setParcelCalculating(false)
        }, packResultData.steps.length * stepDelay)
      } else {
        setPackResult({ ...packResultData, _coords: coords })
      }

      // Plot polygon on dashboard map
      onPlotPolygon?.(coords)

      // Send centroid to parent for star marker
      if (packResultData.centroid) {
        onCentroidUpdate?.({ lat: packResultData.centroid.lat, lon: packResultData.centroid.lon })
      }

      // Show towers on map + notify location
      onConfirmLocation?.(packResultData.centroid.lat, packResultData.centroid.lon, packResultData.cell_radius_m || cellRadius)
      onShowStations?.(
        packResultData.points.map((p: any) => ({ name: `Tower`, type: 'new_imt' as const, lat: p.lat, lon: p.lon })),
      )
    } catch (err: any) {
      setParcelCalcError(err.message || 'ไฟล์ไม่ถูกต้อง')
    }
  }

  const handleParcelAnalyze = async () => {
    if (!packResult || !packResult.points) return
    setParcelCalculating(true)
    setParcelCalcError('')
    setParcelBlockResults(null)
    setLogLines([])
    setBlocks([])
    setPairs([])
    setPairResults([])

    try {
      const effectiveEirp = autoEirp
        ? (coverageInfo?.used_eirp_dbm ?? estimateEirp(cellRadius, propagationModel))
        : maxEirp

      const towers = packResult.points.map((p: any) => ({ lat: p.lat, lon: p.lon }))
      const cellRadiusM = packResult.cell_radius_m || cellRadius

      const res = await fetchWithAuth('/api/allocate/analyze-parcel', {
        method: 'POST',
        body: JSON.stringify({
          towers,
          cell_radius_m: cellRadiusM,
          antenna_height: antennaHeight,
          antenna_gain: autoEirp ? (coverageInfo?.used_eirp_dbm ? antennaGain : 12) : antennaGain,
          max_eirp: effectiveEirp,
          model_name: propagationModel,
          model_params: modelParams,
          indoor_pct: indoorPct,
          antenna_type: towerAntennaPattern,
          sector_beamwidth_deg: sectorBeamwidth,
          sector_azimuth_deg: sectorAzimuth,
        }),
      })

      const data = await res.json()
      // Populate ALL state — same as single-tower handleCalculate
      setLogLines(data.narrative_log || [])
      setParcelBlockResults(data.blocks || [])
      if (data.pairs) setPairs(data.pairs)
      if (data.pair_results) setPairResults(data.pair_results)
      if (data.summary) setAnalysisSummary(data.summary)
      if (data.verification) setBackendVerification(data.verification)
      if (data.coverage) {
        // Coverage is now per-tower array — use first tower's for single-value display
        const cov = Array.isArray(data.coverage) ? data.coverage[0] : data.coverage
        setCoverageInfo(cov)
      }
      if (data.block_limits) setBlockLimits(data.block_limits)
      
      // For shape mode: set blocks with full interference data from backend
      if (data.blocks) {
        setBlocks(data.blocks.map((b: any) => ({
          freq_low: b.freq_low,
          freq_high: b.freq_high,
          status: b.status === 'all_clear' ? 'green' : b.status === 'fully_blocked' ? 'red' : 'gray',
          max_eirp: data.block_limits?.find((l: any) => l.freq_low === b.freq_low)?.max_eirp_dbm || (autoEirp ? effectiveEirp : maxEirp),
          i_total_dbm: b.i_total_dbm,
          threshold_dbm: b.threshold_dbm,
          margin_db: b.margin_db,
          i_total_to_fs_dbm: b.i_total_to_fs_dbm,
          i_total_to_new_imt_dbm: b.i_total_to_new_imt_dbm,
          i_total_to_existing_imt_dbm: b.i_total_to_existing_imt_dbm,
          reason: b.status === 'all_clear'
            ? (b.reason || `ใช้ได้ทุกต้น (${b.available_towers}/${packResult?.points?.length || 0})`)
            : b.status === 'fully_blocked'
            ? (b.reason || `ใช้ไม่ได้ — เสาที่ติด: ${(b.towers_blocked || []).join(', ')}`)
            : (b.reason || `บางส่วน — ติด: ${(b.towers_blocked || []).join(', ')} จาก ${packResult?.points?.length || 0} ต้น`),
        })))
      }
    } catch (err: any) {
      setParcelCalcError(err.message || 'การวิเคราะห์ล้มเหลว')
    } finally {
      setParcelCalculating(false)
    }
  }

  // ─── End Parcel Mode Handlers ────────────────────────────────────────

  // Collect related stations from analysis results
  const relatedStations = useMemo((): HighlightStation[] => {
    if (pairResults.length === 0 && pairs.length === 0) return []

    const seen = new Set<string>()
    const stations: HighlightStation[] = []

    // Always include new IMT
    stations.push({ name: 'IMT ใหม่', type: 'new_imt' })
    seen.add('new_imt')

    for (const pr of pairResults) {
      // Parse names — strip parenthesized suffixes like "(FS_RX)", "(TX)"
      const interName = pr.interferer.replace(/\\(.*?\\)$/, '').trim()
      const victName = pr.victim.replace(/\\(.*?\\)$/, '').trim()

      for (const rawName of [interName, victName]) {
        // Skip generic labels
        if (!rawName || rawName === 'NEW_IMT' || rawName === 'New IMT' || rawName === 'IMT ใหม่') continue
        if (seen.has(rawName)) continue
        seen.add(rawName)

        // Determine type from pair data
        const pair = pairs.find(
          p => p.interferer_name === rawName || p.victim_name === rawName,
        )
        if (pair) {
          if (pair.interferer_type === 'FS' || pair.victim_type === 'FS') {
            // Add both TX and RX for FS links
            if (!seen.has(rawName + '_tx')) {
              seen.add(rawName + '_tx')
              stations.push({ name: rawName, type: 'fs_tx' })
            }
            if (!seen.has(rawName + '_rx')) {
              seen.add(rawName + '_rx')
              stations.push({ name: rawName, type: 'fs_rx' })
            }
          } else {
            stations.push({ name: rawName, type: 'imt' })
          }
        } else {
          // Fallback: check direction
          if (pr.direction === 'IMT→FS' || pr.direction === 'FS→IMT') {
            if (!seen.has(rawName + '_tx')) {
              seen.add(rawName + '_tx')
              stations.push({ name: rawName, type: 'fs_tx' })
            }
            if (!seen.has(rawName + '_rx')) {
              seen.add(rawName + '_rx')
              stations.push({ name: rawName, type: 'fs_rx' })
            }
          } else {
            stations.push({ name: rawName, type: 'imt' })
          }
        }
      }
    }

    return stations
  }, [pairResults, pairs])

  // Auto-highlight related stations on map when analysis results come in
  // Called directly from handleCalculate after analysis completes
  const highlightStationsRef = useRef(false)

  useEffect(() => {
    // Only trigger highlight ONCE after analysis — not on every render
    if (highlightStationsRef.current && mode === 'panel' && onShowStations && relatedStations.length > 0) {
      onShowStations(relatedStations)
      highlightStationsRef.current = false
    }
  }, [relatedStations])

  const handleSave = useCallback(async () => {
    if (!name.trim() || !operator.trim()) {
      setSaveError('กรุณากรอกชื่อสถานีและชื่อผู้ให้บริการ')
      return
    }
    if (blocks.length === 0) {
      setSaveError('กรุณาคำนวณคลื่นความถี่ก่อนบันทึก')
      return
    }
    
    // Sync marker to exact user-input lat/lon before saving
    onConfirmLocation?.(lat, lon, cellRadius)
    
    // Filter only selected green blocks
    const selectedGreenBlocks = blocks.filter(
      (b) => b.status === 'green' && selectedBlocks.has(b.freq_low.toString())
    )
    
    if (selectedGreenBlocks.length === 0) {
      setSaveError('กรุณาเลือกอย่างน้อย 1 บล็อกที่ว่าง (สีเขียว) ก่อนบันทึก')
      return
    }

    setSaving(true)
    setSaveError('')
    try {
      // Fresh coverage calculation if autoEirp is ON and coverageInfo is stale
      let freshCoverage = coverageInfo
      if (autoEirp && !freshCoverage) {
        const covRes = await fetchWithAuth('/api/coverage/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cell_radius: cellRadius,
            antenna_height: antennaHeight,
            antenna_gain: antennaGain,
            model: propagationModel,
            model_params: modelParams,
          }),
        })
        if (covRes.ok) {
          freshCoverage = await covRes.json()
          setCoverageInfo(freshCoverage)
        }
      }

      // Use calculated EIRP when autoEirp is ON, else user-provided maxEirp
      const effectiveEirp = autoEirp 
        ? (freshCoverage?.used_eirp_dbm ?? estimateEirp(cellRadius, propagationModel))
        : maxEirp

      const res = await fetchWithAuth('/api/imt/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          center_lat: lat,
          center_lon: lon,
          cell_radius: cellRadius,
          antenna_height: antennaHeight,
          antenna_gain: antennaGain,
          max_eirp: effectiveEirp,
          antenna_type: antennaType,
          sector_beamwidth_deg: sectorBeamwidth,
          sector_azimuth_deg: sectorAzimuth,
          name: name.trim(),
          operator: operator.trim(),
          indoor_pct: indoorPct,  // Phase 29
          status: 'active',
          ...(freshCoverage ? {
            target_rss: freshCoverage.target_rss_dbm,
            shadow_margin: freshCoverage.shadow_margin_db,
            building_loss: freshCoverage.building_loss_db ?? 0,
            propagation_model: propagationModel,
            coverage_classification: freshCoverage.coverage_classification,
          } : {}),
          blocks: selectedGreenBlocks.map((b) => ({
            freq_low: b.freq_low,
            freq_high: b.freq_high,
            status: 'allocated',
          })),
        }),
      })

      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: 'ไม่สามารถบันทึกได้' }))
        throw new Error(detail.detail || 'ไม่สามารถบันทึกข้อมูล IMT ได้')
      }

      setSavedMessage('บันทึก IMT สำเร็จ')
      setTimeout(() => onBack(), 1200)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึก')
    } finally {
      setSaving(false)
    }
  }, [name, operator, lat, lon, cellRadius, antennaHeight, antennaGain, maxEirp, autoEirp, coverageInfo, blocks, selectedBlocks, antennaType, sectorBeamwidth, sectorAzimuth, propagationModel, modelParams, onConfirmLocation, fetchWithAuth, onBack])

  // Spectrum summary
  const statusCounts = {
    available: blocks.filter((b) => b.status === 'green').length,
    guard: blocks.filter((b) => b.status === 'gray').length,
    blocked: blocks.filter((b) => b.status === 'red').length,
  }
  const totalMhz = statusCounts.available * 10
  const sorted = [...blocks].sort((a, b) => a.freq_low - b.freq_low)
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null)

  // Toggle block selection for allocation
  const toggleBlockSelection = useCallback((freqLow: number) => {
    setSelectedBlocks(prev => {
      const next = new Set(prev)
      const key = freqLow.toString()
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const selectAllGreenBlocks = useCallback(() => {
    setSelectedBlocks(new Set(
      blocks.filter(b => b.status === 'green').map(b => b.freq_low.toString())
    ))
  }, [blocks])

  const deselectAllBlocks = useCallback(() => {
    setSelectedBlocks(new Set())
  }, [])

  const statusColor = (status: string): string => {
    if (status === 'green') return '#16A34A'
    if (status === 'gray') return '#9CA3AF'
    return '#DC2626'
  }

  const isPanel = mode === 'panel'

  return (
    <div className="h-full flex bg-[#F5F5F0] animate-slide-in-right">
      {!isPanel && (
        /* Left 20% — Mini Map + Sync Viz (full mode only) */
        <div className="w-[20%] min-w-[240px] flex flex-col border-r border-gray-300 bg-white">
          {/* Sync Animation MiniMap (SVG-based) */}
          <div className="h-[45%] min-h-[180px]">
            <MiniMap
              lat={lat}
              lon={lon}
              radius={cellRadius}
              antennaType={syncAntennaType}
              coverageColor={syncCoverageColor}
              isAnalyzing={loading}
              analyzePhase={sync.analyzePhase}
              isAnimating={sync.isAnimating}
              sectorBeamwidth={sectorBeamwidth}
              sectorAzimuth={sectorAzimuth}
              polygonVertices={antennaType === 'shape' ? packResult?._coords : undefined}
              towerPoints={antennaType === 'shape' && packResult?.points 
                ? packResult.points.map((p: any) => ({ lat: p.lat, lon: p.lon, cellRadius: packResult.cell_radius_m }))
                : undefined}
              className="h-full"
            />
          </div>
          {/* Divider */}
          <div className="border-t border-gray-200" />
          {/* MapLibre Mini Map */}
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

          {/* ─── Antenna Type Selector ─── */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#1A1A2E] mb-3">ประเภทการคำนวณ</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setAntennaType('shape')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  antennaType === 'shape'
                    ? 'bg-[#C00000] text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Octagon className="w-4 h-4" />
                Shape (Polygon)
              </button>
              <button
                onClick={() => setAntennaType('omni')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  antennaType !== 'shape'
                    ? 'bg-[#C00000] text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Radio className="w-4 h-4" />
                Single Cell
              </button>
            </div>
            {antennaType !== 'shape' && (
              <div className="flex gap-2 mt-3 ml-2 pl-4 border-l-2 border-gray-200">
                <button
                  onClick={() => setAntennaType('omni')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    antennaType === 'omni'
                      ? 'bg-[#1A1A2E] text-white'
                      : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <Radio className="w-3 h-3 inline mr-1" />
                  Omni
                </button>
                <button
                  onClick={() => setAntennaType('sector')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    antennaType === 'sector'
                      ? 'bg-[#1A1A2E] text-white'
                      : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <Signal className="w-3 h-3 inline mr-1" />
                  Sector
                </button>
              </div>
            )}
          </div>

          {/* ─── Shape Mode: Polygon Upload (hidden after upload) ─── */}
          {antennaType === 'shape' && !packResult && (
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-semibold text-[#1A1A2E]">ข้อมูลที่ดิน</h3>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">ลากไฟล์ .geojson มาวาง หรือ</p>
                <label className="inline-block mt-2 px-4 py-2 bg-[#C00000] text-white rounded-lg text-sm cursor-pointer hover:bg-[#8B0000]">
                  เลือกไฟล์
                  <input
                    type="file"
                    accept=".geojson,.json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                <p className="text-xs text-gray-400 mt-2">หรือสร้าง polygon จาก tab "สร้างโพลีกอน" แล้วกลับมา</p>
              </div>

              {parcelCalcError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {parcelCalcError}
                </div>
              )}

              {/* Pack result summary */}
              {packResult && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-1">
                  {/* Animation progress */}
                  {packResult._step != null && packResult._total_steps != null && packResult._action !== 'done' && (
                    <div className="space-y-1 mb-2">
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>
                          {packResult._action === 'init' && 'กำลังวาง grid เริ่มต้น...'}
                          {packResult._action === 'remove' && 'กำลัง optimize จำนวนเสา...'}
                          {packResult._action === 'gapfill' && 'กำลังเติมให้ครอบคลุม...'}
                          {packResult._action === 'shift' && 'กำลัง optimize ตำแหน่ง...'}
                        </span>
                        <span>{packResult._step}/{packResult._total_steps}</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div
                          className="bg-[#C00000] h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${(packResult._step / packResult._total_steps) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <p className="text-sm font-semibold text-green-800">Polygon พร้อมใช้งาน</p>
                  <p className="text-xs text-green-700">
                    ครอบคลุม <span className="font-bold">{packResult.coverage_pct?.toFixed(1)}%</span> |{' '}
                    {packResult.points?.length || 0} ต้น | รัศมี {packResult.cell_radius_m || cellRadius}m
                  </p>
                  <div className="flex gap-2 mt-2">
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        if (packResult?._coords) {
                          setParcelCalculating(true)
                          try {
                            const coords = packResult._coords
                            const res = await fetchWithAuth('/api/polygon/pack-circles', {
                              method: 'POST',
                              body: JSON.stringify({
                                polygon: { type: 'Polygon', coordinates: [coords] },
                                cell_radius_m: cellRadius || 0,  // 0 = auto, or user override
                                use_rf_radius: true,
                                eirp_dbm: autoEirp ? (coverageInfo?.used_eirp_dbm ?? estimateEirp(cellRadius, propagationModel)) : maxEirp,
                                model_name: propagationModel,
                                antenna_height_m: antennaHeight,
                                indoor_pct: indoorPct,
                                animate: true,
                              }),
                            })
                            const data = await res.json()
                            // Play animation steps — same as handleFileUpload
                            if (data.steps && data.steps.length > 0) {
                              const stepDelay = 350
                              for (let i = 0; i < data.steps.length; i++) {
                                const step = data.steps[i]
                                setTimeout(() => {
                                  setPackResult({
                                    ...data,
                                    points: step.points,
                                    coverage_pct: step.cov_pct,
                                    _step: i + 1,
                                    _total_steps: data.steps.length,
                                    _action: step.action,
                                    _coords: coords,
                                  })
                                }, i * stepDelay)
                                // Update towers on map during animation
                                setTimeout(() => {
                                  onShowStations?.(
                                    step.points.map((p: any) => ({ name: 'Tower', type: 'new_imt' as const, lat: p.lat, lon: p.lon })),
                                  )
                                }, i * stepDelay)
                              }
                              setTimeout(() => {
                                setPackResult({ ...data, _step: data.steps.length, _total_steps: data.steps.length, _action: 'done', _coords: coords })
                                setParcelCalculating(false)
                                onShowStations?.(
                                  data.points.map((p: any) => ({ name: 'Tower', type: 'new_imt' as const, lat: p.lat, lon: p.lon })),
                                )
                              }, data.steps.length * stepDelay)
                            } else {
                              setPackResult({ ...data, _coords: coords })
                              setParcelCalculating(false)
                              onShowStations?.(
                                data.points.map((p: any) => ({ name: 'Tower', type: 'new_imt' as const, lat: p.lat, lon: p.lon })),
                              )
                            }
                          } catch {
                            setParcelCalculating(false)
                          }
                        }
                      }}
                    >
                      <Zap className="w-4 h-4" />
                      Optimize จำนวนเสา
                    </Button>
                    <button
                      onClick={() => { setPackResult(null); setParcelBlockResults(null); onPlotPolygon?.([]) }}
                      className="text-xs text-red-500 hover:underline"
                    >
                      ล้าง
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── Shape Mode: Radio Params (after polygon upload) ─── */}
          {antennaType === 'shape' && packResult && (
            <>
            {/* Step 2: Propagation Model — SAME as single cell */}
            <div className="mb-4">
              {/* Mini polygon preview */}
              {packResult?._coords && (
                <div className="mb-4 h-[280px]">
                  <MiniMap
                    lat={packResult.centroid?.lat || lat}
                    lon={packResult.centroid?.lon || lon}
                    radius={packResult.cell_radius_m || cellRadius}
                    antennaType={towerAntennaPattern === 'sector' ? 'sector' : 'omni'}
                    coverageColor="inner"
                    polygonVertices={packResult._coords}
                    towerPoints={packResult.points?.map((p: any) => ({ lat: p.lat, lon: p.lon, cellRadius: packResult.cell_radius_m }))}
                    className="h-full"
                  />
                </div>
              )}
              <h3 className="text-sm font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-100">
                2. Propagation Model
              </h3>
              <select
                value={propagationModel}
                onChange={(e) => {
                  const newModel = e.target.value
                  setPropagationModel(newModel)
                  setCoverageInfo(null)
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
              >
                <option value="free_space">Free Space (ITU-R P.525)</option>
                <option value="p452">ITU-R P.452 (Interference)</option>
                <option value="p2108">ITU-R P.2108 (Clutter Loss)</option>
                <option value="p1411">ITU-R P.1411 (Short-Range)</option>
                <option value="hata">Hata/COST-231</option>
              </select>
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
                      value={modelParams[p.name] ?? p.defaultValue}
                      onChange={(e) => setModelParams(prev => ({...prev, [p.name]: e.target.value}))}
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

            {/* Radio params — same grid-cols-2 as single cell */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-100">
                พารามิเตอร์วิทยุ
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {/* Optimized result display */}
                {packResult && (
                <div className="col-span-2 bg-green-50 border border-green-200 rounded-lg p-3 mb-1">
                  <p className="text-sm font-semibold text-green-800">
                    🗼 {packResult.points?.length || 0} ต้น | รัศมี {packResult.cell_radius_m?.toFixed(0) || '?'}m | ครอบคลุม {packResult.coverage_pct?.toFixed(1)}%
                  </p>
                  <p className="text-xs text-green-600 mt-0.5">
                    {packResult.rf_radius ? 'คำนวณจากกำลังส่ง (RF Link Budget)' : 'คำนวณจากพื้นที่ (เรขาคณิต)'}
                  </p>
                </div>
                )}
                
                {/* Antenna Height — input type="number" like single cell */}
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
                
                {/* Indoor % — same slider as single cell */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    สัดส่วน Indoor (%)
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0" max="100" step="10"
                      value={indoorPct}
                      onChange={(e) => setIndoorPct(Number(e.target.value))}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#C00000]"
                    />
                    <span className="text-sm font-mono font-bold text-[#C00000] w-10 text-right">
                      {indoorPct}%
                    </span>
                  </div>
                  {indoorPct > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      building_loss ≈ {(indoorPct / 100 * 20).toFixed(0)} dB
                      {indoorPct >= 70 ? ' — indoor เด่น' : indoorPct >= 30 ? ' — ผสม indoor/outdoor' : ' — outdoor เด่น'}
                    </p>
                  )}
                </div>
                
                {/* Antenna Pattern — omni/sector dropdown */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    สายอากาศ
                  </label>
                  <select
                    value={towerAntennaPattern}
                    onChange={(e) => {
                      setTowerAntennaPattern(e.target.value as 'omni' | 'sector')
                      setCoverageInfo(null)
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  >
                    <option value="omni">Omni — รอบทิศทาง</option>
                    <option value="sector">Sector — แบบเซกเตอร์</option>
                  </select>
                </div>
                
                {towerAntennaPattern === 'sector' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Sector Beamwidth (deg)
                      </label>
                      <input
                        type="number"
                        value={sectorBeamwidth}
                        onChange={(e) => setSectorBeamwidth(Number(e.target.value))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Sector Azimuth (deg)
                      </label>
                      <input
                        type="number"
                        value={sectorAzimuth}
                        onChange={(e) => setSectorAzimuth(Number(e.target.value))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Optimize button — recalculate tower positions */}
            <button
              onClick={async () => {
                if (packResult?._coords) {
                  setParcelCalculating(true)
                  try {
                    const coords = packResult._coords
                    const res = await fetchWithAuth('/api/polygon/pack-circles', {
                      method: 'POST',
                      body: JSON.stringify({
                        polygon: { type: 'Polygon', coordinates: [coords] },
                        cell_radius_m: cellRadius || 0,
                        use_rf_radius: true,  // RF-aware: calculate radius from link budget
                        eirp_dbm: autoEirp ? (coverageInfo?.used_eirp_dbm ?? estimateEirp(cellRadius, propagationModel)) : maxEirp,
                        model_name: propagationModel,
                        antenna_height_m: antennaHeight,
                        indoor_pct: indoorPct,
                        grid_search: true,  // try multiple radii, pick best
                        animate: true,
                      }),
                    })
                    const data = await res.json()
                    if (data.steps && data.steps.length > 0) {
                      const stepDelay = 350
                      for (let i = 0; i < data.steps.length; i++) {
                        const step = data.steps[i]
                        setTimeout(() => {
                          setPackResult({ ...data, points: step.points, coverage_pct: step.cov_pct, _step: i + 1, _total_steps: data.steps.length, _action: step.action, _coords: coords })
                          onShowStations?.(step.points.map((p: any) => ({ name: 'Tower', type: 'new_imt' as const, lat: p.lat, lon: p.lon })))
                        }, i * stepDelay)
                      }
                      setTimeout(() => { setPackResult({ ...data, _step: data.steps.length, _total_steps: data.steps.length, _action: 'done', _coords: coords }); setParcelCalculating(false)
                        onShowStations?.(data.points.map((p: any) => ({ name: 'Tower', type: 'new_imt' as const, lat: p.lat, lon: p.lon })))
                      }, data.steps.length * stepDelay)
                    } else { setPackResult({ ...data, _coords: coords }); setParcelCalculating(false)
                      onShowStations?.(data.points.map((p: any) => ({ name: 'Tower', type: 'new_imt' as const, lat: p.lat, lon: p.lon })))
                    }
                  } catch { setParcelCalculating(false) }
                }
              }}
              disabled={parcelCalculating}
              className="w-full bg-[#1A1A2E] hover:bg-[#2D2D4A] text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" />
              {parcelCalculating ? 'กำลัง Optimize...' : `Optimize จำนวนเสา (${packResult?.points?.length || 0} ต้น)`}
            </button>

            {/* Analyze button — full width */}
            <button
              onClick={handleParcelAnalyze}
              disabled={parcelCalculating}
              className="w-full bg-[#C00000] hover:bg-[#8B0000] text-white font-semibold py-3 rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
            >
              <Search className="w-4 h-4" />
              {parcelCalculating ? 'กำลังคำนวณ...' : 'Analyze'}
            </button>
            </>
          )}

          {/* SECTION 1: Input Form — hidden for shape mode */}
          {antennaType !== 'shape' && (
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            {/* Step 1: Location — FIRST */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-100">
                1. ตำแหน่ง
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lat}
                    onChange={(e) => {
                      const newLat = parseFloat(e.target.value)
                      if (!isNaN(newLat)) {
                        setLat(newLat)
                        sync.syncLatLon(newLat, lon)
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lon}
                    onChange={(e) => {
                      const newLon = parseFloat(e.target.value)
                      if (!isNaN(newLon)) {
                        setLon(newLon)
                        sync.syncLatLon(lat, newLon)
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
                </div>
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => {
                    onConfirmLocation?.(lat, lon, cellRadius)
                    // Fire map pin drop animation — immediate (not debounced)
                    if (miniMapRef.current) {
                      miniMapRef.current.flyTo({ center: [lon, lat], zoom: 14, duration: 500 })
                      if (miniMarkerRef.current) miniMarkerRef.current.remove()
                      miniMarkerRef.current = new maplibregl.Marker({ color: '#C00000' })
                        .setLngLat([lon, lat])
                        .addTo(miniMapRef.current)
                      drawMiniCellRadius(miniMapRef.current, lat, lon, cellRadius)
                    }
                  }}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-[#C00000] text-white border-[#C00000] hover:bg-[#8B0000] transition-colors"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  ตกลง
                </button>
              </div>
            </div>

            {/* Step 2: Propagation Model — SECOND, before cell radius */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-100">
                2. Propagation Model
              </h3>
              <select
                value={propagationModel}
                onChange={(e) => {
                  const newModel = e.target.value
                  setPropagationModel(newModel)
                  setCoverageInfo(null)  // Invalidate stale coverage — model changed
                  sync.syncModel(newModel)
                  setSyncCoverageColor(getCoverageColorForModel(newModel))
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
              >
                <option value="free_space">Free Space (ITU-R P.525)</option>
                <option value="p452">ITU-R P.452 (Interference)</option>
                <option value="p2108">ITU-R P.2108 (Clutter Loss)</option>
                <option value="p1411">ITU-R P.1411 (Short-Range)</option>
                <option value="hata">Hata/COST-231</option>
              </select>
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
                      value={modelParams[p.name] ?? p.defaultValue}
                      onChange={(e) => setModelParams(prev => ({...prev, [p.name]: e.target.value}))}
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

            {/* Step 3-7: Radio params — EIRP auto-calculated from all inputs, placed LAST */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-100">
                พารามิเตอร์วิทยุ
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {/* 3. รัศมีเซลล์ */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    3. รัศมีเซลล์ (m)
                  </label>
                  <input
                    type="number"
                    value={cellRadius}
                    onChange={(e) => {
                      const r = Number(e.target.value)
                      setCellRadius(r)
                      setCoverageInfo(null)  // Invalidate stale coverage — radius changed
                      sync.syncRadius(r)
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
                </div>
                {/* 4. ความสูงเสาอากาศ */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    4. ความสูงเสาอากาศ (m AGL)
                  </label>
                  <input
                    type="number"
                    value={antennaHeight}
                    onChange={(e) => setAntennaHeight(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
                </div>
                {/* 5. Antenna Gain — only when auto EIRP OFF */}
                {!autoEirp && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    5. Antenna Gain (dBi)
                  </label>
                  <input
                    type="number"
                    value={antennaGain}
                    onChange={(e) => setAntennaGain(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
                </div>
                )}
                {/* 6. สายอากาศ IMT */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {autoEirp ? '5.' : '6.'} สายอากาศ IMT
                  </label>
                  <select
                    value={antennaType}
                    onChange={(e) => {
                      const newType = e.target.value
                      setAntennaType(newType)
                      sync.syncAntenna(newType as 'omni' | 'sector')
                      setSyncAntennaType(newType as 'omni' | 'sector')
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  >
                    <option value="omni">Omni — รอบทิศทาง</option>
                    <option value="sector">Sector — แบบเซกเตอร์</option>
                  </select>
                </div>
                {antennaType === 'sector' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Sector Beamwidth (deg)
                      </label>
                      <input
                        type="number"
                        value={sectorBeamwidth}
                        onChange={(e) => setSectorBeamwidth(Number(e.target.value))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Sector Azimuth (deg จาก True North)
                      </label>
                      <input
                        type="number"
                        value={sectorAzimuth}
                        onChange={(e) => setSectorAzimuth(Number(e.target.value))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                      />
                    </div>
                  </>
                )}
                {/* 6.5. Indoor % — Phase 29 */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    สัดส่วน Indoor (%)
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0" max="100" step="10"
                      value={indoorPct}
                      onChange={(e) => setIndoorPct(Number(e.target.value))}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#C00000]"
                    />
                    <span className="text-sm font-mono font-bold text-[#C00000] w-10 text-right">
                      {indoorPct}%
                    </span>
                  </div>
                  {indoorPct > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      building_loss ≈ {(indoorPct / 100 * 20).toFixed(0)} dB
                      {indoorPct >= 70 ? ' — indoor เด่น' : indoorPct >= 30 ? ' — ผสม indoor/outdoor' : ' — outdoor เด่น'}
                    </p>
                  )}
                </div>
                {/* 7. กำลังส่ง — LAST, auto-calculated from all inputs above */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {autoEirp ? '6.' :  antennaType === 'sector' ? '8.' : '7.'} กำลังส่ง
                  </label>
                  <div className="flex items-center gap-2">
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
                  {autoEirp && (
                    <div className="mt-2 p-2 bg-[#C00000]/5 rounded-lg border border-[#C00000]/10">
                      <span className="text-xs text-gray-500">กำลังส่งที่คำนวณได้: </span>
                      <span className="text-sm font-mono font-bold text-[#C00000]">
                        {(coverageInfo?.used_eirp_dbm ?? estimateEirp(cellRadius, propagationModel)).toFixed(1)} dBm
                      </span>
                      <span className="text-xs text-gray-400 ml-1">(จากรัศมี {cellRadius}m)</span>
                    </div>
                  )}
                  {!autoEirp && (
                    <div className="mt-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Max EIRP — รวม TX Power + Antenna Gain (dBm)
                      </label>
                      <input
                        type="number"
                        value={maxEirp}
                        onChange={(e) => setMaxEirp(Number(e.target.value))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                      />
                    </div>
                  )}
                </div>
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
          )}

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

          {/* SECTION 2.5: Pairs Report — Victim/Interferer Analysis (table format) */}
          {(pairs.length > 0 || pairResults.length > 0) && (
            <>
              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, #C00000, #D1D5DB)' }} />
                <span className="text-xs font-medium text-[#C00000] tracking-wider">PAIRS REPORT</span>
                <div className="flex-1 h-px" style={{ background: 'linear-gradient(to left, #C00000, #D1D5DB)' }} />
              </div>

              <section className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-fade-in-up">
                {/* Collapsed summary — always visible */}
                <details className="group">
                  <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 select-none list-none">
                    <ChevronRight className="w-4 h-4 text-gray-400 group-open:hidden" />
                    <ChevronDown className="w-4 h-4 text-gray-400 hidden group-open:block" />
                    <span className="text-sm font-semibold text-[#1A1A2E]">
                      ดูรายละเอียด Pairs ({pairs.length} คู่)
                    </span>
                    <span className="text-xs text-red-600 font-medium ml-2">
                      HIGH: {pairs.filter(p => p.preliminary_risk === 'HIGH').length}
                    </span>
                    <span className="text-xs text-amber-600 font-medium">
                      MED: {pairs.filter(p => p.preliminary_risk === 'MEDIUM').length}
                    </span>
                    <span className="text-xs text-gray-400">
                      LOW: {pairs.filter(p => p.preliminary_risk === 'LOW').length}
                    </span>
                    <span className="text-xs text-red-600 font-medium ml-auto">
                      CONFLICT: {pairResults.filter(pr => pr.verdict === 'CONFLICT').length}
                    </span>
                  </summary>

                  {/* Table content — expanded */}
                  <div className="px-4 pb-4 overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b-2 border-gray-200 text-left text-gray-500">
                          <th className="py-2 pr-3 font-semibold w-8">#</th>
                          <th className="py-2 pr-3 font-semibold">Interferer</th>
                          <th className="py-2 pr-3 font-semibold">Victim</th>
                          <th className="py-2 pr-3 font-semibold">Type</th>
                          <th className="py-2 pr-3 font-semibold">Distance</th>
                          <th className="py-2 pr-3 font-semibold">I[dBm]</th>
                          <th className="py-2 font-semibold">Verdict</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {pairs
                          .sort((a, b) => {
                            const riskOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
                            return (riskOrder[a.preliminary_risk] ?? 9) - (riskOrder[b.preliminary_risk] ?? 9)
                          })
                          .map((pair, idx) => {
                            const pr = pairResults.find(r =>
                              r.direction === pair.direction &&
                              r.interferer.includes(pair.interferer_name) &&
                              r.victim.includes(pair.victim_name))
                            const verdict = pr?.verdict || 'PENDING'
                            const typeLabel: Record<string, string> = {
                              'IMT→FS': 'IMT → FS',
                              'FS→IMT': 'FS → IMT',
                              'IMT↔IMT_COCHANNEL': 'IMT ↔ IMT (co)',
                              'IMT↔IMT_ADJACENT': 'IMT ↔ IMT (adj)',
                            }
                            const verdictBg =
                              verdict === 'CONFLICT' ? 'bg-red-100 text-red-700' :
                              verdict === 'GUARD_BAND' ? 'bg-amber-100 text-amber-700' :
                              'bg-green-100 text-green-700'
                            const rowBg = pair.preliminary_risk === 'HIGH' ? 'bg-red-50/30' : ''
                            return (
                              <tr key={idx} className={`${rowBg} hover:bg-gray-50`}>
                                <td className="py-1.5 pr-3 text-gray-400 font-mono">{idx + 1}</td>
                                <td className="py-1.5 pr-3 font-medium text-[#1A1A2E]">{pair.interferer_name}</td>
                                <td className="py-1.5 pr-3 text-gray-700">{pair.victim_name}</td>
                                <td className="py-1.5 pr-3 text-gray-500">{typeLabel[pair.direction] || pair.direction}</td>
                                <td className="py-1.5 pr-3 font-mono text-gray-700">{(pair.distance_m / 1000).toFixed(1)} km</td>
                                <td className="py-1.5 pr-3 font-mono text-gray-700">{pair.estimated_i_dbm.toFixed(1)}</td>
                                <td className="py-1.5">
                                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${verdictBg}`}>
                                    {verdict}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>
            </>
          )}

          {/* ─── AGGREGATE REPORT — after Pairs Report ─── */}
          {blocks.length > 0 && (() => {
            const thresholdDbm = -114.0
            
            // Aggregate I_total per victim type across ALL blocks
            const fsLinear = blocks
              .filter(b => b.i_total_to_fs_dbm != null && b.i_total_to_fs_dbm !== undefined && b.i_total_to_fs_dbm > -200)
              .reduce((sum, b) => sum + Math.pow(10, (b.i_total_to_fs_dbm ?? -200) / 10), 0)
            const newImtLinear = blocks
              .filter(b => b.i_total_to_new_imt_dbm != null && b.i_total_to_new_imt_dbm !== undefined && b.i_total_to_new_imt_dbm > -200)
              .reduce((sum, b) => sum + Math.pow(10, (b.i_total_to_new_imt_dbm ?? -200) / 10), 0)
            const existingImtLinear = blocks
              .filter(b => b.i_total_to_existing_imt_dbm != null && b.i_total_to_existing_imt_dbm !== undefined && b.i_total_to_existing_imt_dbm > -200)
              .reduce((sum, b) => sum + Math.pow(10, (b.i_total_to_existing_imt_dbm ?? -200) / 10), 0)
            
            const iTotalFs = fsLinear > 0 ? 10 * Math.log10(fsLinear) : undefined
            const iTotalNewImt = newImtLinear > 0 ? 10 * Math.log10(newImtLinear) : undefined
            const iTotalExistingImt = existingImtLinear > 0 ? 10 * Math.log10(existingImtLinear) : undefined
            
            // Count interferers per victim type from pairResults
            const fsInterferers = pairResults
              .filter(pr => pr.victim?.includes('FS_RX') || pr.direction === 'IMT→FS')
            const newImtInterferers = pairResults
              .filter(pr => pr.victim?.includes('NEW_IMT'))
            const existingImtInterferers = pairResults
              .filter(pr => pr.victim?.includes('EXISTING_IMT'))
            
            // Extract unique interferer names
            const uniqueFsInterferers = [...new Set(fsInterferers.map(pr => pr.interferer))]
            const uniqueNewImtInterferers = [...new Set(newImtInterferers.map(pr => pr.interferer))]
            const uniqueExistingImtInterferers = [...new Set(existingImtInterferers.map(pr => pr.interferer))]
            
            // Find worst interferer per victim type
            const worstFs = fsInterferers.length > 0 
              ? fsInterferers.reduce((worst, pr) => (pr.i_dbm ?? -200) > (worst.i_dbm ?? -200) ? pr : worst)
              : null
            const worstNewImt = newImtInterferers.length > 0
              ? newImtInterferers.reduce((worst, pr) => (pr.i_dbm ?? -200) > (worst.i_dbm ?? -200) ? pr : worst)
              : null
            const worstExistingImt = existingImtInterferers.length > 0
              ? existingImtInterferers.reduce((worst, pr) => (pr.i_dbm ?? -200) > (worst.i_dbm ?? -200) ? pr : worst)
              : null
            
            const hasAnyAggregate = iTotalFs != null || iTotalNewImt != null || iTotalExistingImt != null
            
            if (!hasAnyAggregate) return null

            // Collapsible state per victim row
            const aggregateRows: { label: string; iTotal: number | undefined; interferers: typeof pairResults; uniqueNames: string[]; worst: typeof worstFs; conflict: boolean }[] = [
              { label: 'FS Links', iTotal: iTotalFs, interferers: fsInterferers, uniqueNames: uniqueFsInterferers, worst: worstFs, conflict: (iTotalFs ?? -200) >= thresholdDbm },
              { label: 'IMT ใหม่ (NEW IMT)', iTotal: iTotalNewImt, interferers: newImtInterferers, uniqueNames: uniqueNewImtInterferers, worst: worstNewImt, conflict: (iTotalNewImt ?? -200) >= thresholdDbm },
              { label: 'IMT เดิม (Existing IMT)', iTotal: iTotalExistingImt, interferers: existingImtInterferers, uniqueNames: uniqueExistingImtInterferers, worst: worstExistingImt, conflict: (iTotalExistingImt ?? -200) >= thresholdDbm },
            ].filter(r => r.iTotal != null)

            const totalAffected = aggregateRows.filter(r => r.conflict).length
            const margins = aggregateRows.map(r => r.iTotal != null ? r.iTotal - thresholdDbm : -999)
            const worstMargin = Math.max(...margins)

            // Build I_total formula string from interferers
            const buildFormula = (interferers: typeof pairResults, iTotal: number) => {
              if (interferers.length === 0) return 'ไม่มี interferer'
              const terms = interferers.map(pr => `10^(${pr.i_dbm.toFixed(1)}/10)`).join(' + ')
              return `I_total = 10·log₁₀( ${terms} ) = ${iTotal.toFixed(1)} dBm`
            }

            return (
              <>
                <div className="flex items-center gap-3 my-1">
                  <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, #C00000, #D1D5DB)' }} />
                  <span className="text-xs font-medium text-[#C00000] tracking-wider">AGGREGATE REPORT</span>
                  <div className="flex-1 h-px" style={{ background: 'linear-gradient(to left, #C00000, #D1D5DB)' }} />
                </div>

                <section className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-fade-in-up">
                  {/* Summary header */}
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <div className="flex flex-wrap items-center gap-4 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[#1A1A2E]">Victims ที่ได้รับผลกระทบ:</span>
                        <span className={`font-bold ${totalAffected > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {totalAffected} / {aggregateRows.length}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[#1A1A2E]">Worst-Case Margin:</span>
                        <span className={`font-bold font-mono ${worstMargin > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {worstMargin > 0 ? '+' : ''}{worstMargin.toFixed(1)} dB
                        </span>
                        <span className="text-gray-400">(threshold {thresholdDbm} dBm)</span>
                      </div>
                    </div>
                  </div>

                  <div className="px-4 pb-4 overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b-2 border-gray-200 text-left text-gray-500">
                          <th className="py-2 w-6"></th>
                          <th className="py-2 pr-3 font-semibold">Victim Type</th>
                          <th className="py-2 pr-3 font-semibold">I_total (dBm)</th>
                          <th className="py-2 pr-3 font-semibold">Margin (dB)</th>
                          <th className="py-2 pr-3 font-semibold">จำนวน Interferer</th>
                          <th className="py-2 pr-3 font-semibold">Worst Interferer</th>
                          <th className="py-2 pr-3 font-semibold">Trend</th>
                          <th className="py-2 font-semibold">Verdict</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {aggregateRows.map((row, ri) => {
                          const marginDb = row.iTotal != null ? row.iTotal - thresholdDbm : undefined
                          // Trend: if I_total > threshold, getting worse (↑ conflict); if below, improving (↓)
                          const trendIsWorse = marginDb != null && marginDb > 0
                          return (
                            <AggregateRow key={ri}
                              row={row}
                              thresholdDbm={thresholdDbm}
                              marginDb={marginDb}
                              trendIsWorse={trendIsWorse}
                              buildFormula={buildFormula}
                            />
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )
          })()}

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
                              {coverageInfo.used_eirp_dbm != null ? coverageInfo.used_eirp_dbm.toFixed(1) : 'N/A'} dBm
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-400">EIRP ที่ต้องการ:</span>{' '}
                            <span className="font-mono font-bold text-gray-800">
                              {coverageInfo.required_eirp_dbm != null ? coverageInfo.required_eirp_dbm.toFixed(1) : 'N/A'} dBm
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-400">RSS ขอบเซลล์:</span>{' '}
                            <span className="font-mono font-bold text-gray-800">
                              {coverageInfo.cell_edge_rss_dbm != null ? coverageInfo.cell_edge_rss_dbm.toFixed(1) : 'N/A'} dBm
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
                        { label: 'Block Count', key: 'block_count', val: bv.block_count,
                          detail: `จำนวนบล็อกทั้งหมดต้องเป็น 19 บล็อก (4800-4990 MHz, ช่วงละ 10 MHz)\nผลลัพธ์: expected=${(bv.block_count as any)?.expected}, actual=${(bv.block_count as any)?.actual}` },
                        { label: 'Frequency Continuity', key: 'frequency_continuity', val: bv.frequency_continuity,
                          detail: `ตรวจสอบว่าความถี่เรียงต่อเนื่องกัน — แต่ละบล็อกต้องเริ่มที่ 4800 + i*10 MHz\nผลลัพธ์: ${bv.frequency_continuity?.reason || (bv.frequency_continuity?.pass ? 'PASS — ความถี่เรียงต่อเนื่องถูกต้อง' : 'FAIL — พบความถี่ไม่ต่อเนื่อง')}` },
                        { label: 'Guard Adjacency', key: 'guard_adjacency', val: bv.guard_adjacency,
                          detail: `ตรวจสอบว่า Green/Red blocks ต้องมี Gray (Guard Band) คั่นกลาง\nwarnings: ${(bv.guard_adjacency as any)?.warnings ?? 0}\n${!bv.guard_adjacency?.pass ? 'หมายเหตุ: กรณีที่ FS Link บล็อกเฉพาะความถี่ที่ทับซ้อน — บล็อกข้างเคียงที่อยู่นอกความถี่ FS ผ่าน Adjacent Channel check (ACS 33 dB) แล้วจึงไม่ต้องมี guard band' : ''}` },
                        { label: 'Total MHz', key: 'total_mhz', val: bv.total_mhz,
                          detail: `ตรวจสอบผลรวมความถี่ — ต้องเท่ากับ 190 MHz (19 × 10 MHz)\nผลลัพธ์: expected=${(bv.total_mhz as any)?.expected}, actual=${(bv.total_mhz as any)?.actual}` },
                        { label: 'Guard Reasons', key: 'guard_reasons', val: bv.guard_reasons,
                          detail: `ตรวจสอบว่า Gray block ทุกอันมีคำอธิบายเกี่ยวกับ adjacency/guard band\ninvalid_count: ${(bv.guard_reasons as any)?.invalid_count ?? 0}` },
                        { label: 'Path Loss Monotonicity', key: 'path_loss_monotonicity', val: (bv as any).path_loss_monotonicity,
                          detail: `Path Loss ควรเพิ่มขึ้นตามระยะทาง — ตรวจสอบ monotonicity\nผลลัพธ์: ${(bv as any).path_loss_monotonicity?.reason || ((bv as any).path_loss_monotonicity?.pass ? 'PASS' : 'FAIL')}` },
                        { label: 'Reciprocal Symmetry', key: 'reciprocal_symmetry', val: (bv as any).reciprocal_symmetry,
                          detail: `Path Loss ไม่เท่ากันเมื่อสลับฝั่ง — Hata/P.1411 ใช้ความสูงเสาเป็นพารามิเตอร์ (tx_h=15m, rx_h=1.5m) การสะท้อนพื้นและ diffraction ใน Hata ไม่สมมาตรเมื่อความสูงต่างกัน นี่คือฟิสิกส์จริง ไม่ใช่ข้อผิดพลาด\nผลลัพธ์: ${(bv as any).reciprocal_symmetry?.reason || ((bv as any).reciprocal_symmetry?.pass ? 'PASS' : 'FAIL')}` },
                        { label: 'EIRP Sanity', key: 'eirp_sanity', val: (bv as any).eirp_sanity,
                          detail: `ตรวจสอบว่า I[dBm] ทั้งหมดเป็นค่าลบ (reasonable สำหรับ 5 GHz)\nผลลัพธ์: ${(bv as any).eirp_sanity?.reason || ((bv as any).eirp_sanity?.pass ? 'PASS' : 'FAIL')}` },
                        { label: 'FS Beam Coverage', key: 'fs_beam_coverage', val: (bv as any).fs_beam_coverage,
                          detail: `ตรวจสอบ FS→IMT beam — IMT อยู่ใน main beam หรือ sidelobe\nผลลัพธ์: ${(bv as any).fs_beam_coverage?.reason || 'PASS'}` },
                        { label: 'Block Distribution', key: 'block_distribution', val: (bv as any).block_distribution,
                          detail: `ตรวจสอบการกระจายตัวของบล็อก — green + gray + red ต้องรวมเป็น 19\nผลลัพธ์: ${(bv as any).block_distribution?.reason || 'PASS'}` },
                      ]
                      return (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Verification</h4>
                          <div className="space-y-1.5">
                            {checks.map(({ label, key, val, detail }) => (
                              <details key={key} className="group">
                                <summary className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded border cursor-pointer list-none ${
                                  val?.pass ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100' :
                                  'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                                }`}>
                                  {val?.pass ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                                  <span className="font-medium flex-1">{label}</span>
                                  <span className="text-gray-500 text-[10px]">
                                    {(val as any)?.reason ? `${((val as any)?.reason || '').substring(0, 50)}...` : (
                                      key === 'block_count' || key === 'total_mhz'
                                        ? `expected ${(val as any)?.expected}, actual ${(val as any)?.actual}`
                                        : key === 'guard_adjacency'
                                          ? `warnings: ${(val as any)?.warnings}`
                                          : key === 'guard_reasons'
                                            ? `invalid: ${(val as any)?.invalid_count}`
                                            : ''
                                    )}
                                  </span>
                                  <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 group-open:hidden" />
                                  <ChevronUp className="w-3.5 h-3.5 flex-shrink-0 hidden group-open:block" />
                                </summary>
                                <div className="text-xs text-gray-700 bg-white border border-gray-200 rounded px-3 py-2 mt-0.5 ml-5 whitespace-pre-wrap leading-relaxed">
                                  {detail}
                                </div>
                              </details>
                            ))}
                          </div>
                          <div className={`mt-2 text-xs font-semibold px-3 py-1.5 rounded ${
                            bv.all_pass
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {bv.all_pass ? 'All 10 verification checks passed' : 'Some verification checks need review'}
                          </div>
                          {!bv.all_pass && (
                            <div className="mt-2 space-y-1 text-xs">
                              {Object.entries(bv).map(([k, v]) => {
                                if (k === 'all_pass') return null
                                const check = v as any
                                if (check.pass) return null
                                return (
                                  <div key={k} className="text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1">
                                    <span className="font-mono font-semibold">{k}</span>: {check.reason || 'failed'}
                                  </div>
                                )
                              })}
                            </div>
                          )}
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

              {/* Spectrum bar with checkboxes for green blocks */}
              <div className="mb-1 flex h-10 rounded overflow-hidden border border-gray-300 relative">
                {sorted.map((b, i) => (
                  <div
                    key={i}
                    title={`${b.freq_low.toFixed(0)}-${b.freq_high.toFixed(0)} MHz: ${b.reason}`}
                    className="flex-1 cursor-pointer hover:brightness-110 relative group"
                    style={{
                      backgroundColor: statusColor(b.status),
                      minWidth: `${Math.max(100 / sorted.length, 1)}%`,
                      border: '1px solid #000',
                    }}
                    onClick={() => setSelectedBlockIndex(selectedBlockIndex === i ? null : i)}
                  >
                    {/* Checkbox overlay for green blocks */}
                    {b.status === 'green' && (
                      <div 
                        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); toggleBlockSelection(b.freq_low); }}
                      >
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                          selectedBlocks.has(b.freq_low.toString()) 
                            ? 'bg-white border-white' 
                            : 'border-white bg-transparent'
                        }`}>
                          {selectedBlocks.has(b.freq_low.toString()) && (
                            <CheckCircle className="w-3 h-3 text-[#16A34A]" />
                          )}
                        </div>
                      </div>
                    )}
                    {/* Always-visible checkmark if selected */}
                    {b.status === 'green' && selectedBlocks.has(b.freq_low.toString()) && (
                      <div className="absolute top-0.5 left-0.5 text-white text-[10px]">✓</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Select/Deselect all green blocks */}
              {statusCounts.available > 0 && (
                <div className="flex items-center gap-2 mb-3 text-xs">
                  <button
                    onClick={selectAllGreenBlocks}
                    className="text-[#16A34A] hover:underline font-medium"
                  >
                    เลือกทั้งหมด ({statusCounts.available})
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={deselectAllBlocks}
                    className="text-gray-500 hover:underline"
                  >
                    ยกเลิก ({selectedBlocks.size})
                  </button>
                  <span className="ml-auto text-gray-400">
                    {selectedBlocks.size > 0 
                      ? `เลือกแล้ว ${selectedBlocks.size} บล็อก (${selectedBlocks.size * 10} MHz)` 
                      : ''}
                  </span>
                </div>
              )}

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

              {/* RESULTS TABLE — collapsible inline expand */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-200 text-left text-gray-500">
                      <th className="py-2 w-6"></th>
                      <th className="py-2 pr-3 font-semibold">บล็อก (MHz)</th>
                      <th className="py-2 pr-3 font-semibold">สถานะ</th>
                      <th className="py-2 pr-3 font-semibold">I_total (dBm)</th>
                      <th className="py-2 pr-3 font-semibold">Threshold</th>
                      <th className="py-2 pr-3 font-semibold">Margin</th>
                      <th className="py-2 pr-3 font-semibold">Max EIRP</th>
                      <th className="py-2 font-semibold">เหตุผล</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sorted.map((b, i) => {
                      const isExpanded = selectedBlockIndex === i
                      const statusThai = b.status === 'green' ? 'จัดสรรได้' : b.status === 'red' ? 'จัดสรรไม่ได้' : 'ต้องเว้นระยะ'
                      const rowBg = b.status === 'green' ? '#16A34A' : b.status === 'red' ? '#DC2626' : '#9CA3AF'
                      const statusLabelBg = b.status === 'green' ? 'bg-green-100 text-green-700' : b.status === 'red' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                      const thresholdDbm = -114.0
                      const iTotal = (b.i_total_dbm != null && b.i_total_dbm !== undefined && b.i_total_dbm > -200) ? b.i_total_dbm : undefined
                      const marginDb = iTotal != null ? (iTotal - thresholdDbm) : undefined
                      const parsed = parseReason(b.reason)

                      // Build type-prefixed reason
                      const typePrefix = (() => {
                        if (b.status === 'green') {
                          // Check if adjacent to FS red — then it's "Adjacent Channel"
                          const idx = blocks.indexOf(b)
                          const prevBlock = idx > 0 ? blocks[idx - 1] : null
                          const nextBlock = idx < blocks.length - 1 ? blocks[idx + 1] : null
                          const prevIsFsRed = prevBlock?.status === 'red' && prevBlock?.reason?.includes('FS conflict')
                          const nextIsFsRed = nextBlock?.status === 'red' && nextBlock?.reason?.includes('FS conflict')
                          if (prevIsFsRed || nextIsFsRed) return 'Adjacent Channel:'
                          return ''
                        }
                        if (b.status === 'gray') return 'Guard Band:'
                        if (parsed.conflictType === 'FS') return 'Co-channel:'
                        if (parsed.conflictType === 'IMT_COCHANNEL') return 'Co-channel (IMT):'
                        return ''
                      })()
                      const prefixedReason = typePrefix
                        ? `${typePrefix} ${b.reason}`
                        : (b.status === 'green' ? 'ว่าง — จัดสรรได้' : b.reason)

                      // Find matching pairs for this block's frequency range
                      const blockPairs = pairs.filter(p =>
                        p.freq_overlap_low <= b.freq_high && p.freq_overlap_high >= b.freq_low
                      )

                      return (
                        <React.Fragment key={i}>
                          <tr
                            className={`cursor-pointer ${isExpanded ? 'bg-gray-100' : ''} hover:brightness-95`}
                            style={{ backgroundColor: b.status === 'green' ? '#16A34A08' : b.status === 'red' ? '#DC262608' : '#9CA3AF08' }}
                            onClick={() => setSelectedBlockIndex(isExpanded ? null : i)}
                          >
                            <td className="py-2 text-gray-400">
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </td>
                            <td className="py-2 pr-3 font-mono font-bold text-[#1A1A2E]" style={{ borderLeft: `3px solid ${rowBg}` }}>
                              {b.freq_low.toFixed(0)}-{b.freq_high.toFixed(0)}
                            </td>
                            <td className="py-2 pr-3">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusLabelBg}`}>
                                {statusThai}
                              </span>
                            </td>
                            <td className="py-2 pr-3 font-mono text-gray-700">
                              {iTotal != null ? iTotal.toFixed(1) : '—'}
                            </td>
                            <td className="py-2 pr-3 font-mono text-gray-500">
                              {iTotal != null ? thresholdDbm.toFixed(1) : '—'}
                            </td>
                            <td className="py-2 pr-3 font-mono">
                              <span className={marginDb != null ? (marginDb > 0 ? 'text-red-600' : 'text-green-600') : 'text-gray-400'}>
                                {marginDb != null ? (marginDb > 0 ? '+' : '') + marginDb.toFixed(1) : '—'}
                              </span>
                            </td>
                            <td className="py-2 pr-3">
                              {(() => {
                                const lim = blockLimits.find(l => l.freq_low === b.freq_low)
                                if (!lim) return <span className="text-gray-400 text-xs">—</span>
                                if (lim.status === 'green') {
                                  const req = lim.required_eirp_dbm ?? maxEirp
                                  return (
                                    <span className="flex items-center gap-1">
                                      <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                                      <span className="text-green-700 font-semibold text-xs">
                                        ≥{req.toFixed(1)} dBm
                                      </span>
                                    </span>
                                  )
                                }
                                if (lim.status === 'red' && lim.reducible && lim.max_eirp_if_reduced_dbm != null) {
                                  return (
                                    <span className="flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                                      <span className="text-amber-700 font-semibold text-xs">
                                        ≤{lim.max_eirp_if_reduced_dbm.toFixed(1)} dBm
                                      </span>
                                    </span>
                                  )
                                }
                                if (lim.status === 'red' && !lim.reducible) {
                                  return <span className="text-red-400 text-[10px]" title={lim.reason}>ลดเองไม่ช่วย</span>
                                }
                                return <span className="text-gray-400 text-xs">—</span>
                              })()}
                            </td>
                            <td className="py-2 text-gray-600 max-w-[300px] truncate" title={prefixedReason}>
                              {prefixedReason.length > 70 ? prefixedReason.substring(0, 70) + '...' : prefixedReason}
                            </td>
                          </tr>
                          {/* Inline expanded detail row */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={8} className="p-0 bg-gray-50/50">
                                <div
                                  className="mx-1 my-1 p-3 rounded border shadow-sm"
                                  style={{
                                    borderLeftWidth: '4px',
                                    borderLeftColor: rowBg,
                                    backgroundColor: b.status === 'green' ? '#F0FDF4' : b.status === 'red' ? '#FEF2F2' : '#F9FAFB',
                                    borderColor: b.status === 'green' ? '#BBF7D0' : b.status === 'red' ? '#FECACA' : '#E5E7EB',
                                  }}
                                >
                                  {/* Header bar */}
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-sm font-mono font-bold text-[#1A1A2E]">
                                      {b.freq_low.toFixed(0)}-{b.freq_high.toFixed(0)} MHz
                                    </span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                      b.status === 'green' ? 'bg-green-100 text-green-700' :
                                      b.status === 'gray' ? 'bg-gray-100 text-gray-600' :
                                      'bg-red-100 text-red-700'
                                    }`}>
                                      {b.status === 'green' ? 'จัดสรรได้' :
                                       b.status === 'gray' ? 'ต้องเว้นระยะ' : 'จัดสรรไม่ได้'}
                                    </span>
                                    {iTotal != null && (
                                      <span className="text-xs font-mono text-gray-500 ml-auto">
                                        I_total={iTotal.toFixed(1)} dBm | Threshold={thresholdDbm} dBm | Margin={marginDb != null ? (marginDb > 0 ? '+' : '') + marginDb.toFixed(1) : '—'} dB
                                      </span>
                                    )}
                                    {b.status === 'green' && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); toggleBlockSelection(b.freq_low); }}
                                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                                          selectedBlocks.has(b.freq_low.toString())
                                            ? 'bg-green-200 text-green-800 hover:bg-green-300'
                                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                                        }`}
                                      >
                                        {selectedBlocks.has(b.freq_low.toString()) ? '✓ เลือกแล้ว' : '+ เลือก'}
                                      </button>
                                    )}
                                  </div>

                                  {/* I_total breakdown per victim type */}
                                  {(b.i_total_to_fs_dbm != null || b.i_total_to_new_imt_dbm != null || b.i_total_to_existing_imt_dbm != null) && (
                                    <div className="mb-2 space-y-0.5">
                                      <div className="text-xs font-semibold text-gray-600">I_total แยกตามประเภท Victim:</div>
                                      {b.i_total_to_fs_dbm != null && b.i_total_to_fs_dbm > -200 && (
                                        <div className="text-xs text-gray-600 ml-3">
                                          <span className="font-medium">→ FS:</span>{' '}
                                          <span className="font-mono">{b.i_total_to_fs_dbm.toFixed(1)} dBm</span>
                                        </div>
                                      )}
                                      {b.i_total_to_new_imt_dbm != null && b.i_total_to_new_imt_dbm > -200 && (
                                        <div className="text-xs text-gray-600 ml-3">
                                          <span className="font-medium">→ IMT ใหม่:</span>{' '}
                                          <span className="font-mono">{b.i_total_to_new_imt_dbm.toFixed(1)} dBm</span>
                                        </div>
                                      )}
                                      {b.i_total_to_existing_imt_dbm != null && b.i_total_to_existing_imt_dbm > -200 && (
                                        <div className="text-xs text-gray-600 ml-3">
                                          <span className="font-medium">→ IMT อื่น:</span>{' '}
                                          <span className="font-mono">{b.i_total_to_existing_imt_dbm.toFixed(1)} dBm</span>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Individual interfering sources (pairs matching this block) */}
                                  {blockPairs.length > 0 && (
                                    <div className="mb-2">
                                      <div className="text-xs font-semibold text-gray-600 mb-1">
                                        Interfering Sources ({blockPairs.length}):
                                      </div>
                                      <table className="w-full text-[11px] border-collapse">
                                        <thead>
                                          <tr className="border-b border-gray-200 text-left text-gray-500">
                                            <th className="py-0.5 pr-2 font-medium">Interferer</th>
                                            <th className="py-0.5 pr-2 font-medium">Victim</th>
                                            <th className="py-0.5 pr-2 font-medium">ประเภท</th>
                                            <th className="py-0.5 pr-2 font-medium">ระยะทาง</th>
                                            <th className="py-0.5 pr-2 font-medium">I (dBm)</th>
                                            <th className="py-0.5 font-medium">PL (dB)</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                          {blockPairs.map((pair, pidx) => {
                                            const pr = pairResults.find(r =>
                                              r.direction === pair.direction &&
                                              r.interferer.includes(pair.interferer_name) &&
                                              r.victim.includes(pair.victim_name))
                                            const typeLabel: Record<string, string> = {
                                              'IMT→FS': 'IMT → FS',
                                              'FS→IMT': 'FS → IMT',
                                              'IMT↔IMT_COCHANNEL': 'IMT ↔ IMT (co)',
                                              'IMT↔IMT_ADJACENT': 'IMT ↔ IMT (adj)',
                                            }
                                            return (
                                              <tr key={pidx} className="text-gray-700">
                                                <td className="py-0.5 pr-2">{pair.interferer_name.replace(/\(.*\)$/, '').trim()}</td>
                                                <td className="py-0.5 pr-2">{pair.victim_name.replace(/\(.*\)$/, '').trim()}</td>
                                                <td className="py-0.5 pr-2 text-gray-500">{typeLabel[pair.direction] || pair.direction}</td>
                                                <td className="py-0.5 pr-2 font-mono">{(pair.distance_m / 1000).toFixed(1)} km</td>
                                                <td className="py-0.5 pr-2 font-mono">{pair.estimated_i_dbm.toFixed(1)}</td>
                                                <td className="py-0.5 font-mono">{pr?.path_loss_db?.toFixed(1) ?? '—'}</td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}

                                  {/* Verification results for this block */}
                                  {backendVerification && (
                                    <div className="mb-2 pt-2 border-t border-gray-200">
                                      <div className="text-xs font-semibold text-gray-600 mb-1">Verification:</div>
                                      <div className="flex flex-wrap gap-1.5">
                                        {Object.entries(backendVerification).filter(([k]) => k !== 'all_pass').map(([k, v]) => {
                                          const check = v as any
                                          return (
                                            <span key={k} className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                                              check.pass ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                            }`}>
                                              {check.pass ? <CheckCircle className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
                                              {k}
                                            </span>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* Block-specific detail from parsed reason */}
                                  {b.status === 'green' && (
                                    <div className="text-xs text-green-700 space-y-1 mt-2 pt-2 border-t border-green-200">
                                      <div className="flex items-center gap-1 font-medium">
                                        <CheckCircle className="w-3.5 h-3.5" />
                                        สามารถจัดสรรได้
                                      </div>
                                      {(() => {
                                        const idx = blocks.indexOf(b)
                                        const prevBlock = idx > 0 ? blocks[idx - 1] : null
                                        const nextBlock = idx < blocks.length - 1 ? blocks[idx + 1] : null
                                        const prevIsFsRed = prevBlock?.status === 'red' && prevBlock?.reason?.includes('FS conflict')
                                        const nextIsFsRed = nextBlock?.status === 'red' && nextBlock?.reason?.includes('FS conflict')
                                        if (prevIsFsRed || nextIsFsRed) {
                                          const adjacentFsName = (prevIsFsRed && nextIsFsRed)
                                            ? `FS links บล็อก ${prevBlock?.freq_low.toFixed(0)}-${prevBlock?.freq_high.toFixed(0)} และ ${nextBlock?.freq_low.toFixed(0)}-${nextBlock?.freq_high.toFixed(0)} MHz`
                                            : prevIsFsRed
                                              ? `FS link ที่บล็อก ${prevBlock?.freq_low.toFixed(0)}-${prevBlock?.freq_high.toFixed(0)} MHz`
                                              : `FS link ที่บล็อก ${nextBlock?.freq_low.toFixed(0)}-${nextBlock?.freq_high.toFixed(0)} MHz`
                                          return (
                                            <div className="text-xs text-green-600 bg-green-100/50 rounded p-1.5 leading-relaxed">
                                              บล็อก {b.freq_low.toFixed(0)} MHz — อยู่นอกย่านความถี่ของ {adjacentFsName} {'\n'}
                                              Adjacent Channel Protection (ACS 33 dB + ACLR 45 dB = 78 dB isolation) เพียงพอ {'\n'}
                                              จัดสรรได้โดยไม่ต้องใช้ Guard Band กับ FS
                                            </div>
                                          )
                                        }
                                        return null
                                      })()}
                                    </div>
                                  )}

                                  {b.status === 'red' && parsed.conflictType === 'FS' && (
                                    <div className="text-xs space-y-1.5 mt-2 pt-2 border-t border-red-200">
                                      <div className="flex items-center gap-1 font-medium text-red-700">
                                        <XCircle className="w-3.5 h-3.5" />
                                        ไม่สามารถจัดสรรได้
                                      </div>
                                      <div className="text-red-700">สาเหตุ: ทับซ้อนกับ Fixed Service Link</div>
                                      <div className="text-red-700 space-y-0.5">
                                        {parsed.linkName && <div>&nbsp;&nbsp;&nbsp;• ชื่อ FS Link: {parsed.linkName}</div>}
                                        {parsed.imtDistance && <div>&nbsp;&nbsp;&nbsp;• ระยะห่างจาก IMT ถึง FS: {parsed.imtDistance} km</div>}
                                        {parsed.iValue && <div>&nbsp;&nbsp;&nbsp;• กำลังสัญญาณรบกวน (I): {parsed.iValue} dBm</div>}
                                        {parsed.threshold && <div>&nbsp;&nbsp;&nbsp;• Threshold: {parsed.threshold} dBm</div>}
                                        {parsed.exceedDb && <div>&nbsp;&nbsp;&nbsp;• เกิน Threshold: {parsed.exceedDb} dB</div>}
                                        {parsed.neededSeparation && <div>&nbsp;&nbsp;&nbsp;• {parsed.neededSeparation}</div>}
                                      </div>
                                    </div>
                                  )}

                                  {b.status === 'red' && parsed.conflictType === 'IMT_COCHANNEL' && (
                                    <div className="text-xs space-y-1.5 mt-2 pt-2 border-t border-red-200">
                                      <div className="flex items-center gap-1 font-medium text-red-700">
                                        <XCircle className="w-3.5 h-3.5" />
                                        ไม่สามารถจัดสรรได้
                                      </div>
                                      <div className="text-red-700">สาเหตุ: ทับซ้อนกับ IMT เครือข่ายอื่น (Co-Channel)</div>
                                      <div className="text-red-700 space-y-0.5">
                                        {parsed.linkName && <div>&nbsp;&nbsp;&nbsp;• ชื่อ IMT: {parsed.linkName}</div>}
                                        {parsed.imtDistance && <div>&nbsp;&nbsp;&nbsp;• ระยะห่างจริง: {parsed.imtDistance} km</div>}
                                        {parsed.neededSeparation && <div>&nbsp;&nbsp;&nbsp;• ระยะห่างขั้นต่ำ: {parsed.neededSeparation} km</div>}
                                      </div>
                                    </div>
                                  )}

                                  {b.status === 'gray' && parsed.conflictType === 'GUARD' && parsed.linkName && (
                                    <div className="text-xs space-y-1.5 mt-2 pt-2 border-t border-gray-200">
                                      <div className="flex items-center gap-1 font-medium text-gray-700">
                                        <Shield className="w-3.5 h-3.5" />
                                        Guard Band
                                      </div>
                                      <div className="text-gray-600 space-y-0.5">
                                        <div>&nbsp;&nbsp;&nbsp;• ช่องว่างป้องกันระหว่าง IMT: {parsed.linkName}</div>
                                        {parsed.imtDistance && <div>&nbsp;&nbsp;&nbsp;• ระยะห่างจริง: {parsed.imtDistance} km</div>}
                                        {parsed.neededSeparation && <div>&nbsp;&nbsp;&nbsp;• ระยะขั้นต่ำ: {parsed.neededSeparation} km</div>}
                                      </div>
                                    </div>
                                  )}

                                  {b.status === 'gray' && (!parsed.linkName) && (
                                    <div className="text-xs text-gray-600 mt-2 pt-2 border-t border-gray-200">
                                      Guard Band — {b.reason}
                                    </div>
                                  )}

                                  {b.status === 'red' && parsed.conflictType !== 'FS' && parsed.conflictType !== 'IMT_COCHANNEL' && (
                                    <div className="text-xs text-red-700 mt-2 pt-2 border-t border-red-200">
                                      ไม่สามารถจัดสรรได้ — {b.reason}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* ── Assurance Summary (Phase 28) ── */}
              {blockLimits.length > 0 && (
                <div className="mt-3 p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                  <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#C00000]" />
                    ผลการประเมิน — Assurance Summary
                  </h4>
                  {(() => {
                    const green = blockLimits.filter(l => l.status === 'green')
                    const redReducible = blockLimits.filter(l => l.status === 'red' && l.reducible)
                    const redNonReducible = blockLimits.filter(l => l.status === 'red' && !l.reducible)
                    
                    const bestGreen = green.length > 0 
                      ? green.reduce((best, l) => (l.max_eirp_dbm ?? 0) > (best.max_eirp_dbm ?? 0) ? l : best, green[0])
                      : null
                    const worstMargin = green.length > 0
                      ? green.reduce((worst, l) => (l.margin_db ?? 999) < (worst.margin_db ?? 999) ? l : worst, green[0])
                      : null
                    
                    return (
                      <div className="space-y-2 text-xs text-gray-700">
                        {green.length > 0 && (
                          <div className="flex items-center gap-2 py-1">
                            <CheckCircle className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                            <span>
                              <span className="font-semibold text-green-700">{green.length} บล็อก</span>
                              {' '}จัดสรรได้ ({green.length * 10} MHz)
                              {bestGreen && (
                                <> — กำลังส่ง EIRP{' '}
                                  <span className="font-mono font-bold text-green-700">
                                    ≥{(bestGreen.required_eirp_dbm ?? maxEirp).toFixed(1)} dBm
                                  </span>
                                </>
                              )}
                              {worstMargin && (
                                <span className="text-gray-500">
                                  {' '}(margin ต่ำสุด{' '}
                                  <span className={`font-mono ${(worstMargin.margin_db ?? 0) < 6 ? 'text-amber-600 font-semibold' : 'text-green-600'}`}>
                                    {worstMargin.margin_db?.toFixed(1)} dB
                                  </span>)
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        {redReducible.length > 0 && (
                          <div className="flex items-center gap-2 py-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                            <span>
                              <span className="font-semibold text-amber-700">{redReducible.length} บล็อก</span>
                              {' '}จัดสรรได้ถ้าลดกำลังส่ง — สูงสุด{' '}
                              <span className="font-mono font-bold text-amber-700">
                                {Math.min(...redReducible.map(l => l.max_eirp_if_reduced_dbm ?? 999)).toFixed(1)} dBm
                              </span>
                            </span>
                          </div>
                        )}
                        {redNonReducible.length > 0 && (
                          <div className="flex items-center gap-2 py-1">
                            <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                            <span>
                              <span className="font-semibold text-red-600">{redNonReducible.length} บล็อก</span>
                              {' '}จัดสรรไม่ได้ — ถูกรบกวนจากระบบอื่น (ลดกำลังส่งก็ไม่ช่วย)
                            </span>
                          </div>
                        )}
                        <div className="pt-2 mt-1 border-t border-gray-100 text-[10px] text-gray-500 flex items-center gap-1.5">
                          {green.length > 0 && redReducible.length === 0 && redNonReducible.length === 0 && (
                            <><CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" /> ตำแหน่งนี้ไม่มีผลกระทบต่อระบบอื่น — จัดสรรได้เต็มที่</>
                          )}
                          {redNonReducible.length > 0 && (
                            <><AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" /> มี {redNonReducible.length} บล็อกที่ไม่สามารถจัดสรรได้เนื่องจากถูกรบกวนจาก FS/IMT อื่น — แนะนำให้ย้ายตำแหน่ง</>
                          )}
                          {redReducible.length > 0 && redNonReducible.length === 0 && (
                            <><Zap className="w-3 h-3 text-amber-500 flex-shrink-0" /> ลดกำลังส่งลงจะทำให้จัดสรรได้ทุกบล็อก — พิจารณาลด cell radius</>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Save button — inside Section 4 at bottom */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <button
                  onClick={handleSave}
                  disabled={saving || selectedBlocks.size === 0}
                  className={`w-full font-semibold py-3 rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm ${
                    selectedBlocks.size > 0
                      ? 'bg-[#16A34A] hover:bg-[#15803D] text-white'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <Save className="w-4 h-4" />
                  {saving 
                    ? 'กำลังบันทึก...' 
                    : selectedBlocks.size > 0
                      ? `บันทึก IMT (${selectedBlocks.size} บล็อก = ${selectedBlocks.size * 10} MHz)`
                      : 'เลือกบล็อกสีก่อนบันทึก'}
                </button>

                {selectedBlocks.size === 0 && blocks.length > 0 && (
                  <p className="text-xs text-gray-400 mt-1 text-center">
                    คลิกที่บล็อกสีเขียวหรือกด "เลือกทั้งหมด" เพื่อเลือกบล็อกที่ต้องการจัดสรร
                  </p>
                )}

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

function drawMiniPolygon(map: maplibregl.Map, coords: [number, number][]) {
  const srcId = 'mini-polygon-src'
  const fillId = 'mini-polygon-fill'
  const outlineId = 'mini-polygon-outline'
  
  try {
    if (map.getLayer(fillId)) map.removeLayer(fillId)
    if (map.getLayer(outlineId)) map.removeLayer(outlineId)
    if (map.getSource(srcId)) map.removeSource(srcId)
    
    if (!coords || coords.length < 3) return
    
    const closed: [number, number][] = [...coords]
    if (closed[0][0] !== closed[closed.length-1][0] || closed[0][1] !== closed[closed.length-1][1]) {
      closed.push(closed[0])
    }
    
    map.addSource(srcId, {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed] }, properties: {} },
    })
    map.addLayer({ id: fillId, type: 'fill', source: srcId, paint: { 'fill-color': '#C00000', 'fill-opacity': 0.12 } })
    map.addLayer({ id: outlineId, type: 'line', source: srcId, paint: { 'line-color': '#C00000', 'line-width': 2 } })
    
    const bounds = new maplibregl.LngLatBounds()
    closed.forEach(c => bounds.extend(c))
    map.fitBounds(bounds, { padding: 20, duration: 500 })
  } catch (e) {
    console.warn('Failed to draw mini polygon:', e)
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
