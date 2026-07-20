import { useState, useEffect, useCallback, type FormEvent } from 'react'
import {
  PlusCircle,
  Pencil,
  Trash2,
  RefreshCw,
  X,
  Radio,
  ChevronDown,
  ChevronRight,
  MapPin,
} from 'lucide-react'
import { ScaleIn } from './AnimatePresence'
import { useAuth } from '../contexts/AuthContext'
import type { IMTAllocation, IMTBlock, SaveBlock } from '../types'

const PAGE_SIZE = 10

/* ── Gridgeist Design Tokens (from DESIGN.md) ────────────── */
const SPECTRUM_START = 4800
const SPECTRUM_END = 4990
const BLOCK_WIDTH = 10
const TOTAL_BLOCKS = 19

/* ── Polygon helpers ────────────────────────────────────── */
function polygonCentroid(coords: [number, number][]): { lat: number; lon: number } | null {
  if (!coords || coords.length === 0) return null
  let sumLat = 0, sumLon = 0
  for (const [lat, lon] of coords) { sumLat += lat; sumLon += lon }
  return { lat: sumLat / coords.length, lon: sumLon / coords.length }
}

function polygonAreaKm2(coords: [number, number][]): number {
  if (!coords || coords.length < 3) return 0
  let area = 0
  const n = coords.length
  for (let i = 0; i < n; i++) {
    const [lat1, lon1] = coords[i]
    const [lat2, lon2] = coords[(i + 1) % n]
    const lat1r = (lat1 * Math.PI) / 180
    const lat2r = (lat2 * Math.PI) / 180
    const lon1r = (lon1 * Math.PI) / 180
    const lon2r = (lon2 * Math.PI) / 180
    area += (lon2r - lon1r) * (2 + Math.sin(lat1r) + Math.sin(lat2r))
  }
  area = Math.abs((area * 6371000 * 6371000) / 2)
  return area / 1e6
}

function parsePolygon(geojson: any): [number, number][] {
  try {
    if (!geojson) return []
    const geo = typeof geojson === 'string' ? JSON.parse(geojson) : geojson
    // Handle Feature {type:'Feature', geometry:{type:'Polygon',coordinates:[[...]]}}
    if (geo.type === 'Feature' && geo.geometry?.coordinates) {
      return (geo.geometry.coordinates[0] || []).map((c: number[]) => [c[0], c[1]] as [number, number])
    }
    // Handle plain Polygon {type:'Polygon', coordinates:[[...]]}
    if (geo.type === 'Polygon' && geo.coordinates) {
      return (geo.coordinates[0] || []).map((c: number[]) => [c[0], c[1]] as [number, number])
    }
    return []
  } catch {
    return []
  }
}

