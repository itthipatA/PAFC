import { useState, useEffect, useCallback, type FormEvent } from 'react'
import {
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  X,
  Radio,
  PlusCircle,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import type { IMTAllocation, IMTAllocationCreate } from '../types'

const PAGE_SIZE = 10

const EMPTY_FORM: IMTAllocationCreate = {
  name: '',
  operator: '',
  center_lat: 13.7563,
  center_lon: 100.5018,
  cell_radius: 500,
  antenna_height: 15,
  antenna_gain: 12,
  max_eirp: 23,
}

export default function IMTManager({ onAddWorkspace }: { onAddWorkspace: () => void }) {
  const { fetchWithAuth } = useAuth()

  const [allocations, setAllocations] = useState<IMTAllocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<IMTAllocationCreate>({ ...EMPTY_FORM })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

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

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setFormError('')
    setShowModal(true)
  }

  const openEdit = (alloc: IMTAllocation) => {
    setEditingId(alloc.id)
    setForm({
      name: alloc.name,
      operator: alloc.operator,
      center_lat: alloc.center_lat,
      center_lon: alloc.center_lon,
      cell_radius: alloc.cell_radius,
      antenna_height: alloc.antenna_height,
      antenna_gain: alloc.antenna_gain,
      max_eirp: alloc.max_eirp,
    })
    setFormError('')
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setFormError('')
  }

  const handleFieldChange = (field: keyof IMTAllocationCreate, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')

    if (!form.name.trim() || !form.operator.trim()) {
      setFormError('กรุณากรอกชื่อสถานีและชื่อผู้ให้บริการ')
      return
    }

    setSaving(true)
    try {
      let res: Response
      if (editingId) {
        res = await fetchWithAuth(`/api/imt/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        })
      } else {
        res = await fetchWithAuth('/api/imt/', {
          method: 'POST',
          body: JSON.stringify(form),
        })
      }

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

  const handleDelete = async (id: string) => {
    if (!confirm('คุณแน่ใจต้องการลบ IMT Allocation รายการนี้หรือไม่')) return

    setDeleting(id)
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
          <button
            onClick={fetchAllocations}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="รีเฟรช"
          >
            <RefreshCw className="w-4 h-4" />
            รีเฟรช
          </button>
          <button
            onClick={onAddWorkspace}
            className="flex items-center gap-1.5 bg-[#C00000] hover:bg-[#8B0000] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
          >
            <PlusCircle className="w-4 h-4" />
            เพิ่ม IMT
          </button>
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
            <button
              onClick={openCreate}
              className="mt-3 text-[#C00000] hover:underline text-sm font-medium"
            >
              เพิ่ม IMT แรก
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">ชื่อ</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">ผู้ให้บริการ</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">ตำแหน่ง</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">รัศมี (m)</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">เสาอากาศ (m)</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">กำลังส่ง (dBm)</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">วันที่สร้าง</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayed.map((alloc) => (
                  <tr key={alloc.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-[#1A1A2E]">{alloc.name}</td>
                    <td className="px-4 py-3 text-gray-600">{alloc.operator}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {alloc.center_lat.toFixed(4)}, {alloc.center_lon.toFixed(4)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{alloc.cell_radius}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{alloc.antenna_height}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{alloc.max_eirp}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(alloc.created_at).toLocaleDateString('th-TH')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(alloc)}
                          className="p-1.5 text-gray-400 hover:text-[#C00000] hover:bg-red-50 rounded transition-colors"
                          title="แก้ไข"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(alloc.id)}
                          disabled={deleting === alloc.id}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                          title="ลบ"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
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

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-xl">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-[#C00000]" />
                <h3 className="text-lg font-bold text-[#1A1A2E]">
                  {editingId ? 'แก้ไข IMT Allocation' : 'เพิ่ม IMT Allocation ใหม่'}
                </h3>
              </div>
              <button
                onClick={closeModal}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
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
              {/* Basic info */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-100">
                  ข้อมูลทั่วไป
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      ชื่อสถานี *
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => handleFieldChange('name', e.target.value)}
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
                      value={form.operator}
                      onChange={(e) => handleFieldChange('operator', e.target.value)}
                      placeholder="เช่น NT, AIS, True"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Location */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-100">
                  ตำแหน่ง
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={form.center_lat}
                      onChange={(e) => handleFieldChange('center_lat', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Longitude
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={form.center_lon}
                      onChange={(e) => handleFieldChange('center_lon', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Radio params */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-100">
                  พารามิเตอร์วิทยุ
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      รัศมีเซลล์ (m)
                    </label>
                    <input
                      type="number"
                      value={form.cell_radius}
                      onChange={(e) => handleFieldChange('cell_radius', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      ความสูงเสาอากาศ (m)
                    </label>
                    <input
                      type="number"
                      value={form.antenna_height}
                      onChange={(e) => handleFieldChange('antenna_height', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Antenna Gain (dBi)
                    </label>
                    <input
                      type="number"
                      value={form.antenna_gain}
                      onChange={(e) => handleFieldChange('antenna_gain', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Max EIRP (dBm)
                    </label>
                    <input
                      type="number"
                      value={form.max_eirp}
                      onChange={(e) => handleFieldChange('max_eirp', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-[#C00000] hover:bg-[#8B0000] text-white font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {saving ? 'กำลังบันทึก...' : editingId ? 'บันทึกการแก้ไข' : 'เพิ่ม IMT'}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-6 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors"
                >
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
