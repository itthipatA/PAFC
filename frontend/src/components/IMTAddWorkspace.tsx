import React, { useState, useRef, useMemo, useCallback } from 'react'
import { Upload, AlertTriangle, MapPin, Save, Search, ChevronDown, ChevronUp } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import type { HighlightStation } from './MapView'
import type { AvailabilityResponse } from '../types'
import { MiniMap } from './MiniMap'
import { Button } from './Button'

interface IMTAddWorkspaceProps {
  onBack: () => void
  mode?: 'full' | 'panel'
  onPlotPolygon?: (vertices: [number, number][]) => void
  onCentroidUpdate?: (c: { lat: number; lon: number } | null) => void
  onShowStations?: (stations: HighlightStation[]) => void
}

// ─── Status color lookup ──────────────────────────────────────
const STATUS_META: Record<string, { bg: string; label: string }> = {
  available: { bg: '#16A34A', label: 'วาง' },
  blocked_by_pn: { bg: '#DC2626', label: 'ติด PN' },
  blocked_by_fs: { bg: '#F59E0B', label: 'ติด FS (LoS)' },
}

// ─── Parse GeoJSON and extract vertices ───────────────────────
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
    return { vertices: [], geojson: null, error: 'ไมสามารถอานไฟล GeoJSON ได กรุณาตรวจสอบรูปแบบไฟล' }
  }
}

