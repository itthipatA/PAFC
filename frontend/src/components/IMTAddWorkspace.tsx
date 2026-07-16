import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { Upload, AlertTriangle, MapPin, Save, Search, ChevronDown, ChevronUp, Shield } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import type { AllocationAnalyzeResponse, FrameStructureOption, SaveBlock } from '../types'
import { MiniMap } from './MiniMap'
import { Button } from './Button'

interface IMTAddWorkspaceProps {
  onBack: () => void
  mode?: 'full' | 'panel'
  onPlotPolygon?: (vertices: [number, number][]) => void
}

// Status color lookup (Phase 37)
const STATUS_META: Record<string, { bg: string; label: string }> = {
  available: { bg: '#16A34A', label: 'วาง' },
  blocked_by_fs: { bg: '#DC2626', label: 'ติด FS' },
  blocked_by_imt: { bg: '#F59E0B', label: 'ติด IMT' },
}

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
    } else if (geojson.type === 'Feature' && geojson.geometry?.type === 'Polygon') {
      coords = geojson.geometry.coordinates[0]
    } else if (geojson.type === 'FeatureCollection' && geojson.features?.[0]?.geometry?.type === 'Polygon') {
      coords = geojson.features[0].geometry.coordinates[0]
    } else {
      return { vertices: [], geojson: null, error: 'กรุณาอัพโหลดไฟล์ GeoJSON ประเภท Polygon เท่านั้น' }
    }
    if (!coords || coords.length < 3) {
      return { vertices: [], geojson: null, error: 'Polygon ตองมีอยางนอย 3 จุด' }
    }
    const vertices: [number, number][] = coords.map((c) => [c[0], c[1]] as [number, number])
    return { vertices, geojson }
  } catch {
    return { vertices: [], geojson: null, error: 'ไมสามารถอานไฟล GeoJSON ได' }
  }
}

