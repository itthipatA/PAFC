import { useState, useEffect, useRef, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { circle } from '@turf/turf'
import { Search, Save, ArrowLeft, PlusCircle, CheckCircle, Shield, XCircle, MapPin, AlertTriangle, Zap, ArrowRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { MAP_STYLES } from './MapView'
import type { BlockResult, Pair, PairResult as PairResultType, AnalyzeSummary } from '../types'

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

  // FS conflict: "FS conflict: BKK-01-Link (I=-54.4 dBm > threshold -114.0 dBm)"
  const fsMatch = raw.match(/FS conflict:\s*(.+?)\s*\(I=([-\d.]+)\s*dBm\s*>\s*threshold\s*([-\d.]+)\s*dBm\)/)
  if (fsMatch) {
    const linkName = fsMatch[1].trim()
    const iValue = fsMatch[2]
    const threshold = fsMatch[3]
    const exceedDb = (parseFloat(iValue) - parseFloat(threshold)).toFixed(1)
    return { conflictType: 'FS', linkName, iValue, threshold, exceedDb, raw }
  }

  // IMT co-channel: "IMT co-channel conflict: TEST-IMT-01 (0.6 km < 3.0 km)"
  const imtMatch = raw.match(/IMT co-channel conflict:\s*(.+?)\s*\(([\d.]+)\s*km\s*<\s*([\d.]+)\s*km\)/)
  if (imtMatch) {
    const linkName = imtMatch[1].trim()
    const imtDistance = imtMatch[2]
    const neededSeparation = imtMatch[3]
    return { conflictType: 'IMT_COCHANNEL', linkName, imtDistance, neededSeparation, raw }
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

const PROPAGATION_MODEL_INFO: Record<string, { label: string; description: string }> = {
  free_space: {
    label: 'Free Space',
    description: 'คำนวณการสูญเสียสัญญาณในพื้นที่ว่าง (Free Space Path Loss) เหมาะสำหรับพื้นที่โล่งไม่มีสิ่งกีดขวาง',
  },
  p452: {
    label: 'ITU-R P.452',
    description: 'แบบจำลองการแพร่กระจายคลื่นตามมาตรฐาน ITU-R P.452 คำนึงถึงผลกระทบจากสภาพอากาศและภูมิประเทศ',
  },
  hata: {
    label: 'Hata',
    description: 'แบบจำลอง Okumura-Hata สำหรับพื้นที่เมือง เหมาะสำหรับความถี่ 150-1500 MHz ในสภาพแวดล้อมเมือง',
  },
}

// ─── Narrative ASCII Log Generator ────────────────────────────────────────

function generateNarrativeLog(
  params: { lat: number; lon: number; cellRadius: number; antH: number; antG: number; eirp: number; model: string },
  response: any,
  elapsedMs: number,
): string[] {
  const lines: string[] = []
  const blocks = response.blocks || []
  const modelLabel = PROPAGATION_MODEL_INFO[params.model]?.label || params.model
  const green = blocks.filter((b: any) => b.status === 'green')
  const red = blocks.filter((b: any) => b.status === 'red')
  const gray = blocks.filter((b: any) => b.status === 'gray')

  lines.push('═══════════════════════════════════════════════')
  lines.push('  PAFC INTERFERENCE ANALYSIS — DETAILED REPORT')
  lines.push('═══════════════════════════════════════════════')
  lines.push('')

  // Section 1: Input Parameters
  lines.push('─── 1. INPUT PARAMETERS ────────────────────────────────────────')
  lines.push(`   Location        : (${params.lat.toFixed(4)}, ${params.lon.toFixed(4)})`)
  lines.push(`   Cell Radius     : ${params.cellRadius} m`)
  lines.push(`   Antenna Height  : ${params.antH} m AGL`)
  lines.push(`   Antenna Gain    : ${params.antG} dBi`)
  lines.push(`   Max EIRP        : ${params.eirp} dBm`)
  lines.push(`   Propagation     : ${modelLabel}`)
  lines.push(`   Frequency Band  : 4800 – 4990 MHz (190 MHz, 19 blocks × 10 MHz)`)
  lines.push('')

  // Section 2: Propagation Model
  lines.push('─── 2. PROPAGATION MODEL ───────────────────────────────────────')
  if (params.model === 'free_space') {
    const fspl1km = 32.4 + 20 * Math.log10(1) + 20 * Math.log10(4900)
    lines.push('   Model           : Free Space Path Loss (FSPL)')
    lines.push('   Formula         : FSPL(dB) = 32.4 + 20·log10(d_km) + 20·log10(f_MHz)')
    lines.push('   Description     : คำนวณการสูญเสียในพื้นที่ว่าง ไม่มีสิ่งกีดขวาง')
    lines.push('')
    lines.push(`   Example: ที่ระยะ 1 km, ความถี่ 4900 MHz:`)
    lines.push(`     FSPL = 32.4 + 20·log10(1) + 20·log10(4900)`)
    lines.push(`          = 32.4 + 0 + 73.8`)
    lines.push(`          = ${fspl1km.toFixed(1)} dB`)
  } else if (params.model === 'p452') {
    lines.push('   Model           : ITU-R P.452')
    lines.push('   Description     : คำนึงถึงสภาพอากาศ ภูมิประเทศ และการกระเจิง')
  } else {
    lines.push('   Model           : Hata (Okumura-Hata)')
    lines.push('   Description     : สำหรับพื้นที่เมือง')
  }
  lines.push('')
  lines.push('   IMT Parameters   : cell_radius, antenna_height, antenna_gain, max_eirp')
  lines.push('   Standard         : ITU-R SM.1047 — sufficient for spectrum coordination')
  lines.push('                      at 4.8–5.0 GHz (omni-pattern assumed, conservative)')
  lines.push('')

  // Section 3: FS Link Conflict
  const fsConflicts = red.filter((b: any) => b.reason?.includes('FS conflict'))
  lines.push('─── 3. FS LINK CONFLICT ANALYSIS ────────────────────────────────')
  lines.push(`   Conflicts found : ${fsConflicts.length} block(s)`)
  if (fsConflicts.length > 0) {
    lines.push('   Details:')
    fsConflicts.forEach((b: any) => {
      const m = b.reason.match(/FS conflict:\s*(.+?)\s*\(I=([-\d.]+)\s*dBm\s*>\s*threshold\s*([-\d.]+)\s*dBm\)/)
      if (m) {
        const exceed = (parseFloat(m[2]) - parseFloat(m[3])).toFixed(1)
        lines.push(`     ${b.freq_low.toFixed(0)}-${b.freq_high.toFixed(0)} MHz : ${m[1].trim()}`)
        lines.push(`       I = ${m[2]} dBm > threshold ${m[3]} dBm (exceed by ${exceed} dB)`)
        lines.push(`       I = EIRP_IMT − FSPL(d, f) + G_RX_FS`)
      } else {
        lines.push(`     ${b.reason}`)
      }
    })
  } else {
    lines.push('   No FS link conflicts detected.')
  }
  lines.push('')

  // Section 4: IMT Co-Channel
  const imtConflicts = red.filter((b: any) => b.reason?.includes('IMT co-channel'))
  const neighborsChecked = response.neighbor_imts_checked || 0
  lines.push('─── 4. IMT CO-CHANNEL ANALYSIS ──────────────────────────────────')
  lines.push(`   Neighbors       : ${neighborsChecked} block(s) from nearby IMT stations`)
  lines.push(`   Co-channel hits : ${imtConflicts.length} block(s)`)
  if (imtConflicts.length > 0) {
    imtConflicts.forEach((b: any) => {
      const m = b.reason.match(/IMT co-channel conflict:\s*(.+?)\s*\(([\d.]+)\s*km\s*<\s*([\d.]+)\s*km\)/)
      if (m) {
        lines.push(`   ${b.freq_low.toFixed(0)}-${b.freq_high.toFixed(0)} MHz : ${m[1].trim()} at ${m[2]} km (need ${m[3]} km)`)
      } else {
        lines.push(`   ${b.reason}`)
      }
    })
  } else {
    lines.push('   No co-channel conflicts.')
  }
  lines.push('')

  // Section 5: Guard Band
  const guardBlocks = gray.filter((b: any) => b.reason?.includes('Guard band'))
  lines.push('─── 5. GUARD BAND ANALYSIS ──────────────────────────────────────')
  lines.push(`   Guard bands     : ${guardBlocks.length} block(s)`)
  if (guardBlocks.length > 0) {
    guardBlocks.forEach((b: any) => {
      const m = b.reason.match(/Guard band:\s*(.+?)\s*\(([\d.]+)\s*km\s*<\s*([\d.]+)\s*km\)/)
      if (m) {
        const name = m[1].trim().replace('adjacent to ', '')
        lines.push(`   ${b.freq_low.toFixed(0)}-${b.freq_high.toFixed(0)} MHz : adjacent to ${name} (${m[2]} km < ${m[3]} km)`)
      } else {
        lines.push(`   ${b.reason}`)
      }
    })
    lines.push('')
    lines.push('   Guard bands prevent adjacent-channel interference between')
    lines.push('   different IMT networks operating in close proximity.')
  } else {
    lines.push('   No guard bands required.')
  }
  lines.push('')

  // Section 6: Final Results with ASCII bar
  lines.push('─── 6. FINAL BLOCK ALLOCATION ──────────────────────────────────')
  lines.push(`   Total    : ${blocks.length} blocks (190 MHz)`)
  lines.push(`   Available: ${green.length} (${green.length * 10} MHz)  █`)
  lines.push(`   Blocked  : ${red.length} (${red.length * 10} MHz)  ▓`)
  lines.push(`   Guard    : ${gray.length} (${gray.length * 10} MHz)  ░`)
  lines.push('')
  let barLine = '   ['
  blocks.forEach((b: any) => {
    barLine += b.status === 'green' ? '█' : b.status === 'red' ? '▓' : '░'
  })
  barLine += ']'
  lines.push(barLine)
  lines.push('   4800                                                                 4990 MHz')
  lines.push('   █ = Available   ▓ = Blocked   ░ = Guard Band')
  lines.push('')

  const availMHz = green.length * 10
  const pct = ((availMHz / 190) * 100).toFixed(1)
  lines.push(`   RESULT: ${availMHz} / 190 MHz available (${pct}%)`)
  lines.push(`   Response time: ${elapsedMs} ms`)
  lines.push('')
  lines.push('═══════════════════════════════════════════════')

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
    setLogLines([
      '═══════════════════════════════════════════════',
      '  Sending analysis request to backend...',
      '═══════════════════════════════════════════════',
    ])
    try {
      const res = await fetchWithAuth('/api/allocate/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          center_lat: lat,
          center_lon: lon,
          cell_radius: cellRadius,
          antenna_height: antennaHeight,
          antenna_gain: antennaGain,
          max_eirp: maxEirp,
          model: propagationModel,
        }),
      })
      const data = await res.json()
      const elapsedMs = Math.round(performance.now() - startTime)
      setBlocks(data.blocks || [])
      setPairs(data.pairs || [])
      setPairResults(data.pair_results || [])
      setAnalysisSummary(data.summary || null)
      setLogLines(generateNarrativeLog(
        { lat, lon, cellRadius, antH: antennaHeight, antG: antennaGain, eirp: maxEirp, model: propagationModel },
        data,
        elapsedMs,
      ))
    } catch (err) {
      console.error('Analysis failed:', err)
      setLogLines((prev) => [...prev, '', 'ERROR: การวิเคราะห์ล้มเหลว กรุณาลองใหม่'])
      setSaveError('การวิเคราะห์ล้มเหลว กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }, [lat, lon, cellRadius, antennaHeight, antennaGain, maxEirp, propagationModel, fetchWithAuth])

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
  }, [name, operator, lat, lon, cellRadius, antennaHeight, antennaGain, maxEirp, blocks, fetchWithAuth, onBack])

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
                    Max EIRP (dBm)
                  </label>
                  <input
                    type="number"
                    value={maxEirp}
                    onChange={(e) => setMaxEirp(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  />
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
                  <option value="free_space">Free Space</option>
                  <option value="p452">ITU-R P.452</option>
                  <option value="hata">Hata</option>
                </select>
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
                    <div>max_eirp     = {maxEirp} dBm</div>
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