// ─── Component ────────────────────────────────────────────────
export default function IMTAddWorkspace({
  onBack,
  mode = 'full',
  onPlotPolygon,
  onCentroidUpdate,
  onShowStations,
}: IMTAddWorkspaceProps) {
  const { fetchWithAuth } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── State ──
  const [geojsonData, setGeojsonData] = useState<any>(null)
  const [polygonVertices, setPolygonVertices] = useState<[number, number][]>([])
  const [polygonAreaKm2, setPolygonAreaKm2] = useState<number | null>(null)
  const [centroid, setCentroid] = useState<{ lat: number; lon: number } | null>(null)
  const [name, setName] = useState('')
  const [operator, setOperator] = useState('')
  const [availabilityResult, setAvailabilityResult] = useState<AvailabilityResponse | null>(null)
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // ── Block key helper ──
  const blockKey = (freqLow: number, freqHigh: number) => `${freqLow}-${freqHigh}`

  // ── Handle file upload ──
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setUploadError(null)
      setError(null)

      const text = await file.text()
      const parsed = parseGeoJSONFile(text)

      if (parsed.error) {
        setUploadError(parsed.error)
        return
      }

      setPolygonVertices(parsed.vertices)
      setGeojsonData(parsed.geojson)

      // Update map
      onPlotPolygon?.(parsed.vertices)

      // Call pack-circles to get centroid and area
      try {
        const resp = await fetchWithAuth('/api/polygon/pack-circles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            polygon: parsed.geojson.type === 'Polygon'
              ? parsed.geojson
              : parsed.geojson.geometry
              ? parsed.geojson.geometry
              : { type: 'Polygon', coordinates: [parsed.vertices.map((v: [number, number]) => [...v])] },
            cell_radius_m: 0,
            animate: false,
          }),
        })

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}))
          throw new Error(errData.detail || 'pack-circles failed')
        }

        const packData = await resp.json()
        const c = packData.centroid
        if (c?.lat && c?.lon) {
          setCentroid({ lat: c.lat, lon: c.lon })
          onCentroidUpdate?.({ lat: c.lat, lon: c.lon })
        }

        // Store area (backend may not return in pack-circles; we'll get it from check-availability later)
        setPolygonAreaKm2(null)
      } catch (err: any) {
        console.error('pack-circles error:', err)
        // Non-fatal: we can still proceed, just won't have centroid
      } finally {
        // Reset file input so same file can be re-uploaded
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [fetchWithAuth, onPlotPolygon, onCentroidUpdate],
  )

  // ── Check availability ──
  const handleCheckAvailability = useCallback(async () => {
    if (!geojsonData) return

    setLoading(true)
    setError(null)
    setAvailabilityResult(null)
    setSelectedBlocks(new Set())

    try {
      const resp = await fetchWithAuth('/api/allocate/check-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ polygon_geojson: geojsonData }),
      })

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.detail || 'การตรวจสอบลมเหลว')
      }

      const data: AvailabilityResponse = await resp.json()
      setAvailabilityResult(data)

      if (data.polygon_area_km2 != null) {
        setPolygonAreaKm2(data.polygon_area_km2)
      }

      // Auto-select all available blocks
      const availableKeys = new Set<string>()
      data.blocks.forEach((b) => {
        if (b.status === 'available') {
          availableKeys.add(blockKey(b.freq_low, b.freq_high))
        }
      })
      setSelectedBlocks(availableKeys)
    } catch (err: any) {
      setError(err.message || 'เกิดขอผิดพลาดในการตรวจสอบ')
    } finally {
      setLoading(false)
    }
  }, [geojsonData, fetchWithAuth])

  // ── Toggle block selection ──
  const toggleBlock = useCallback((key: string) => {
    setSelectedBlocks((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  // ── Toggle block detail expansion ──
  const toggleExpand = useCallback((key: string) => {
    setExpandedBlock((prev) => (prev === key ? null : key))
  }, [])

  // ── Save allocation ──
  const handleSave = useCallback(async () => {
    if (!geojsonData || selectedBlocks.size === 0) return

    setSaving(true)
    setError(null)

    const blocksToSave = Array.from(selectedBlocks).map((key) => {
      const [lo, hi] = key.split('-').map(Number)
      return { freq_low: lo, freq_high: hi }
    })

    try {
      const resp = await fetchWithAuth('/api/allocate/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          operator: operator.trim(),
          polygon_geojson: geojsonData,
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
  }, [geojsonData, selectedBlocks, name, operator, fetchWithAuth, onBack])

  // ── Count results by status ──
  const counts = useMemo(() => {
    if (!availabilityResult) return { available: 0, blockedPN: 0, blockedFS: 0 }
    const byStatus: Record<string, number> = { available: 0, blocked_by_pn: 0, blocked_by_fs: 0 }
    availabilityResult.blocks.forEach((b) => {
      byStatus[b.status] = (byStatus[b.status] || 0) + 1
    })
    return {
      available: byStatus.available,
      blockedPN: byStatus.blocked_by_pn || 0,
      blockedFS: byStatus.blocked_by_fs || 0,
    }
  }, [availabilityResult])

  // ── Slide animation class ──
  const containerClass =
    mode === 'panel'
      ? 'h-full animate-slide-in-right'
      : 'w-[480px] h-full bg-[#F5F5F0] border-r border-gray-200 animate-slide-in-right overflow-y-auto'

  // ── MiniMap defaults for shape-only mode ──
  const miniMapLat = centroid?.lat ?? 13.7563
  const miniMapLon = centroid?.lon ?? 100.5018

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-gray-500 hover:text-gray-700 p-1 rounded hover:bg-gray-100 transition-colors"
            title="กลับ"
          >
            <ChevronDown className="w-5 h-5 rotate-90" />
          </button>
          <h2 className="text-base font-semibold text-gray-900">เพิ่มสถานี IMT (Shape)</h2>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* ─── 1. Polygon Upload Section ─── */}
        <section className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">พื้นที่ใหบริการ</h3>

          {/* File input */}
          <div className="mb-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".geojson,.json"
              onChange={handleFileUpload}
              className="hidden"
              id="geojson-upload"
            />
            <label
              htmlFor="geojson-upload"
              className="flex items-center justify-center gap-2 w-full px-4 py-6 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-[#C00000] hover:bg-red-50/30 transition-colors"
            >
              <Upload className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-600">
                {polygonVertices.length > 0 ? 'เปลี่ยนไฟล GeoJSON' : 'อัพโหลดไฟล GeoJSON (.geojson)'}
              </span>
            </label>
          </div>

          {uploadError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}

          {/* Polygon preview */}
          {polygonVertices.length > 0 && (
            <>
              <div className="h-[200px] rounded-lg overflow-hidden border border-gray-200 mb-3">
                <MiniMap
                  lat={miniMapLat}
                  lon={miniMapLon}
                  radius={100}
                  antennaType="omni"
                  polygonVertices={polygonVertices}
                  className="w-full h-full"
                />
              </div>

              <div className="flex items-center gap-2 text-sm text-gray-600">
                <MapPin className="w-4 h-4 text-[#C00000]" />
                <span>{polygonVertices.length} จุด</span>
                {polygonAreaKm2 != null && (
                  <>
                    <span className="text-gray-300">|</span>
                    <span>{polygonAreaKm2.toFixed(2)} km{'\u00B2'}</span>
                  </>
                )}
              </div>
            </>
          )}
        </section>

        {/* ─── 2. Station Info ─── */}
        <section className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">ขอมูลสถานี</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ชื่อสถานี</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เชน โรงงาน กทม."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ผูใหบริการ</label>
              <input
                type="text"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                placeholder="เชน บริษัท เอกชน จำกัด"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000]"
              />
            </div>
          </div>
        </section>

        {/* ─── 3. Check Availability Button ─── */}
        <Button
          onClick={handleCheckAvailability}
          disabled={!geojsonData || loading}
          loading={loading}
          className="w-full bg-[#C00000] hover:bg-[#A00000] text-white font-semibold py-3 rounded-lg"
        >
          {loading ? (
            <>
              <Search className="w-4 h-4 mr-2" />
              กำลังตรวจสอบ...
            </>
          ) : (
            <>
              <Search className="w-4 h-4 mr-2" />
              ตรวจสอบความวางของคลื่นความถี่
            </>
          )}
        </Button>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ─── 4. Results ─── */}
        {availabilityResult && (
          <section className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">ผลการตรวจสอบ</h3>

            {/* Summary */}
            <div className="bg-[#F5F5F0] rounded-lg p-3 mb-4">
              <p className="text-xs text-gray-700 leading-relaxed">{availabilityResult.summary}</p>
            </div>

            {/* Detail stats */}
            <div className="grid grid-cols-3 gap-2 mb-4 text-center">
              <div className="bg-green-50 rounded-lg p-2 border border-green-200">
                <div className="text-lg font-bold text-green-700">{counts.available}</div>
                <div className="text-[10px] text-green-600">วาง</div>
              </div>
              <div className="bg-red-50 rounded-lg p-2 border border-red-200">
                <div className="text-lg font-bold text-red-700">{counts.blockedPN}</div>
                <div className="text-[10px] text-red-600">ติด PN</div>
              </div>
              <div className="bg-orange-50 rounded-lg p-2 border border-orange-200">
                <div className="text-lg font-bold text-orange-700">{counts.blockedFS}</div>
                <div className="text-[10px] text-orange-600">ติด FS (LoS)</div>
              </div>
            </div>

            {/* Channel block grid */}
            <div className="grid grid-cols-5 gap-1.5 mb-4">
              {availabilityResult.blocks.map((block) => {
                const meta = STATUS_META[block.status] || STATUS_META.available
                const key = blockKey(block.freq_low, block.freq_high)
                const isSelected = selectedBlocks.has(key)
                const isExpanded = expandedBlock === key

                return (
                  <div key={key}>
                    <button
                      onClick={() => toggleExpand(key)}
                      className="w-full text-left"
                      style={{
                        backgroundColor: meta.bg,
                        color: '#FFFFFF',
                        border: '1px solid #000',
                        borderRadius: '4px',
                        padding: '4px 6px',
                        fontSize: '10px',
                        lineHeight: '1.3',
                        opacity: isSelected || block.status !== 'available' ? 1 : 0.45,
                        cursor: 'pointer',
                        transition: 'opacity 0.15s',
                      }}
                      title={block.reason}
                    >
                      <div className="font-mono font-bold">
                        {block.freq_low}-{block.freq_high} MHz
                      </div>
                      <div>{meta.label}</div>
                      {isExpanded && <ChevronUp className="w-3 h-3 ml-auto mt-0.5" />}
                      {!isExpanded && <ChevronDown className="w-3 h-3 ml-auto mt-0.5" />}
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="mt-1 p-2 bg-gray-50 rounded border border-gray-200 text-xs text-gray-700">
                        <p className="mb-1">{block.reason}</p>
                        {block.blocked_by && block.blocked_by.length > 0 && (
                          <div>
                            <span className="font-semibold">ถูกบล็อกโดย:</span>
                            <ul className="list-disc list-inside mt-0.5">
                              {block.blocked_by.map((item, i) => (
                                <li key={i}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {block.status === 'available' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleBlock(key)
                            }}
                            className={`mt-1 px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                              isSelected
                                ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                : 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100'
                            }`}
                          >
                            {isSelected ? 'ยกเลิกการเลือก' : 'เลือกชองนี้'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#16A34A', border: '1px solid #000' }} />
                <span>วาง</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#DC2626', border: '1px solid #000' }} />
                <span>ติด PN</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#F59E0B', border: '1px solid #000' }} />
                <span>ติด FS (LoS)</span>
              </div>
            </div>
          </section>
        )}

        {/* ─── 5. Save Button ─── */}
        {availabilityResult && (
          <Button
            onClick={handleSave}
            disabled={selectedBlocks.size === 0 || !name.trim() || !operator.trim() || saving}
            loading={saving}
            variant="primary"
            className="w-full"
          >
            <Save className="w-4 h-4 mr-2" />
            บันทึกการจัดสรร ({selectedBlocks.size} ชอง)
          </Button>
        )}
      </div>
    </div>
  )
}
