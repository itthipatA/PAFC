import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { Upload, AlertTriangle, MapPin, Save, Play, X, Loader2, Check, Shield } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import type { AllocationAnalyzeResponse, FrameStructureOption, SaveBlock } from '../types'
import PolygonShape from './PolygonShape'

interface IMTAddWorkspaceProps {
  onBack: () => void
  mode?: 'full' | 'panel'
  onPlotPolygon?: (vertices: [number, number][]) => void
}

/* ══════════════════════════════════════════════════════════
   Spectrum block status color map
   green=allocated, red=blocked_by_fs, orange=blocked_by_imt, gray=unselected
   ══════════════════════════════════════════════════════════ */
const STATUS_COLORS: Record<string, string> = {
  available: '#2E7D32',
  blocked_by_fs: '#C62828',
  blocked_by_imt: '#E65100',
}

const STATUS_LABELS: Record<string, string> = {
  available: 'ว่าง',
  blocked_by_fs: 'ติด FS',
  blocked_by_imt: 'ติด IMT',
}

/* ── GeoJSON parser ───────────────────────────────────── */
function parseGeoJSONFile(text: string): {
  vertices: [number, number][]
  geojson: any
  error?: string
} {
  try {
    const geojson = JSON.parse(text)
    let coords: number[][]
    if (geojson.type === 'Polygon') {
      coords = geojson.coordinates[0]
    } else if (geojson.type === 'MultiPolygon') {
      coords = geojson.coordinates[0][0]  // first polygon, exterior ring
    } else if (geojson.type === 'Feature' && geojson.geometry?.type === 'Polygon') {
      coords = geojson.geometry.coordinates[0]
    } else if (geojson.type === 'Feature' && geojson.geometry?.type === 'MultiPolygon') {
      coords = geojson.geometry.coordinates[0][0]
    } else if (geojson.type === 'FeatureCollection' && geojson.features?.[0]?.geometry?.type === 'Polygon') {
      coords = geojson.features[0].geometry.coordinates[0]
    } else if (geojson.type === 'FeatureCollection' && geojson.features?.[0]?.geometry?.type === 'MultiPolygon') {
      coords = geojson.features[0].geometry.coordinates[0][0]
    } else {
      return { vertices: [], geojson: null, error: 'กรุณาอัพโหลดไฟล์ GeoJSON ประเภท Polygon เท่านั้น' }
    }
    if (!coords || coords.length < 3) {
      return { vertices: [], geojson: null, error: 'Polygon ต้องมีอย่างน้อย 3 จุด' }
    }
    const vertices: [number, number][] = coords.map((c) => [c[0], c[1]] as [number, number])
    return { vertices, geojson }
  } catch {
    return { vertices: [], geojson: null, error: 'ไม่สามารถอ่านไฟล์ GeoJSON ได้' }
  }
}

/* ── Compute polygon centroid ─────────────────────────── */
function centroid(vertices: [number, number][]): { lat: number; lon: number } | null {
  if (!vertices || vertices.length === 0) return null
  const sumLat = vertices.reduce((s, v) => s + v[1], 0)
  const sumLon = vertices.reduce((s, v) => s + v[0], 0)
  return { lat: sumLat / vertices.length, lon: sumLon / vertices.length }
}

/* ── Generate block key ───────────────────────────────── */
const blockKey = (freqLow: number, freqHigh: number) => `${freqLow}-${freqHigh}`

/* ══════════════════════════════════════════════════════════
   IMTAddWorkspace — Redesign 2026-07-19
   New input order: polygon → TDD pattern → station → operator
   Results: calc log first (white bg) → spectrum single row
   ══════════════════════════════════════════════════════════ */