/* ── Status badge config ───────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:  { label: 'ใช้งาน',        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    expired: { label: 'หมดอายุ',       cls: 'bg-red-50 text-red-700 border-red-200' },
    pending: { label: 'รอดำเนินการ',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    draft:   { label: 'ร่าง',          cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  }
  const m = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600 border-gray-200' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${m.cls}`}>
      {m.label}
    </span>
  )
}

/* ── Tech badge ────────────────────────────────────────── */
function TechBadge({ frameStructure }: { frameStructure: string | null }) {
  if (!frameStructure) return <span className="text-xs text-gray-400">—</span>
  const is5G = frameStructure.toLowerCase().includes('5g')
  const isLTE = frameStructure.toLowerCase().includes('lte')
  const cls = is5G
    ? 'bg-blue-50 text-blue-700 border-blue-200'
    : isLTE
      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
      : 'bg-gray-100 text-gray-600 border-gray-200'
  const label = is5G ? '5G' : isLTE ? '4G' : frameStructure
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border font-mono ${cls}`}>
      {label}
    </span>
  )
}

/* ── Field helper ──────────────────────────────────────── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-[#555555] mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputCls =
  'w-full border border-[#D4D4CC] rounded-lg px-3 py-2 text-sm ' +
  'focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none ' +
  'bg-white placeholder-gray-400'

const selectCls = inputCls

const monoInputCls = inputCls + ' font-mono'

/* ── Edit form type ───────────────────────────────────── */
interface EditForm {
  name: string
  site_owner: string
  station_type: string
  frame_structure: string
  status: string
}

const EMPTY_FORM: EditForm = {
  name: '',
  site_owner: '',
  station_type: '',
  frame_structure: '',
  status: 'active',
}

/* ── Spectrum helper ──────────────────────────────────── */
function buildSlotSet(blocks: IMTBlock[]): Set<number> {
  const set = new Set<number>()
  blocks.forEach((b) => {
    const idx = (b.freq_low - SPECTRUM_START) / BLOCK_WIDTH
    if (idx >= 0 && idx < TOTAL_BLOCKS) set.add(idx)
  })
  return set
}

/* ══════════════════════════════════════════════════════════
   IMTManager — Gridgeist redesign (TABLE layout)
   ══════════════════════════════════════════════════════════ */
export default function IMTManager({
  onViewPolygon,
  onAdd,
}: {
  onViewPolygon?: (
    polygonCoords: [number, number][],
    towers: { lat: number; lon: number; eirp_dbm?: number }[],
    centroid: { lat: number; lon: number },
  ) => void
  onAdd?: () => void
}) {
  const { fetchWithAuth } = useAuth()

  const [allocations, setAllocations] = useState<IMTAllocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EditForm>({ ...EMPTY_FORM })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editToggledSlots, setEditToggledSlots] = useState<Set<number>>(new Set())

  // Expand/collapse
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<IMTAllocation | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchAllocations = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchWithAuth('/api/imt/')
      if (!res.ok) throw new Error('ไม่สามารถโหลดรายการ IMT ได้')
      const data = await res.json()
      setAllocations(data.allocations || data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล')
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth])

  useEffect(() => {
    fetchAllocations()
  }, [fetchAllocations])

  /* ── Modal handlers ──────────────────────────────────── */
  const openEdit = (alloc: IMTAllocation) => {
    setEditingId(alloc.id)
    setForm({
      name: alloc.name,
      site_owner: alloc.site_owner,
      station_type: alloc.station_type || '',
      frame_structure: alloc.frame_structure || '',
      status: alloc.status || 'active',
    })
    setEditToggledSlots(buildSlotSet(alloc.blocks || []))
    setFormError('')
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setEditToggledSlots(new Set())
    setFormError('')
  }

  const handleFieldChange = (field: keyof EditForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const toggleSlot = (idx: number) => {
    setEditToggledSlots((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')

    if (!form.name.trim() || !form.site_owner.trim()) {
      setFormError('กรุณากรอกชื่อสถานีและชื่อผู้ให้บริการ')
      return
    }

    setSaving(true)
    try {
      const selectedBlocks: SaveBlock[] = []
      editToggledSlots.forEach((idx) => {
        selectedBlocks.push({
          freq_low: SPECTRUM_START + idx * BLOCK_WIDTH,
          freq_high: SPECTRUM_START + (idx + 1) * BLOCK_WIDTH,
          status: 'allocated',
        })
      })

      const body = {
        name: form.name.trim(),
        site_owner: form.site_owner.trim(),
        station_type: form.station_type,
        frame_structure: form.frame_structure || null,
        status: form.status,
        selected_blocks: selectedBlocks,
      }

      const res = await fetchWithAuth(`/api/imt/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: 'เกิดข้อผิดพลาด' }))
        throw new Error(detail.detail || 'ไม่สามารถบันทึกข้อมูล IMT ได้')
      }

      closeModal()
      fetchAllocations()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึก')
    } finally {
      setSaving(false)
    }
  }

  /* ── Delete handlers ─────────────────────────────────── */
  const confirmDelete = (alloc: IMTAllocation) => {
    setDeleteTarget(alloc)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetchWithAuth(`/api/imt/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('ไม่สามารถลบ IMT Allocation ได้')
      setDeleteTarget(null)
      fetchAllocations()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลบ')
    } finally {
      setDeleting(false)
    }
  }

  /* ── Expand toggle ───────────────────────────────────── */
  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  /* ── Pagination ──────────────────────────────────────── */
  const totalPages = Math.ceil(allocations.length / PAGE_SIZE)
  const displayed = allocations.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  /* ── Table cell classes ──────────────────────────────── */
  const headerRowCls =
    'text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide'
  const dataCellCls = 'px-4 py-2.5 text-sm text-[#333333]'
  const dataMonoCls = 'px-4 py-2.5 text-sm font-mono text-[#333333]'
  const actionCellCls = 'px-4 py-2.5 text-right'

  /* ── Render ──────────────────────────────────────────── */
  return (
    <div className="h-full flex flex-col bg-[#F5F5F0] font-[TH_Sarabun_New]">
      {/* ══════════ Page Header ══════════ */}
      <div className="flex items-center justify-between px-6 py-5">
        <div>
          <h2 className="text-xl font-bold text-[#1A1A2E] leading-tight">
            จัดการ IMT
          </h2>
          <p className="text-sm text-[#666666] mt-0.5">
            International Mobile Telecommunications — การจัดสรรคลื่นความถี่ 4800–4990 MHz
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAllocations}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-[#4A4A5E] hover:bg-white rounded-lg border border-transparent hover:border-[#E5E5E0] transition-colors"
            title="รีเฟรช"
          >
            <RefreshCw className="w-4 h-4" />
            รีเฟรช
          </button>
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#C00000] hover:bg-[#A00000] text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            เพิ่ม IMT
          </button>
        </div>
      </div>

      {/* ══════════ Error banner ══════════ */}
      {error && (
        <div className="mx-6 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ══════════ Content area ══════════ */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            กำลังโหลดข้อมูล...
          </div>
        ) : allocations.length === 0 ? (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Radio className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-sm font-medium text-[#666666]">ยังไม่มี IMT Allocation</p>
            <button
              onClick={onAdd}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-[#C00000] hover:bg-[#A00000] text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <PlusCircle className="w-4 h-4" />
              เพิ่ม IMT แรก
            </button>
          </div>
        ) : (
          /* ── Table ── */
          <div
            className="bg-white rounded-lg border border-[#E5E5E0] overflow-hidden"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#1A1A2E] text-white">
                    <th className={`${headerRowCls} rounded-tl-lg w-10`}></th>
                    <th className={headerRowCls}>ชื่อสถานี</th>
                    <th className={headerRowCls}>เจ้าของ/ผู้ให้บริการ</th>
                    <th className={headerRowCls}>ตำแหน่ง</th>
                    <th className={headerRowCls}>พื้นที่</th>
                    <th className={headerRowCls}>TDD Pattern</th>
                    <th className={headerRowCls}>ช่องสัญญาณ</th>
                    <th className={headerRowCls}>สถานะ</th>
                    <th className={`${headerRowCls} text-right rounded-tr-lg`}>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((alloc, i) => {
                    const polygonCoords = parsePolygon(alloc.polygon_geojson)
                    const centroid = polygonCentroid(polygonCoords)
                    const areaKm2 = polygonAreaKm2(polygonCoords)
                    const allocatedGuardCount = (alloc.blocks || []).filter(b => b.status === 'allocated' || b.status === 'guard').length
                    const isExpanded = expandedId === alloc.id
                    const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'

                    return (
                      <>
                        {/* ── Main row ── */}
                        <tr
                          key={alloc.id}
                          className={`${rowBg} hover:bg-[#F0F0F0] transition-colors border-b border-[#F0F0EC] cursor-pointer`}
                          onClick={() => toggleExpand(alloc.id)}
                        >
                          <td className="px-4 py-2.5">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-[#888888]" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-[#888888]" />
                            )}
                          </td>
                          <td className={dataCellCls}>
                            <span className="font-semibold text-[#1A1A2E]">{alloc.name}</span>
                          </td>
                          <td className={dataCellCls}>{alloc.site_owner}</td>
                          <td className={dataMonoCls}>
                            {centroid
                              ? `${centroid.lat.toFixed(4)}°, ${centroid.lon.toFixed(4)}°`
                              : '—'}
                          </td>
                          <td className={dataMonoCls}>
                            {areaKm2 > 0 ? `${areaKm2.toFixed(2)} km²` : '—'}
                          </td>
                          <td className={dataMonoCls}>
                            {alloc.frame_structure || <span className="text-gray-400">—</span>}
                          </td>
                          <td className={dataMonoCls}>
                            {allocatedGuardCount}/{TOTAL_BLOCKS}
                          </td>
                          <td className={dataCellCls}>
                            <StatusBadge status={alloc.status} />
                          </td>
                          <td className={actionCellCls}>
                            <div
                              className="flex items-center justify-end gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => openEdit(alloc)}
                                className="p-1.5 text-[#666666] hover:text-[#C00000] hover:bg-red-50 rounded transition-colors"
                                title="แก้ไข"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => confirmDelete(alloc)}
                                className="p-1.5 text-[#666666] hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="ลบ"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* ── Expand row (detail panel) ── */}
                        {isExpanded && (
                          <tr key={`${alloc.id}-expand`} className="bg-[#FAFAFB] border-b border-[#F0F0EC]">
                            <td colSpan={9} className="px-4 py-4">
                              <div className="grid grid-cols-2 gap-x-8 gap-y-3 max-w-3xl">
                                {/* ── Polygon shape + info ── */}
                                <div className="col-span-2">
                                  <span className="block text-xs font-semibold text-[#555555] mb-1">
                                    พิกัดโพลีกอน
                                  </span>
                                  {polygonCoords.length > 0 ? (
                                    <div className="flex items-start gap-3">
                                      {/* Mini shape preview */}
                                      <div className="flex-shrink-0 w-20 h-16 bg-[#E8F5E9] rounded border border-[#C8E6C9] flex items-center justify-center overflow-hidden">
                                        <svg viewBox="0 0 80 64" className="w-full h-full" style={{ transform: 'scale(0.85)' }}>
                                          <polygon
                                            points={polygonCoords.map((c, j) => {
                                              const allLats = polygonCoords.map(p => p[0])
                                              const allLons = polygonCoords.map(p => p[1])
                                              const minLat = Math.min(...allLats), maxLat = Math.max(...allLats)
                                              const minLon = Math.min(...allLons), maxLon = Math.max(...allLons)
                                              const pad = 0.1 * (maxLat - minLat || 0.01)
                                              const x = ((c[1] - minLon) / ((maxLon - minLon) || 0.01)) * 72 + 4
                                              const y = 60 - ((c[0] - minLat) / ((maxLat - minLat) || 0.01)) * 56 - 2
                                              return `${x},${y}`
                                            }).join(' ')}
                                            fill="#2E7D32" fillOpacity="0.3" stroke="#2E7D32" strokeWidth="1.5"
                                          />
                                        </svg>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-mono text-[#555555] leading-relaxed break-all">
                                          {polygonCoords.map((c, j) => (
                                            <span key={j}>
                                              [{c[0].toFixed(5)}, {c[1].toFixed(5)}]
                                              {j < polygonCoords.length - 1 ? ', ' : ''}
                                            </span>
                                          ))}
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                          <span className="text-xs text-[#999999]">
                                            {polygonCoords.length} จุด
                                          </span>
                                          {/* Download GeoJSON */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              const geo = typeof alloc.polygon_geojson === 'string'
                                                ? alloc.polygon_geojson
                                                : JSON.stringify(alloc.polygon_geojson || {type:'Polygon',coordinates:[polygonCoords.map(c => [c[1],c[0]])]}, null, 2)
                                              const blob = new Blob([geo], { type: 'application/geo+json' })
                                              const url = URL.createObjectURL(blob)
                                              const a = document.createElement('a')
                                              a.href = url
                                              a.download = `${alloc.name || 'polygon'}.geojson`
                                              a.click()
                                              URL.revokeObjectURL(url)
                                            }}
                                            className="inline-flex items-center gap-1 text-xs text-[#C00000] hover:text-[#8B0000] font-medium"
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                            download .geojson
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-gray-400">ไม่มีข้อมูล</span>
                                  )}
                                </div>

                                {/* Row 2: Frame structure + Created at */}
                                <div>
                                  <span className="block text-xs font-semibold text-[#555555] mb-1">
                                    เฟรมโครงสร้าง
                                  </span>
                                  <span className="text-sm font-mono text-[#1565C0]">
                                    {alloc.frame_structure || '—'}
                                  </span>
                                </div>
                                <div>
                                  <span className="block text-xs font-semibold text-[#555555] mb-1">
                                    สร้างเมื่อ
                                  </span>
                                  <span className="text-sm text-[#333333]">
                                    {alloc.created_at
                                      ? new Date(alloc.created_at).toLocaleString('th-TH', {
                                          year: 'numeric',
                                          month: 'short',
                                          day: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })
                                      : '—'}
                                  </span>
                                </div>

                                {/* Row 3: Spectrum blocks (compact) */}
                                {alloc.blocks && alloc.blocks.length > 0 && (
                                  <div className="col-span-2">
                                    <span className="block text-xs font-semibold text-[#555555] mb-1.5">
                                      การจัดสรรช่องสัญญาณ ({allocatedGuardCount}/{TOTAL_BLOCKS} blocks)
                                    </span>
                                    <div className="flex gap-px max-w-[600px]">
                                      {Array.from({ length: TOTAL_BLOCKS }, (_, idx) => {
                                        const freqLow = SPECTRUM_START + idx * BLOCK_WIDTH
                                        const block = (alloc.blocks || []).find(b => b.freq_low === freqLow)
                                        const status = block?.status || 'empty'
                                        let bg = '#E8E8E4'
                                        let label = 'ว่าง'
                                        if (status === 'allocated') { bg = '#2E7D32'; label = 'จัดสรรแล้ว' }
                                        else if (status === 'guard') { bg = '#F59E0B'; label = 'Guard' }
                                        return (
                                          <div
                                            key={idx}
                                            title={`${freqLow}–${SPECTRUM_START + (idx + 1) * BLOCK_WIDTH} MHz (${label})`}
                                            className="flex-1 h-6 transition-colors"
                                            style={{
                                              backgroundColor: bg,
                                              border: '1px solid #000',
                                              borderRadius: '4px',
                                              minWidth: `${Math.max(100 / TOTAL_BLOCKS, 1)}%`,
                                            }}
                                          />
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* "ดูบนแผนที่" button */}
                                {onViewPolygon && centroid && polygonCoords.length > 0 && (
                                  <div className="col-span-2 mt-1">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        const twRaw = (alloc as any).tower_positions
                                        const towers = twRaw
                                          ? typeof twRaw === 'string'
                                            ? JSON.parse(twRaw)
                                            : twRaw
                                          : []
                                        onViewPolygon(polygonCoords, towers, centroid)
                                      }}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#C00000] hover:bg-[#A00000] text-white rounded-lg transition-colors"
                                    >
                                      <MapPin className="w-3.5 h-3.5" />
                                      ดูบนแผนที่
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ── */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#E5E5E0] bg-[#FAFAFA]">
                <span className="text-xs text-[#888888]">
                  แสดง {page * PAGE_SIZE + 1}–
                  {Math.min((page + 1) * PAGE_SIZE, allocations.length)} จาก{' '}
                  {allocations.length} รายการ
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-2 py-1 text-xs text-[#666666] hover:bg-[#E5E5E0] rounded disabled:opacity-30"
                  >
                    ก่อนหน้า
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setPage(i)}
                      className={`w-7 h-7 text-xs rounded ${
                        i === page
                          ? 'bg-[#C00000] text-white'
                          : 'text-[#666666] hover:bg-[#E5E5E0]'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-2 py-1 text-xs text-[#666666] hover:bg-[#E5E5E0] rounded disabled:opacity-30"
                  >
                    ถัดไป
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══════════ Edit Modal ══════════ */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <ScaleIn>
            <div
              className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4 mt-20"
              style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E0] sticky top-0 bg-white rounded-t-xl z-10">
                <div>
                  <h3 className="text-lg font-bold text-[#1A1A2E]">
                    แก้ไข IMT Allocation
                  </h3>
                  {editingId && (
                    <p className="text-xs text-[#888888] mt-0.5 font-mono">{editingId}</p>
                  )}
                </div>
                <button
                  onClick={closeModal}
                  className="p-1.5 text-[#888888] hover:text-[#333333] hover:bg-[#F0F0F0] rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form Error */}
              {formError && (
                <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {formError}
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                {/* Basic info + Status */}
                <div>
                  <h4 className="text-sm font-semibold text-[#1A1A2E] mb-3 pb-2 border-b border-[#E5E5E0]">
                    ข้อมูลทั่วไป
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="ชื่อสถานี *">
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => handleFieldChange('name', e.target.value)}
                        placeholder="เช่น BKK-IMT-01"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="เจ้าของ/ผู้ให้บริการ *">
                      <input
                        type="text"
                        value={form.site_owner}
                        onChange={(e) => handleFieldChange('site_owner', e.target.value)}
                        placeholder="เช่น AIS, True, NT"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <Field label="ประเภท">
                      <select
                        value={form.station_type}
                        onChange={(e) => handleFieldChange('station_type', e.target.value)}
                        className={selectCls}
                      >
                        <option value="">-- เลือกประเภท --</option>
                        <option value="MNO">MNO</option>
                        <option value="PNO">PNO</option>
                        <option value="Enterprise">Enterprise</option>
                      </select>
                    </Field>
                    <Field label="เทคโนโลยี (Frame Structure)">
                      <select
                        value={form.frame_structure}
                        onChange={(e) => handleFieldChange('frame_structure', e.target.value)}
                        className={selectCls}
                      >
                        <option value="">— ไม่ระบุ —</option>
                        <option value="5G NR TDD (2.5 ms)">5G NR TDD (2.5 ms)</option>
                        <option value="5G NR TDD (5 ms)">5G NR TDD (5 ms)</option>
                        <option value="LTE TDD (5 ms)">LTE TDD (5 ms)</option>
                        <option value="LTE FDD">LTE FDD</option>
                      </select>
                    </Field>
                    <Field label="สถานะ">
                      <select
                        value={form.status}
                        onChange={(e) => handleFieldChange('status', e.target.value)}
                        className={selectCls}
                      >
                        <option value="active">ใช้งาน (Active)</option>
                        <option value="expired">หมดอายุ (Expired)</option>
                        <option value="pending">รอดำเนินการ (Pending)</option>
                        <option value="draft">ร่าง (Draft)</option>
                      </select>
                    </Field>
                  </div>
                </div>

                {/* Spectrum Blocks */}
                <div>
                  <h4 className="text-sm font-semibold text-[#1A1A2E] mb-3 pb-2 border-b border-[#E5E5E0]">
                    การจัดสรรช่องสัญญาณ
                  </h4>
                  <p className="text-xs text-[#888888] mb-3">
                    คลิกที่บล็อกเพื่อเลือก/ยกเลิกช่องสัญญาณ (เลือกแล้ว {editToggledSlots.size}/{TOTAL_BLOCKS} blocks)
                  </p>
                  <div className="flex gap-px">
                    {Array.from({ length: TOTAL_BLOCKS }, (_, idx) => {
                      const isSelected = editToggledSlots.has(idx)
                      const freqLow = SPECTRUM_START + idx * BLOCK_WIDTH
                      const freqHigh = freqLow + BLOCK_WIDTH
                      return (
                        <div
                          key={idx}
                          title={`${freqLow}–${freqHigh} MHz${isSelected ? ' (เลือกแล้ว)' : ''}`}
                          onClick={() => toggleSlot(idx)}
                          className="flex-1 h-10 transition-colors cursor-pointer"
                          style={{
                            backgroundColor: isSelected ? '#2E7D32' : '#E8E8E4',
                            border: '1px solid #000',
                            borderRadius: '4px',
                            minWidth: `${Math.max(100 / TOTAL_BLOCKS, 1)}%`,
                          }}
                        />
                      )
                    })}
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E5E5E0]">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-sm text-[#4A4A5E] hover:bg-[#F0F0F0] rounded-lg transition-colors"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2 bg-[#C00000] hover:bg-[#A00000] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
                  >
                    {saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
                  </button>
                </div>
              </form>
            </div>
          </ScaleIn>
        </div>
      )}

      {/* ══════════ Delete Confirmation Dialog ══════════ */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div
            className="bg-white rounded-lg w-full max-w-sm mx-4 p-6"
            style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}
          >
            <h3 className="text-lg font-bold text-[#1A1A2E]">ยืนยันการลบ</h3>
            <p className="mt-2 text-sm text-[#666666]">
              คุณต้องการลบ IMT Allocation{' '}
              <span className="font-semibold text-[#1A1A2E]">{deleteTarget.name}</span>{' '}
              หรือไม่? การดำเนินการนี้ไม่สามารถเรียกคืนได้
            </p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-[#4A4A5E] hover:bg-[#F0F0F0] rounded-lg transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-[#C00000] hover:bg-[#A00000] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
              >
                {deleting ? 'กำลังลบ...' : 'ลบ IMT Allocation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
