import { useState, useEffect, useCallback, type FormEvent } from 'react'
import {
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  X,
  Map,
} from 'lucide-react'
import { Button } from './Button'
import { ScaleIn } from './AnimatePresence'
import { useAuth } from '../contexts/AuthContext'
import type { FSLink, FSLinkCreate } from '../types'

const PAGE_SIZE = 10

const EMPTY_FORM: FSLinkCreate = {
  name: '',
  operator: '',
  tx_lat: 13.7563,
  tx_lon: 100.5018,
  tx_altitude: 30,
  rx_lat: 13.7363,
  rx_lon: 100.4818,
  rx_altitude: 10,
  freq_low: 4800,
  freq_high: 4810,
  bandwidth: 10,
  tx_power: 20,
  tx_antenna_gain: 30,
  rx_antenna_gain: 30,
  azimuth: 0,
  beamwidth_deg: 3.0,
  polarization: 'V',
  status: 'active',
}

export default function FSLinkManager() {
  const { fetchWithAuth } = useAuth()

  const [links, setLinks] = useState<FSLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FSLinkCreate>({ ...EMPTY_FORM })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchLinks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchWithAuth('/api/fs-links/')
      if (!res.ok) throw new Error('ไม่สามารถโหลดรายการ FS Link ได')
      const data = await res.json()
      setLinks(data.links || data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล')
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth])

  useEffect(() => {
    fetchLinks()
  }, [fetchLinks])

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setFormError('')
    setShowModal(true)
  }

  const openEdit = (link: FSLink) => {
    setEditingId(link.id)
    setForm({
      name: link.name,
      operator: link.operator,
      tx_lat: link.tx.lat,
      tx_lon: link.tx.lon,
      tx_altitude: link.tx.altitude,
      rx_lat: link.rx.lat,
      rx_lon: link.rx.lon,
      rx_altitude: link.rx.altitude,
      freq_low: link.frequency.low,
      freq_high: link.frequency.high,
      bandwidth: link.frequency.bandwidth,
      tx_power: link.rf.tx_power,
      tx_antenna_gain: link.rf.tx_antenna_gain,
      rx_antenna_gain: link.rf.rx_antenna_gain,
      azimuth: link.rf.azimuth,
      beamwidth_deg: link.rf.beamwidth_deg,
      polarization: link.rf.polarization,
      status: link.status,
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

  const handleFieldChange = (field: keyof FSLinkCreate, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')

    if (!form.name.trim() || !form.operator.trim()) {
      setFormError('กรุณากรอกชื่อ FS Link และชื่อผู้ใหบริการ')
      return
    }

    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        operator: form.operator.trim(),
        tx: { lat: form.tx_lat, lon: form.tx_lon, altitude: form.tx_altitude },
        rx: { lat: form.rx_lat, lon: form.rx_lon, altitude: form.rx_altitude },
        frequency: { low: form.freq_low, high: form.freq_high, bandwidth: form.bandwidth },
        rf: {
          tx_power: form.tx_power,
          tx_antenna_gain: form.tx_antenna_gain,
          rx_antenna_gain: form.rx_antenna_gain,
          azimuth: form.azimuth,
          beamwidth_deg: form.beamwidth_deg,
          polarization: form.polarization,
        },
        status: form.status,
      }

      let res: Response
      if (editingId) {
        res = await fetchWithAuth(`/api/fs-links/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      } else {
        res = await fetchWithAuth('/api/fs-links/', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      }

      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: 'เกิดข้อผิดพลาด' }))
        throw new Error(detail.detail || 'ไม่สามารถบันทึกข้อมูล FS Link ได')
      }

      closeModal()
      fetchLinks()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึก')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('คุณแนใจตองการลบ FS Link รายการนี้หรือไม่')) return

    setDeleting(id)
    try {
      const res = await fetchWithAuth(`/api/fs-links/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error('ไม่สามารถลบ FS Link ได')
      }
      fetchLinks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลบ')
    } finally {
      setDeleting(null)
    }
  }

  const totalPages = Math.ceil(links.length / PAGE_SIZE)
  const displayed = links.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="h-full flex flex-col bg-[#F5F5F0]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3">
          <Map className="w-5 h-5 text-[#C00000]" />
          <h2 className="text-lg font-bold text-[#1A1A2E]">
            จัดการ FS Link (Fixed Service Links)
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={fetchLinks} title="รีเฟรช">
            <RefreshCw className="w-4 h-4" />
            รีเฟรช
          </Button>
          <Button variant="primary" onClick={openCreate}>
            เพิ่ม FS Link
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
        ) : links.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Map className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">ยังไม่มี FS Link ในระบบ</p>
            <button
              onClick={openCreate}
              className="mt-3 text-[#C00000] hover:underline text-sm font-medium"
            >
              เพิ่ม FS Link แรก
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">ชื่อ FS Link</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">ผู้ให้บริการ</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">ความถี่ (MHz)</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">ตำแหน่งส่ง (TX)</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">ตำแหน่งรับ (RX)</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">สถานะ</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayed.map((link, index) => (
                  <tr key={link.id} className={`hover:bg-gray-50 transition-colors animate-fade-in-up stagger-${Math.min(index + 1, 10)}`}>
                    <td className="px-4 py-3 font-medium text-[#1A1A2E]">{link.name}</td>
                    <td className="px-4 py-3 text-gray-600">{link.operator}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {link.frequency.low}-{link.frequency.high}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {link.tx.lat.toFixed(4)}, {link.tx.lon.toFixed(4)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {link.rx.lat.toFixed(4)}, {link.rx.lon.toFixed(4)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          link.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {link.status === 'active' ? 'ใช้งาน' : link.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(link)}
                          className="p-1.5 text-gray-400 hover:text-[#C00000] hover:bg-red-50 rounded transition-colors"
                          title="แก้ไข"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(link.id)}
                          disabled={deleting === link.id}
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
                  แสดง {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, links.length)} จาก {links.length} รายการ
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
                    สุดทาย
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
          <ScaleIn>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-xl">
              <div className="flex items-center gap-2">
                <Map className="w-5 h-5 text-[#C00000]" />
                <h3 className="text-lg font-bold text-[#1A1A2E]">
                  {editingId ? 'แก้ไข FS Link' : 'เพิ่ม FS Link ใหม'}
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
                      ชื่อ FS Link *
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => handleFieldChange('name', e.target.value)}
                      placeholder="เชน BKK-CNX Link 1"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      ผูใหบริการ *
                    </label>
                    <input
                      type="text"
                      value={form.operator}
                      onChange={(e) => handleFieldChange('operator', e.target.value)}
                      placeholder="เชน NT, AIS, True"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    สถานะ
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) => handleFieldChange('status', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                  >
                    <option value="active">ใช้งาน (active)</option>
                    <option value="pending">รอดำเนินการ (pending)</option>
                    <option value="inactive">ไม่ใช้งาน (inactive)</option>
                  </select>
                </div>
              </div>

              {/* Frequency */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-100">
                  ความถี่
                </h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      ความถี่ต่ำสุด (MHz)
                    </label>
                    <input
                      type="number"
                      value={form.freq_low}
                      onChange={(e) => handleFieldChange('freq_low', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      ความถี่สูงสุด (MHz)
                    </label>
                    <input
                      type="number"
                      value={form.freq_high}
                      onChange={(e) => handleFieldChange('freq_high', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Bandwidth (MHz)
                    </label>
                    <input
                      type="number"
                      value={form.bandwidth}
                      onChange={(e) => handleFieldChange('bandwidth', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* TX Location */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-100">
                  ตำแหนงสงสัญญาณ (TX)
                </h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={form.tx_lat}
                      onChange={(e) => handleFieldChange('tx_lat', Number(e.target.value))}
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
                      value={form.tx_lon}
                      onChange={(e) => handleFieldChange('tx_lon', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Altitude (m)
                    </label>
                    <input
                      type="number"
                      value={form.tx_altitude}
                      onChange={(e) => handleFieldChange('tx_altitude', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* RX Location */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-100">
                  ตำแหนงรับสัญญาณ (RX)
                </h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={form.rx_lat}
                      onChange={(e) => handleFieldChange('rx_lat', Number(e.target.value))}
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
                      value={form.rx_lon}
                      onChange={(e) => handleFieldChange('rx_lon', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Altitude (m)
                    </label>
                    <input
                      type="number"
                      value={form.rx_altitude}
                      onChange={(e) => handleFieldChange('rx_altitude', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* RF Parameters */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-100">
                  พารามิเตอร RF
                </h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      TX Power (dBm)
                    </label>
                    <input
                      type="number"
                      value={form.tx_power}
                      onChange={(e) => handleFieldChange('tx_power', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      TX Antenna Gain (dBi)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={form.tx_antenna_gain}
                      onChange={(e) =>
                        handleFieldChange('tx_antenna_gain', Number(e.target.value))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      RX Antenna Gain (dBi)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={form.rx_antenna_gain}
                      onChange={(e) =>
                        handleFieldChange('rx_antenna_gain', Number(e.target.value))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 mt-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Azimuth (องศา)
                    </label>
                    <input
                      type="number"
                      value={form.azimuth}
                      onChange={(e) => handleFieldChange('azimuth', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Beamwidth (deg)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={form.beamwidth_deg}
                      onChange={(e) => handleFieldChange('beamwidth_deg', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Polarization
                    </label>
                    <select
                      value={form.polarization}
                      onChange={(e) => handleFieldChange('polarization', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
                    >
                      <option value="V">V (Vertical)</option>
                      <option value="H">H (Horizontal)</option>
                      <option value="VH">V/H (Dual)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-[#C00000] hover:bg-[#8B0000] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 shadow-sm shadow-[#C00000]/20"
                >
                  {saving
                    ? 'กำลังบันทึก...'
                    : editingId
                      ? 'บันทึกการแกไข'
                      : 'เพิ่ม FS Link'}
                </button>
              </div>
            </form>
          </div>
          </ScaleIn>
        </div>
      )}
    </div>
  )
}