export default function IMTAddWorkspace({
  onBack,
  mode = 'full',
  onPlotPolygon,
}: IMTAddWorkspaceProps) {
  const { fetchWithAuth } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── State ─────────────────────────────────────────────
  const [geojsonData, setGeojsonData] = useState<any>(null)
  const [polygonVertices, setPolygonVertices] = useState<[number, number][]>([])
  const [name, setName] = useState('')
  const [operator, setOperator] = useState('')
  const [frameStructure, setFrameStructure] = useState('DDDSU')
  const [frameOptions, setFrameOptions] = useState<FrameStructureOption[]>([])
  const [analysisResult, setAnalysisResult] = useState<AllocationAnalyzeResponse | null>(null)
  const [selectedBlocks, setSelectedBlocks] = useState<Map<string, 'allocated' | 'guard'>>(new Map())
  const [selectionMode, setSelectionMode] = useState<'assign' | 'guard' | null>('assign')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // ── Derived: polygon centroid ─────────────────────────
  const polyCentroid = useMemo(() => centroid(polygonVertices), [polygonVertices])

  // ── Load frame structure options ──────────────────────
  useEffect(() => {
    fetchWithAuth('/api/allocate/frame-options')
      .then(r => r.json())
      .then(d => setFrameOptions(d.patterns || []))
      .catch(() => {})
  }, [fetchWithAuth])

  // ── Handle file upload ────────────────────────────────
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    setError(null)
    setAnalysisResult(null)
    setSelectedBlocks(new Map())
    setSelectionMode(null)
    const text = await file.text()
    const parsed = parseGeoJSONFile(text)
    if (parsed.error) { setUploadError(parsed.error); return }
    setPolygonVertices(parsed.vertices)
    setGeojsonData(parsed.geojson)
    onPlotPolygon?.(parsed.vertices)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [onPlotPolygon])

  // ── Run analysis ──────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (!geojsonData) return
    setLoading(true)
    setError(null)
    setAnalysisResult(null)
    setSelectedBlocks(new Map())
    try {
      const resp = await fetchWithAuth('/api/allocate/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          polygon_geojson: geojsonData,
          frame_structure: frameStructure,
          name: name.trim(),
          operator: operator.trim(),
          technology: '5G',
          cell_radius_m: 500,
        }),
      })
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.detail || 'การตรวจสอบลมเหลว')
      }
      const data: AllocationAnalyzeResponse = await resp.json()
      setAnalysisResult(data)
      // Default to assign mode after analysis
      setSelectionMode('assign')
    } catch (err: any) {
      setError(err.message || 'เกิดขอผิดพลาด')
    } finally {
      setLoading(false)
    }
  }, [geojsonData, frameStructure, name, operator, fetchWithAuth])

  // ── Toggle block based on active selection mode ──────
  const toggleBlock = useCallback((key: string) => {
    if (!selectionMode) return // no mode active — do nothing
    
    setSelectedBlocks(prev => {
      const next = new Map(prev)
      const current = next.get(key)
      
      if (!current) {
        // Block not selected → assign per active mode
        next.set(key, selectionMode === 'assign' ? 'allocated' : 'guard')
      } else if (current === 'allocated' && selectionMode === 'assign') {
        // Clicking allocated block in Assign mode → unselect
        next.delete(key)
      } else if (current === 'guard' && selectionMode === 'guard') {
        // Clicking guard block in Guard mode → unselect
        next.delete(key)
      } else {
        // Switching: allocated→guard or guard→allocated
        next.set(key, selectionMode === 'assign' ? 'allocated' : 'guard')
      }
      return next
    })
  }, [selectionMode])

  // ── Save ──────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!geojsonData || selectedBlocks.size === 0) return
    setSaving(true)
    setError(null)
    const blocksToSave: SaveBlock[] = Array.from(selectedBlocks.entries()).map(([key, status]) => {
      const [lo, hi] = key.split('-').map(Number)
      return { freq_low: lo, freq_high: hi, status }
    })
    try {
      const resp = await fetchWithAuth('/api/allocate/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          operator: operator.trim(),
          polygon_geojson: geojsonData,
          frame_structure: frameStructure,
          selected_blocks: blocksToSave,
        }),
      })
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.detail || 'การบันทึกลมเหลว')
      }
      onBack()
    } catch (err: any) {
      setError(err.message || 'เกิดขอผิดพลาดในการบันทึก')
    } finally {
      setSaving(false)
    }
  }, [geojsonData, selectedBlocks, name, operator, frameStructure, fetchWithAuth, onBack])

  // ── Block counts ──────────────────────────────────────
  const counts = useMemo(() => {
    if (!analysisResult) return { available: 0, blockedFS: 0, blockedIMT: 0, guard: 0, selected: 0, total: 0 }
    const byStatus: Record<string, number> = {}
    analysisResult.blocks.forEach(b => { byStatus[b.status] = (byStatus[b.status] || 0) + 1 })
    const allocatedCount = Array.from(selectedBlocks.values()).filter(s => s === 'allocated').length
    const guardCount = Array.from(selectedBlocks.values()).filter(s => s === 'guard').length
    return {
      available: byStatus.available || 0,
      blockedFS: byStatus.blocked_by_fs || 0,
      blockedIMT: byStatus.blocked_by_imt || 0,
      guard: guardCount,
      selected: allocatedCount + guardCount,
      total: analysisResult.blocks.length,
    }
  }, [analysisResult, selectedBlocks])

  // ── Container class based on mode ─────────────────────
  const containerClass = mode === 'panel'
    ? 'h-full overflow-y-auto animate-slide-in-right'
    : 'w-[480px] h-full bg-[#F5F5F0] border-r border-gray-200 animate-slide-in-right overflow-y-auto'

  // ── Common input style ────────────────────────────────
  const inputClass = 'w-full px-3 py-2 text-sm border border-[#E5E5E0] rounded-md bg-white text-[#333333] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000]'

  /* ═══════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════ */
  return (
    <div className={containerClass}>
      {/* ── HEADER: X close (left) + title (center) ─────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E5E0] bg-white sticky top-0 z-10">
        <button
          onClick={onBack}
          className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 p-1.5 rounded-md transition-colors"
          title="ปิด"
          aria-label="ปิด"
        >
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-bold text-[#333333] font-thai">
          เพิ่ม IMT Allocation
        </h2>
        <div className="w-8" />
      </div>

      <div className="p-4 space-y-4">
        {/* ═══════════════════════════════════════════════════
            INPUTS (ordered per spec)
            1. Polygon file upload
            2. TDD Pattern
            3. ชื่อสถานี
            4. ชื่อผู้ให้บริการ
            ═══════════════════════════════════════════════════ */}

        {/* ── 1. Polygon file upload ────────────────────── */}
        <section className="bg-white rounded-lg border border-[#E5E5E0] p-4">
          <label className="block text-sm font-bold text-[#333333] mb-2 font-thai">
            ไฟล์ Polygon (GeoJSON)
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json"
            onChange={handleFileUpload}
            className="hidden"
            id="geojson-upload"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#C00000] text-white rounded-md text-sm font-bold hover:bg-[#A00000] transition-colors font-thai"
            >
              <Upload className="w-4 h-4" />
              อัพโหลดไฟล์
            </button>
            <span className="text-sm text-gray-400 font-thai">
              {polygonVertices.length > 0
                ? `อัพโหลดแล้ว (${polygonVertices.length} จุด)`
                : 'ยังไม่ได้เลือกไฟล์'}
            </span>
          </div>

          {/* Upload error */}
          {uploadError && (
            <div className="flex items-center gap-2 text-sm text-[#BA1A1A] bg-red-50 border border-red-200 rounded-md px-3 py-2 mt-3 font-thai">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {uploadError}
            </div>
          )}

          {/* Polygon preview (mini-map) */}
          {polygonVertices.length > 0 && (
            <div className="h-[160px] rounded-lg overflow-hidden border border-[#E5E5E0] bg-[#F5F5F0] mt-3">
              <PolygonShape vertices={polygonVertices} />
            </div>
          )}

          {/* Centroid coordinates */}
          {polyCentroid && (
            <div className="flex items-center gap-2 mt-2">
              <MapPin className="w-3 h-3 text-[#C00000]" />
              <span className="text-xs text-gray-500 font-mono">
                {polyCentroid.lat.toFixed(6)}, {polyCentroid.lon.toFixed(6)}
              </span>
            </div>
          )}
        </section>

        {/* ── 2. TDD Pattern ────────────────────────────── */}
        <section className="bg-white rounded-lg border border-[#E5E5E0] p-4">
          <label className="block text-sm font-bold text-[#333333] mb-2 font-thai">
            TDD Pattern
          </label>
          <select
            value={frameStructure}
            onChange={e => setFrameStructure(e.target.value)}
            className={inputClass + ' font-thai'}
          >
            {frameOptions.length === 0 && (
              <option value="DDDSU">DDDSU — Default</option>
            )}
            {frameOptions.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label} — {opt.description}
              </option>
            ))}
          </select>
        </section>

        {/* ── 3. ชื่อสถานี ──────────────────────────────── */}
        <section className="bg-white rounded-lg border border-[#E5E5E0] p-4">
          <label className="block text-sm font-bold text-[#333333] mb-2 font-thai">
            ชื่อสถานี
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="เชน สถานีฐาน กทม."
            className={inputClass + ' font-thai'}
          />
        </section>

        {/* ── 4. ชื่อผู้ให้บริการ ────────────────────────── */}
        <section className="bg-white rounded-lg border border-[#E5E5E0] p-4">
          <label className="block text-sm font-bold text-[#333333] mb-2 font-thai">
            ชื่อผู้ให้บริการ
          </label>
          <input
            type="text"
            value={operator}
            onChange={e => setOperator(e.target.value)}
            placeholder="เช่น บริษัท เอกชน จำกัด"
            className={inputClass + ' font-thai'}
          />
        </section>

        {/* ═══════════════════════════════════════════════════
            ANALYZE BUTTON
            ═══════════════════════════════════════════════════ */}
        <button
          onClick={handleAnalyze}
          disabled={!geojsonData || loading}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-bold text-white transition-all duration-200 font-thai ${
            !geojsonData || loading
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-[#C00000] hover:bg-[#A00000] active:bg-[#8B0000]'
          }`}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              กำลังตรวจสอบ...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              วิเคราะห์การจัดสรร
            </>
          )}
        </button>

        {/* Error alert */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-[#BA1A1A] bg-red-50 border border-red-200 rounded-md px-3 py-2 font-thai">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════
            RESULTS (after analysis)
            ORDER: Calc Log FIRST → Spectrum Blocks SECOND
            ═══════════════════════════════════════════════════ */}
        {analysisResult && (
          <>
            {/* ── CALCULATION LOG (first, white bg) ──────── */}
            <section
              className="rounded-lg border border-[#E5E5E0] p-4 overflow-hidden"
              style={{ backgroundColor: '#FFFFFF' }}
            >
              <h3 className="text-sm font-bold text-[#333333] mb-3 font-thai">
                บันทึกการคำนวณ
              </h3>

              <div
                className="text-sm leading-relaxed max-h-80 overflow-y-auto"
                style={{ color: '#333333' }}
              >
                {/* Summary line */}
                <div className="font-bold mb-2 font-thai">
                  {analysisResult.summary}
                </div>
                <div className="text-xs text-gray-500 mb-3 font-thai">
                  Frame: {analysisResult.selected_frame_structure}
                  {' '}| IMT: {analysisResult.existing_imt_count}
                  {' '}| FS: {analysisResult.existing_fs_count}
                </div>

                {/* Narrative log — strip emoji, add dash separators */}
                {analysisResult.narrative_log.map((line, i) => {
                  // Strip all emoji characters
                  const cleanLine = line.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}\u{2764}\u{2705}\u{274C}\u{26A0}\u{2702}-\u{27B0}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{FE0F}\u{20E3}]/gu, '')
                    .replace(/✅/g, '')
                    .replace(/❌/g, '')
                    .replace(/⚠️/g, '')
                    .replace(/📐/g, '')
                    .replace(/🟢/g, '')
                    .replace(/🔴/g, '')
                    .replace(/🟠/g, '')
                    .replace(/📡/g, '')
                    .replace(/📶/g, '')
                  // Detect if line is a section header
                  const isHeader = /^(?:ขั้นตอน|Phase|ผลลัพธ|สรุป|การ|ตรวจ|วิเคราะห|คำนวณ)/.test(cleanLine.trim())
                  const isFirst = i === 0

                  return (
                    <React.Fragment key={i}>
                      {/* Separator before each step header (not before first line) */}
                      {isHeader && !isFirst && (
                        <div className="my-2 text-gray-300 font-thai select-none">
                          —————————————
                        </div>
                      )}
                      <div
                        className={`font-thai ${isHeader ? 'font-bold text-[#C00000] mt-1' : ''}`}
                        style={{
                          color: isHeader ? '#C00000' : '#333333',
                          wordBreak: 'break-word',
                        }}
                      >
                        {cleanLine}
                      </div>
                    </React.Fragment>
                  )
                })}
              </div>
            </section>

            {/* ── SPECTRUM BLOCKS (single row) ───────────── */}
            <section className="bg-white rounded-lg border border-[#E5E5E0] p-4">
              <h3 className="text-sm font-bold text-[#333333] mb-3 font-thai">
                Spectrum Blocks — เลือก {counts.selected} จาก {counts.total} ช่องสัญญาณ
              </h3>

              {/* ── Assign/Guard mode toggle buttons ──────── */}
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setSelectionMode(prev => prev === 'assign' ? null : 'assign')}
                  className={`flex-1 py-2 rounded-md text-sm font-bold font-thai transition-all duration-150 border-2 ${
                    selectionMode === 'assign'
                      ? 'bg-[#C62828] text-white border-[#C62828] ring-2 ring-[#C62828]/40'
                      : 'bg-white text-[#C62828] border-[#C62828]/30 hover:border-[#C62828]'
                  }`}
                >
                  Assign Block
                </button>
                <button
                  onClick={() => setSelectionMode(prev => prev === 'guard' ? null : 'guard')}
                  className={`flex-1 py-2 rounded-md text-sm font-bold font-thai transition-all duration-150 border-2 ${
                    selectionMode === 'guard'
                      ? 'bg-[#E65100] text-white border-[#E65100] ring-2 ring-[#E65100]/40'
                      : 'bg-white text-[#E65100] border-[#E65100]/30 hover:border-[#E65100]'
                  }`}
                >
                  Guard Block
                </button>
              </div>

              {/* Single row: blocks left to right */}
              <div className="flex flex-row gap-1 overflow-x-auto pb-2 mb-3">
                {analysisResult.blocks.map(block => {
                  const key = blockKey(block.freq_low, block.freq_high)
                  const selectedStatus = selectedBlocks.get(key)
                  const isAllocated = selectedStatus === 'allocated'
                  const isGuard = selectedStatus === 'guard'
                  const isBlockedFS = block.status === 'blocked_by_fs'
                  const isBlockedIMT = block.status === 'blocked_by_imt'
                  const isBlocked = isBlockedFS || isBlockedIMT

                  // Color logic:
                  // available → green (ready to allocate), guard → orange, blocked_by_fs → red, blocked_by_imt → brown,
                  // can_be_guard suggestion → light orange (only when not yet selected as allocated)
                  let displayColor = '#2E7D32' // default GREEN (available, ready to allocate)
                  if (isGuard) displayColor = '#E65100'
                  else if (isBlockedFS) displayColor = '#C62828'
                  else if (isBlockedIMT) displayColor = '#795548'
                  else if (!isAllocated && block.can_be_guard && !isBlocked) displayColor = '#FFE0B2'  // suggestion: light orange

                  // Text color: dark for light bg (suggestion), white for all others
                  const textColor = (displayColor === '#FFE0B2') ? '#333333' : '#FFFFFF'

                  const isClickable = !isBlocked

                  return (
                    <button
                      key={key}
                      onClick={() => isClickable && toggleBlock(key)}
                      disabled={!isClickable}
                      className="flex-shrink-0 flex flex-col items-center justify-center rounded-sm text-white text-center px-2 py-2 transition-all duration-150 focus:outline-none"
                      style={{
                        backgroundColor: displayColor,
                        color: textColor,
                        border: '1px solid #000',
                        minWidth: '48px',
                        cursor: isClickable ? 'pointer' : 'default',
                        opacity: isClickable ? 1 : 0.55,
                      }}
                      title={
                        isBlockedFS
                          ? block.reason_th || 'ติด FS'
                          : isBlockedIMT
                          ? block.reason_th || 'ติด IMT'
                          : isAllocated
                          ? 'จัดสรรแล้ว'
                          : isGuard
                          ? 'Guard'
                          : 'คลิกเพื่อเลือก'
                      }
                    >
                      <div className="font-bold text-[10px] leading-tight font-mono">
                        {block.freq_low}-{block.freq_high}
                      </div>
                      <div className="text-[8px] leading-tight font-mono mt-0.5">
                        {block.freq_low}
                      </div>
                      {isAllocated && <Check className="w-3 h-3 mt-0.5" />}
                      {isGuard && <Shield className="w-3 h-3 mt-0.5" />}
                      {!isAllocated && !isGuard && <div className="w-3 h-3 mt-0.5" />}
                    </button>
                  )
                })}
              </div>

              {/* Legend — 5 items */}
              <div className="flex items-center gap-3 text-[10px] text-gray-500 flex-wrap font-thai">
                <div className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-sm inline-block"
                    style={{ backgroundColor: '#2E7D32', border: '1px solid #000' }}
                  />
                  ว่าง ({counts.available - counts.selected > 0 ? counts.available - counts.selected : 0})
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-sm inline-block"
                    style={{ backgroundColor: '#2E7D32', border: '1px solid #000' }}
                  />
                  เลือก ({Array.from(selectedBlocks.values()).filter(s => s === 'allocated').length})
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-sm inline-block"
                    style={{ backgroundColor: '#E65100', border: '1px solid #000' }}
                  />
                  Guard ({counts.guard})
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-sm inline-block"
                    style={{ backgroundColor: '#C62828', border: '1px solid #000' }}
                  />
                  ติด FS ({counts.blockedFS})
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-sm inline-block"
                    style={{ backgroundColor: '#795548', border: '1px solid #000' }}
                  />
                  ติด IMT ({counts.blockedIMT})
                </div>
              </div>

              {/* Click instruction */}
              <p className="text-[10px] text-gray-400 mt-2 font-thai">
                {selectionMode === 'assign'
                  ? 'คลิกที่ช่องสัญญาณเพื่อเลือก(สีเขียว) / ยกเลิก'
                  : selectionMode === 'guard'
                  ? 'คลิกที่ช่องสัญญาณเพื่อกำหนด Guard(สีส้ม) / ยกเลิก'
                  : 'กด Assign Block หรือ Guard Block เพื่อเริ่มเลือกช่องสัญญาณ'}
              </p>
            </section>

            {/* ── ACTION BUTTONS: Save + Cancel ──────────── */}
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={selectedBlocks.size === 0 || !name.trim() || !operator.trim() || saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-thai"
                style={{ backgroundColor: '#2E7D32' }}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                บันทึก ({selectedBlocks.size} ช่อง)
              </button>
              <button
                onClick={onBack}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#E5E5E0] bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold font-thai"
              >
                <X className="w-4 h-4" />
                ยกเลิก
              </button>
            </div>
          </>
        )}

        {/* ── EMPTY STATE ────────────────────────────────── */}
        {!analysisResult && !polygonVertices.length && (
          <div className="text-center py-8 text-gray-400 font-thai">
            <MapPin className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">
              อัพโหลดไฟล์ GeoJSON เพื่อเริ่มการวิเคราะห์
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