export default function IMTAddWorkspace({
  onBack,
  mode = 'full',
  onPlotPolygon,
}: IMTAddWorkspaceProps) {
  const { fetchWithAuth } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // State
  const [geojsonData, setGeojsonData] = useState<any>(null)
  const [polygonVertices, setPolygonVertices] = useState<[number, number][]>([])
  const [name, setName] = useState('')
  const [operator, setOperator] = useState('')
  const [frameStructure, setFrameStructure] = useState('DDDSU')
  const [frameOptions, setFrameOptions] = useState<FrameStructureOption[]>([])
  const [analysisResult, setAnalysisResult] = useState<AllocationAnalyzeResponse | null>(null)
  const [selectedBlocks, setSelectedBlocks] = useState<Map<string, 'allocated' | 'guard'>>(new Map())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null)
  const [showNarrative, setShowNarrative] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const blockKey = (freqLow: number, freqHigh: number) => `${freqLow}-${freqHigh}`

  // Load frame structure options
  useEffect(() => {
    fetchWithAuth('/api/allocate/frame-options')
      .then(r => r.json())
      .then(d => setFrameOptions(d.patterns || []))
      .catch(() => {})
  }, [fetchWithAuth])

  // Handle file upload
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    setError(null)
    setAnalysisResult(null)
    const text = await file.text()
    const parsed = parseGeoJSONFile(text)
    if (parsed.error) { setUploadError(parsed.error); return }
    setPolygonVertices(parsed.vertices)
    setGeojsonData(parsed.geojson)
    onPlotPolygon?.(parsed.vertices)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [onPlotPolygon])

  // Run analysis
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
        }),
      })
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.detail || 'การตรวจสอบลมเหลว')
      }
      const data: AllocationAnalyzeResponse = await resp.json()
      setAnalysisResult(data)
      // Auto-select available blocks
      const sel = new Map<string, 'allocated' | 'guard'>()
      data.blocks.forEach(b => {
        if (b.status === 'available') sel.set(blockKey(b.freq_low, b.freq_high), 'allocated')
      })
      setSelectedBlocks(sel)
    } catch (err: any) {
      setError(err.message || 'เกิดขอผิดพลาด')
    } finally {
      setLoading(false)
    }
  }, [geojsonData, frameStructure, name, operator, fetchWithAuth])

  // Toggle block: allocated → guard → unselected
  const toggleBlock = useCallback((key: string) => {
    setSelectedBlocks(prev => {
      const next = new Map(prev)
      const current = next.get(key)
      if (!current || current === 'guard') {
        next.delete(key)
      } else if (current === 'allocated') {
        next.set(key, 'guard')
      }
      return next
    })
  }, [])

  const toggleExpand = useCallback((key: string) => {
    setExpandedBlock(prev => prev === key ? null : key)
  }, [])

  // Save
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
      alert('บันทึกการจัดสรรคลื่นความถี่เรียบรอยแลว')
      onBack()
    } catch (err: any) {
      setError(err.message || 'เกิดขอผิดพลาดในการบันทึก')
    } finally {
      setSaving(false)
    }
  }, [geojsonData, selectedBlocks, name, operator, frameStructure, fetchWithAuth, onBack])

  // Count results
  const counts = useMemo(() => {
    if (!analysisResult) return { available: 0, blockedFS: 0, blockedIMT: 0, guard: 0 }
    const byStatus: Record<string, number> = {}
    analysisResult.blocks.forEach(b => { byStatus[b.status] = (byStatus[b.status] || 0) + 1 })
    return {
      available: byStatus.available || 0,
      blockedFS: byStatus.blocked_by_fs || 0,
      blockedIMT: byStatus.blocked_by_imt || 0,
      guard: Array.from(selectedBlocks.values()).filter(s => s === 'guard').length,
    }
  }, [analysisResult, selectedBlocks])

  const containerClass = mode === 'panel'
    ? 'h-full animate-slide-in-right'
    : 'w-[480px] h-full bg-[#F5F5F0] border-r border-gray-200 animate-slide-in-right overflow-y-auto'

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-500 hover:text-gray-700 p-1 rounded hover:bg-gray-100 transition-colors" title="กลับ">
            <ChevronDown className="w-5 h-5 rotate-90" />
          </button>
          <h2 className="text-base font-semibold text-gray-900">เพิ่มสถานี IMT</h2>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* 1. Polygon Upload */}
        <section className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">พื้นที่ใหบริการ</h3>
          <div className="mb-3">
            <input ref={fileInputRef} type="file" accept=".geojson,.json" onChange={handleFileUpload} className="hidden" id="geojson-upload" />
            <label htmlFor="geojson-upload" className="flex items-center justify-center gap-2 w-full px-4 py-6 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-[#C00000] hover:bg-red-50/30 transition-colors">
              <Upload className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-600">
                {polygonVertices.length > 0 ? 'เปลี่ยนไฟล GeoJSON' : 'อัพโหลดไฟล GeoJSON (.geojson)'}
              </span>
            </label>
          </div>
          {uploadError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /><span>{uploadError}</span>
            </div>
          )}
          {polygonVertices.length > 0 && (
            <>
              <div className="h-[200px] rounded-lg overflow-hidden border border-gray-200 mb-3">
                <MiniMap lat={13.7563} lon={100.5018} radius={100} antennaType="omni" polygonVertices={polygonVertices} className="w-full h-full" />
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <MapPin className="w-4 h-4 text-[#C00000]" /><span>{polygonVertices.length} จุด</span>
              </div>
            </>
          )}
        </section>

        {/* 2. Station Info */}
        <section className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">ขอมูลสถานี</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ชื่อสถานี</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="เชน โรงงาน กทม."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ผูใหบริการ</label>
              <input type="text" value={operator} onChange={e => setOperator(e.target.value)} placeholder="เชน บริษัท เอกชน จำกัด"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000]" />
            </div>
            {/* Frame Structure Selector */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">รูปแบบ TDD (Frame Structure)</label>
              <select value={frameStructure} onChange={e => setFrameStructure(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000]">
                {frameOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label} — {opt.description}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* 3. Analyze Button */}
        <Button onClick={handleAnalyze} disabled={!geojsonData || loading} loading={loading}
          className="w-full bg-[#C00000] hover:bg-[#A00000] text-white font-semibold py-3 rounded-lg">
          {loading ? <><Search className="w-4 h-4 mr-2" />กำลังตรวจสอบ...</> : <><Search className="w-4 h-4 mr-2" />ตรวจสอบการจัดสรรคลื่นความถี่</>}
        </Button>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /><span>{error}</span>
          </div>
        )}

        {/* 4. Results */}
        {analysisResult && (
          <>
            {/* Summary */}
            <section className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">ผลการตรวจสอบ</h3>
              <div className="bg-[#F5F5F0] rounded-lg p-3 mb-4">
                <p className="text-xs text-gray-700 leading-relaxed">{analysisResult.summary}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                <div className="bg-green-50 rounded-lg p-2 border border-green-200">
                  <div className="text-lg font-bold text-green-700">{counts.available}</div>
                  <div className="text-[10px] text-green-600">วาง</div>
                </div>
                <div className="bg-red-50 rounded-lg p-2 border border-red-200">
                  <div className="text-lg font-bold text-red-700">{counts.blockedFS}</div>
                  <div className="text-[10px] text-red-600">ติด FS</div>
                </div>
                <div className="bg-orange-50 rounded-lg p-2 border border-orange-200">
                  <div className="text-lg font-bold text-orange-700">{counts.blockedIMT}</div>
                  <div className="text-[10px] text-orange-600">ติด IMT</div>
                </div>
              </div>

              {/* Block grid */}
              <div className="grid grid-cols-5 gap-1.5 mb-4">
                {analysisResult.blocks.map(block => {
                  const meta = STATUS_META[block.status] || STATUS_META.available
                  const key = blockKey(block.freq_low, block.freq_high)
                  const selectedStatus = selectedBlocks.get(key)
                  const isExpanded = expandedBlock === key

                  return (
                    <div key={key}>
                      <button onClick={() => toggleExpand(key)} className="w-full text-left"
                        style={{
                          backgroundColor: meta.bg,
                          color: '#FFFFFF',
                          border: '1px solid #000',
                          borderRadius: '4px',
                          padding: '4px 6px',
                          fontSize: '10px',
                          lineHeight: '1.3',
                          opacity: selectedStatus || block.status !== 'available' ? 1 : 0.45,
                          cursor: 'pointer',
                          transition: 'opacity 0.15s',
                        }}
                        title={block.reason_th}>
                        <div className="font-mono font-bold">{block.freq_low}-{block.freq_high}</div>
                        <div className="flex items-center gap-1">
                          <span>{selectedStatus === 'guard' ? 'Guard' : meta.label}</span>
                          {isExpanded ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="mt-1 p-2 bg-gray-50 rounded border border-gray-200 text-xs text-gray-700">
                          <p className="mb-1">{block.reason_th}</p>
                          {block.blocked_by.length > 0 && (
                            <div>
                              <span className="font-semibold">ถูกบล็อกโดย:</span>
                              <ul className="list-disc list-inside mt-0.5">
                                {block.blocked_by.map((item, i) => <li key={i}>{item}</li>)}
                              </ul>
                            </div>
                          )}
                          {block.status === 'available' && (
                            <div className="flex gap-1 mt-1">
                              <button onClick={e => { e.stopPropagation(); toggleBlock(key) }}
                                className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                                  selectedStatus === 'allocated'
                                    ? 'bg-green-50 text-green-600 border-green-200'
                                    : 'bg-gray-50 text-gray-500 border-gray-200'
                                }`}>
                                {selectedStatus === 'allocated' ? '✓ จัดสรร' : 'จัดสรร'}
                              </button>
                              <button onClick={e => { e.stopPropagation(); toggleBlock(key) }}
                                className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                                  selectedStatus === 'guard'
                                    ? 'bg-amber-50 text-amber-600 border-amber-200'
                                    : 'bg-gray-50 text-gray-500 border-gray-200'
                                }`}>
                                {selectedStatus === 'guard' ? '✓ Guard' : 'Guard'}
                              </button>
                            </div>
                          )}
                          {block.can_be_guard && (
                            <div className="mt-1 flex items-center gap-1 text-amber-600">
                              <Shield className="w-3 h-3" />
                              <span className="text-[10px]">{block.guard_reason_th}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#16A34A', border: '1px solid #000' }} /><span>วาง</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#DC2626', border: '1px solid #000' }} /><span>ติด FS</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#F59E0B', border: '1px solid #000' }} /><span>ติด IMT</span></div>
              </div>
            </section>

            {/* Narrative Log */}
            <section className="bg-white rounded-lg border border-gray-200 p-4">
              <button onClick={() => setShowNarrative(!showNarrative)}
                className="flex items-center justify-between w-full text-sm font-semibold text-gray-900">
                <span>บันทึกการตรวจสอบ (Narrative Log)</span>
                {showNarrative ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showNarrative && (
                <div className="mt-3 max-h-48 overflow-y-auto bg-gray-900 text-green-400 rounded-lg p-3 font-mono text-[11px] leading-relaxed">
                  {analysisResult.narrative_log.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </section>

            {/* Save */}
            <Button onClick={handleSave}
              disabled={selectedBlocks.size === 0 || !name.trim() || !operator.trim() || saving}
              loading={saving} variant="primary" className="w-full">
              <Save className="w-4 h-4 mr-2" />
              บันทึกการจัดสรร ({selectedBlocks.size} ชอง)
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
