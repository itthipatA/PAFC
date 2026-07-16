import { useState, useEffect, useCallback } from 'react'
import React from 'react'
import {
  Trash2,
  RefreshCw,
  X,
  Radio,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Shield,
  XCircle,
} from 'lucide-react'
import { Button } from './Button'
import { ScaleIn } from './AnimatePresence'
import { useAuth } from '../contexts/AuthContext'
import type { IMTAllocation } from '../types'

const PAGE_SIZE = 10

// ─── Helpers ───────────────────────────────────────────────────────────────

function polygonCentroid(coords: [number, number][]): { lat: number; lon: number } | null {
  if (!coords || coords.length === 0) return null
  let sumLat = 0, sumLon = 0
  for (const [lat, lon] of coords) {
    sumLat += lat
    sumLon += lon
  }
  return { lat: sumLat / coords.length, lon: sumLon / coords.length }
}

// ─── IMT Detail Panel (expandable row content) ────────────────────────────

function IMTDetailPanel({ alloc, onViewPolygon }: { alloc: IMTAllocation; onViewPolygon?: (polygonCoords: [number,number][], towers: {lat:number,lon:number,eirp_dbm?:number}[], centroid: {lat:number,lon:number}) => void }) {
  const SPECTRUM_START = 4800
  const SPECTRUM_END = 4990
  const BLOCK_WIDTH = 10
  const totalBlocks = (SPECTRUM_END - SPECTRUM_START) / BLOCK_WIDTH // 19

  // Build a map of which 10-MHz slots are allocated
  const slotMap: Record<number, { freq_low: number; freq_high: number; status: string }> = {}
  if (alloc.blocks) {
    alloc.blocks.forEach((b) => {
      const slotIdx = (b.freq_low - SPECTRUM_START) / BLOCK_WIDTH
      slotMap[slotIdx] = { freq_low: b.freq_low, freq_high: b.freq_high, status: b.status }
    })
  }

  const allocatedBlocks = alloc.blocks || []
  const allocatedMhz = allocatedBlocks.length * BLOCK_WIDTH
  const guardMhz = allocatedBlocks.filter((b) => b.status === 'gray' || b.status === 'guard').length * BLOCK_WIDTH
  const usableMhz = allocatedBlocks.filter((b) => b.status !== 'gray' && b.status !== 'guard').length * BLOCK_WIDTH

  function slotColor(slotIdx: number): string {
    const b = slotMap[slotIdx]
    if (!b) return '#E5E7EB' // unallocated slot — light gray
    switch (b.status) {
      case 'green':
      case 'allocated':
        return '#16A34A'
      case 'gray':
      case 'guard':
        return '#9CA3AF'
      case 'red':
      case 'blocked':
        return '#DC2626'
      default:
        return '#E5E7EB'
    }
  }

  function slotLabel(slotIdx: number): string {
    const b = slotMap[slotIdx]
    if (!b) return `${SPECTRUM_START + slotIdx * BLOCK_WIDTH}-${SPECTRUM_START + (slotIdx + 1) * BLOCK_WIDTH} MHz (ว่าง)`
    const statusText =
      b.status === 'green' || b.status === 'allocated' ? 'จัดสรร' :
      b.status === 'gray' || b.status === 'guard' ? 'Guard Band' :
      'Blocked'
    return `${b.freq_low}-${b.freq_high} MHz (${statusText})`
  }

  const statusBadge = (status: string) => {
    const s = status || 'active'
    if (s === 'active') return { bg: 'bg-green-100', text: 'text-green-700', label: 'ใช้งาน' }
    if (s === 'expired') return { bg: 'bg-red-100', text: 'text-red-700', label: 'หมดอายุ' }
    if (s === 'pending') return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'รอดำเนินการ' }
    return { bg: 'bg-gray-100', text: 'text-gray-600', label: s }
  }

  const badge = statusBadge(alloc.status)

  // Parse polygon for centroid
  let polygonCoords: [number, number][] = []
  let centroid: { lat: number; lon: number } | null = null
  if (alloc.polygon_geojson) {
    try {
      const geo = typeof alloc.polygon_geojson === 'string'
        ? JSON.parse(alloc.polygon_geojson) : alloc.polygon_geojson
      polygonCoords = (geo.coordinates?.[0] || []).map((c: number[]) => [c[0], c[1]] as [number, number])
      centroid = polygonCentroid(polygonCoords)
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-4 flex-wrap">
        <span className="font-bold text-sm text-[#1A1A2E]">
          IMT Detail: {alloc.name}
        </span>
        <span className="text-sm text-gray-600">
          Operator: <strong>{alloc.operator}</strong>
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.bg} ${badge.text}`}>
          {badge.label}
        </span>
        {alloc.frame_structure && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-mono">
            {alloc.frame_structure}
          </span>
        )}
      </div>

      {/* Spectrum Bar */}
      <div>
        <div className="text-xs font-semibold text-gray-600 mb-1">Spectrum Assignment (4800-4990 MHz)</div>
        <div className="flex h-8 rounded overflow-hidden border border-gray-300">
          {Array.from({ length: totalBlocks }, (_, i) => (
            <div
              key={i}
              title={slotLabel(i)}
              className="flex-1 relative"
              style={{
                backgroundColor: slotColor(i),
                minWidth: `${Math.max(100 / totalBlocks, 1)}%`,
                borderRight: i < totalBlocks - 1 ? '1px solid rgba(0,0,0,0.15)' : 'none',
              }}
            />
          ))}
        </div>
        {/* X-axis labels */}
        <div className="flex mt-0.5">
          {Array.from({ length: totalBlocks }, (_, i) => (
            <div key={i} className="flex-1 relative" style={{ minWidth: `${Math.max(100 / totalBlocks, 1)}%` }}>
              {((SPECTRUM_START + i * BLOCK_WIDTH) % 20 === 0 || i === 0 || i === totalBlocks - 1) && (
                <span className="absolute -left-2 text-[9px] text-gray-400 font-mono">
                  {SPECTRUM_START + i * BLOCK_WIDTH}
                </span>
              )}
              {i === totalBlocks - 1 && (
                <span className="absolute -right-1 text-[9px] text-gray-400 font-mono">
                  {SPECTRUM_END}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Block List */}
      <div>
        <div className="text-xs font-semibold text-gray-600 mb-1">
          Allocated Blocks ({allocatedBlocks.length} blocks / {allocatedMhz} MHz)
        </div>
        <div className="flex flex-wrap gap-1.5">
          {allocatedBlocks.length === 0 ? (
            <span className="text-xs text-gray-400">ไม่มีบล็อกที่จัดสรร</span>
          ) : (
            allocatedBlocks.map((b, i) => {
              const isGuard = b.status === 'gray' || b.status === 'guard'
              const isBlocked = b.status === 'red' || b.status === 'blocked'
              return (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-mono rounded border ${
                    isBlocked
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : isGuard
                      ? 'bg-gray-50 border-gray-200 text-gray-600'
                      : 'bg-green-50 border-green-200 text-green-700'
                  }`}
                >
                  {isGuard ? <Shield className="w-3 h-3" /> : isBlocked ? <XCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                  {b.freq_low}-{b.freq_high}
                  <span className="text-[10px] opacity-70">
                    ({isGuard ? 'Guard' : isBlocked ? 'Blocked' : 'OK'})
                  </span>
                </span>
              )
            })
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="flex gap-4 text-xs text-gray-600">
        <span>
          <span className="font-semibold">Allocated:</span> {allocatedMhz} MHz
        </span>
        {guardMhz > 0 && (
          <span>
            <span className="font-semibold">Guard Band:</span> {guardMhz} MHz
          </span>
        )}
        <span>
          <span className="font-semibold">Usable:</span> {usableMhz} MHz
        </span>
      </div>

      {/* Polygon/Shape Mode Info */}
      {alloc.polygon_geojson && (
        <div className="border border-gray-200 rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-gray-600">Polygon Coverage Area</div>
            {onViewPolygon && centroid && (
              <button
                onClick={() => {
                  const twRaw = (alloc as any).tower_positions
                  const towers = twRaw ? (typeof twRaw === 'string' ? JSON.parse(twRaw) : twRaw) : []
                  onViewPolygon(polygonCoords, towers, centroid!)
                }}
                className="text-[10px] px-2 py-1 bg-[#C00000] text-white rounded hover:bg-[#8B0000] transition-colors"
              >
                Show on Map
              </button>
            )}
          </div>
          <div className="text-xs text-gray-500 space-y-1">
            <div>
              Vertices: <span className="font-mono text-gray-800">{polygonCoords.length}</span>
              {centroid && (
                <span className="font-mono text-gray-800 ml-2">
                  (center: {centroid.lat.toFixed(4)}, {centroid.lon.toFixed(4)})
                </span>
              )}
            </div>
            {(alloc as any).tower_positions && (() => {
              try {
                const towers = typeof (alloc as any).tower_positions === 'string' 
                  ? JSON.parse((alloc as any).tower_positions) 
                  : (alloc as any).tower_positions
                return (
                  <div>
                    <span className="font-semibold">Base Stations:</span> {towers.length}
                    {towers.map((t: any, i: number) => (
                      <div key={i} className="ml-2 text-[10px] font-mono">
                        #{i+1}: ({t.lat?.toFixed(5)}, {t.lon?.toFixed(5)}) 
                        {t.eirp_dbm != null && ` — ${t.eirp_dbm} dBm`}
                      </div>
                    ))}
                  </div>
                )
              } catch { return <div className="text-red-400">Invalid tower data</div> }
            })()}
            {(alloc as any).network_total_eirp_dbm != null && (
              <div>Network Total EIRP: <span className="font-mono font-bold text-[#C00000]">{(alloc as any).network_total_eirp_dbm} dBm</span></div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function IMTManager({ onViewPolygon }: { onViewPolygon?: (polygonCoords: [number,number][], towers: {lat:number,lon:number,eirp_dbm?:number}[], centroid: {lat:number,lon:number}) => void }) {
  const { fetchWithAuth } = useAuth()

  const [allocations, setAllocations] = useState<IMTAllocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{id: string; name: string} | null>(null)

  const fetchAllocations = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Only show active IMTs (hide expired/soft-deleted)
      const res = await fetchWithAuth('/api/imt/?status=active')
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

  const confirmDelete = (alloc: IMTAllocation) => {
    setDeleteTarget({ id: alloc.id, name: alloc.name })
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const id = deleteTarget.id

    setDeleting(id)
    setDeleteTarget(null)
    try {
      const res = await fetchWithAuth(`/api/imt/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error('ไม่สามารถลบ IMT Allocation ได้')
      }
      fetchAllocations()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลบ')
    } finally {
      setDeleting(null)
    }
  }

  const totalPages = Math.ceil(allocations.length / PAGE_SIZE)
  const displayed = allocations.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="h-full flex flex-col bg-[#F5F5F0]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3">
          <Radio className="w-5 h-5 text-[#C00000]" />
          <h2 className="text-lg font-bold text-[#1A1A2E]">
            จัดการ IMT (International Mobile Telecommunications)
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={fetchAllocations} title="รีเฟรช">
            <RefreshCw className="w-4 h-4" />
            รีเฟรช
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            กำลังโหลดข้อมูล...
          </div>
        ) : allocations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Radio className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">ยังไม่มี IMT Allocation ในระบบ</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">ชื่อ</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">ผู้ให้บริการ</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Frame Structure</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">ช่วงคลื่น</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">วันที่สร้าง</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayed.map((alloc, index) => (
                  <React.Fragment key={alloc.id}>
                    <tr
                      className={`hover:bg-gray-50 transition-colors cursor-pointer animate-fade-in-up stagger-${Math.min(index + 1, 10)}`}
                      onClick={() => setExpandedId(expandedId === alloc.id ? null : alloc.id)}
                    >
                      <td className="px-4 py-3 font-medium text-[#1A1A2E]">
                        <span className="inline-flex items-center gap-1">
                          {expandedId === alloc.id ? (
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                          )}
                          {alloc.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{alloc.operator}</td>
                      <td className="px-4 py-3">
                        {alloc.frame_structure ? (
                          <span className="inline-block px-2 py-0.5 text-xs font-mono rounded bg-blue-100 text-blue-700 border border-blue-200">
                            {alloc.frame_structure}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {alloc.blocks && alloc.blocks.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {alloc.blocks.map((b, i) => (
                              <span
                                key={i}
                                className="inline-block px-1.5 py-0.5 text-xs font-mono rounded bg-[#C00000]/10 text-[#C00000] border border-[#C00000]/20 whitespace-nowrap"
                              >
                                {b.freq_low}-{b.freq_high}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(alloc.created_at).toLocaleDateString('th-TH')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); confirmDelete(alloc) }}
                            disabled={deleting === alloc.id}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                            title="ลบ"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === alloc.id && (
                      <tr key={`${alloc.id}-detail`}>
                        <td colSpan={6} className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                          <IMTDetailPanel alloc={alloc} onViewPolygon={onViewPolygon} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
                <span className="text-xs text-gray-500">
                  แสดง {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, allocations.length)} จาก {allocations.length} รายการ
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(0)}
                    disabled={page === 0}
                    className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-200 rounded disabled:opacity-30"
                  >
                    แรก
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-200 rounded disabled:opacity-30"
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
                          : 'text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-200 rounded disabled:opacity-30"
                  >
                    ถัดไป
                  </button>
                  <button
                    onClick={() => setPage(totalPages - 1)}
                    disabled={page >= totalPages - 1}
                    className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-200 rounded disabled:opacity-30"
                  >
                    สุดท้าย
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Delete Confirmation Modal ─── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <ScaleIn>
          <div className="relative bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md mx-4 p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#1A1A2E]">ยืนยันการลบ</h3>
                <p className="text-sm text-gray-600 mt-1">
                  แน่ใจใช่ไหมที่จะลบ <span className="font-semibold text-[#C00000]">{deleteTarget.name}</span>?
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  ข้อมูลการจัดสรรคลื่นความถี่ที่เกี่ยวข้องจะหายไป ไม่สามารถกู้คืนได้
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)} className="flex-1">
                ยกเลิก
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                loading={deleting === deleteTarget.id}
                className="flex-1"
              >
                {deleting === deleteTarget.id ? 'กำลังลบ...' : 'ลบ'}
              </Button>
            </div>
          </div>
          </ScaleIn>
        </div>
      )}
    </div>
  )
}
