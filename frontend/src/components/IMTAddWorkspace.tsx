import { useState, useEffect, useRef, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { circle } from '@turf/turf'
import { Search, Save, ArrowLeft, PlusCircle, CheckCircle, Shield, XCircle, Info, MapPin } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { MAP_STYLES } from './MapView'
import type { BlockResult } from '../types'

interface IMTAddWorkspaceProps {
  onBack: () => void
  mode?: 'full' | 'panel'
  onMapClickLat?: number | null
  onMapClickLon?: number | null
  onCellRadiusChange?: (r: number) => void
  onActivateMapClick?: () => void
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
  conflictType: 'FS' | 'GUARD' | 'UNKNOWN'
  linkName?: string
  iValue?: string      // interference value in dBm
  threshold?: string    // threshold value in dBm
  exceedDb?: string     // how much it exceeds threshold
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

  // Guard band
  if (raw.toLowerCase().includes('guard') || raw.includes('Guard')) {
    return { conflictType: 'GUARD', raw }
  }

  return { conflictType: 'UNKNOWN', raw }
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

export default function IMTAddWorkspace({ onBack, mode = 'full', onMapClickLat, onMapClickLon, onCellRadiusChange, onActivateMapClick }: IMTAddWorkspaceProps) {
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
  const [mapClickActive, setMapClickActive] = useState(false)

  // Calculation state
  const [loading, setLoading] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const [blocks, setBlocks] = useState<BlockResult[]>([])

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
  const stepRef = useRef(0)

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

  // Calculation log animation
  useEffect(() => {
    if (loading) {
      setLogLines([])
      stepRef.current = 0
      const steps = [
        'กำลังคำนวณ propagation loss...',
        'กำลังตรวจสอบ FS links...',
        'กำลังวิเคราะห์ guard band...',
        'กำลังสรุปผล...',
      ]
      const timer = setInterval(() => {
        if (stepRef.current < steps.length) {
          setLogLines((prev) => prev.concat(steps[stepRef.current]))
          stepRef.current++
          if (stepRef.current >= steps.length) {
            clearInterval(timer)
          }
        }
      }, 500)
      return () => clearInterval(timer)
    }
    // Keep logLines visible after loading completes; only clear on next calculate
  }, [loading])

  // Auto-scroll log
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logLines])

  // Sync map-click position to lat/lon inputs
  useEffect(() => {
    if (onMapClickLat != null && onMapClickLon != null && mapClickActive) {
      setLat(onMapClickLat)
      setLon(onMapClickLon)
      setMapClickActive(false)
    }
  }, [onMapClickLat, onMapClickLon, mapClickActive])

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
    setLoading(true)
    setBlocks([])
    setSavedMessage('')
    setSaveError('')
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
      setBlocks(data.blocks || [])
    } catch (err) {
      console.error('Analysis failed:', err)
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
                  onClick={() => {
                    onActivateMapClick?.()
                    setMapClickActive(true)
                  }}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                    mapClickActive
                      ? 'bg-[#C00000] text-white border-[#C00000]'
                      : 'bg-white text-[#C00000] border-[#C00000]/30 hover:bg-red-50'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5" />
                  คลิกตำแหน่งจากแผนที่
                </button>
                {mapClickActive && (
                  <p className="text-xs text-[#C00000] mt-1.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    คลิกตำแหน่งบนแผนที่ด้านซ้าย...
                  </p>
                )}
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
            <section className="bg-gray-50 rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Calculation Log</h3>
              <div
                ref={logContainerRef}
                className="max-h-40 overflow-y-auto text-xs font-mono text-gray-600 space-y-1"
              >
                {logLines.map((line, i) => (
                  <div
                    key={i}
                    className="py-0.5 transition-opacity duration-300"
                    style={{ opacity: 1 }}
                  >
                    [{i + 1}/4] {line}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ─── DIVIDER 2: between Log and Calculation Details ─── */}
          {blocks.length > 0 && (
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, #D1D5DB)' }} />
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(to left, transparent, #D1D5DB)' }} />
            </div>
          )}

          {/* SECTION 3: Terminal Calculation Report */}          {blocks.length > 0 && (() => {
            const availableMhz = statusCounts.available * 10
            const totalMhz = blocks.length * 10
            const pct = totalMhz > 0 ? ((availableMhz / totalMhz) * 100).toFixed(1) : '0.0'
            const modelLabel = PROPAGATION_MODEL_INFO[propagationModel]?.label || propagationModel
            const modelDesc = PROPAGATION_MODEL_INFO[propagationModel]?.description || ''
            const guardBlocks = blocks.filter(b => b.status === 'gray')
            const guardMhz = statusCounts.guard * 10

            // Build box-drawing report lines
            const W = 46 // total inner width
            const padR = (s: string, n: number) => { const str = String(s); return str + ' '.repeat(Math.max(0, n - str.length)) }
            const dash = (label: string) => padR('\u2500\u2500\u2500', W - label.length - 3)
            let lines: string[] = []
            lines.push('\u250C\u2500\u2500 Calculation Report ' + '\u2500'.repeat(W - 22) + '\u2510')
            // PARAMETERS
            lines.push('\u2502  PARAMETERS' + ' '.repeat(W - 16) + '\u2502')
            lines.push('\u2502  ' + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + '  \u2502')
            lines.push('\u2502  position     = (' + lat.toFixed(4) + ', ' + lon.toFixed(4) + ')' + ' '.repeat(Math.max(0, W - 5 - 36 - ('(' + lat.toFixed(4) + ', ' + lon.toFixed(4) + ')').length)) + '\u2502')
            lines.push('\u2502  cell_radius  = ' + padR(cellRadius.toLocaleString() + ' m', W - 32) + '\u2502')
            lines.push('\u2502  ant_height   = ' + padR(antennaHeight + ' m AGL', W - 33) + '\u2502')
            lines.push('\u2502  ant_gain     = ' + padR(antennaGain + ' dBi', W - 33) + '\u2502')
            lines.push('\u2502  max_eirp     = ' + padR(maxEirp + ' dBm', W - 33) + '\u2502')
            lines.push('\u2502  name         = ' + padR((name || '-'), W - 34) + '\u2502')
            lines.push('\u2502  operator     = ' + padR((operator || '-'), W - 34) + '\u2502')
            lines.push('\u2502' + ' '.repeat(W + 1) + '\u2502')
            // MODEL
            lines.push('\u2502  MODEL: ' + padR(modelLabel, W - 30) + '\u2502')
            lines.push('\u2502  # FSPL(dB) = 32.4 + 20log10(d) + 20log10(f)' + ' '.repeat(Math.max(0, W - 1 - 45)) + '\u2502')
            lines.push('\u2502  # ' + padR(modelDesc, W - 5) + '\u2502')
            lines.push('\u2502' + ' '.repeat(W + 1) + '\u2502')
            // GUARD BAND ANALYSIS
            lines.push('\u2502  GUARD BAND ANALYSIS' + ' '.repeat(W - 22) + '\u2502')
            lines.push('\u2502  ' + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + '  \u2502')
            lines.push('\u2502  Guard bands provide frequency separation' + ' '.repeat(Math.max(0, W - 5 - 43)) + '\u2502')
            lines.push('\u2502  between IMT and FS services to prevent' + ' '.repeat(Math.max(0, W - 5 - 38)) + '\u2502')
            lines.push('\u2502  adjacent-channel interference.' + ' '.repeat(Math.max(0, W - 5 - 30)) + '\u2502')
            if (statusCounts.guard === 0) {
              lines.push('\u2502  No guard bands required in this' + ' '.repeat(Math.max(0, W - 5 - 30)) + '\u2502')
              lines.push('\u2502  allocation scenario.' + ' '.repeat(Math.max(0, W - 5 - 19)) + '\u2502')
            } else {
              lines.push('\u2502  Guard bands required: ' + padR(statusCounts.guard + ' blocks (' + guardMhz + ' MHz)', W - 26) + '\u2502')
              guardBlocks.forEach(b => {
                lines.push('\u2502    ' + padR(b.freq_low.toFixed(0) + '-' + b.freq_high.toFixed(0) + ' MHz (guard)', W - 30) + '\u2502')
              })
            }
            lines.push('\u2502' + ' '.repeat(W + 1) + '\u2502')
            // RESULTS
            lines.push('\u2502  RESULTS' + ' '.repeat(W - 13) + '\u2502')
            lines.push('\u2502  ' + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + '  \u2502')
            lines.push('\u2502  total_blocks  = ' + padR(blocks.length + ' (4800-4990 MHz)', W - 34) + '\u2502')
            lines.push('\u2502  available     = ' + padR(statusCounts.available + ' (' + availableMhz + ' MHz)', W - 34) + '\u2502')
            lines.push('\u2502  blocked       = ' + padR(statusCounts.blocked + ' (' + (statusCounts.blocked * 10) + ' MHz)', W - 34) + '\u2502')
            lines.push('\u2502  guard_bands   = ' + padR(String(statusCounts.guard), W - 34) + '\u2502')
            lines.push('\u2502' + ' '.repeat(W + 1) + '\u2502')
            lines.push('\u2502  SUMMARY: ' + padR(availableMhz + '/' + totalMhz + ' MHz available (' + pct + '%)', W - 13) + '\u2502')
            lines.push('\u2514' + '\u2500'.repeat(W + 1) + '\u2518')

            return (
              <section className="bg-[#0D1117] rounded-lg border border-gray-700 p-4 overflow-x-auto">
                <pre className="text-green-400 font-mono text-xs leading-relaxed m-0 whitespace-pre">
                  {lines.join('\n')}
                </pre>
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
            <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
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

                      {block.status === 'gray' && (
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
