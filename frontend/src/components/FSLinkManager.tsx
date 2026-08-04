import { useState, useEffect, useCallback, useMemo, Fragment, type FormEvent } from 'react'
import {
  PlusCircle,
  Pencil,
  Trash2,
  RefreshCw,
  X,
  Radio,
} from 'lucide-react'
import { ScaleIn } from './AnimatePresence'
import { useAuth } from '../contexts/AuthContext'
import type { FSLink, FSLinkCreate } from '../types'

const PAGE_SIZE = 10

/* ── Haversine distance (km) ───────────────────────────── */
function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

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

/* ── Status badge config ───────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:   { label: 'ใช้งาน',       cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    pending:  { label: 'รอดำเนินการ',   cls: 'bg-gray-100 text-gray-600 border-gray-200' },
    inactive: { label: 'ไม่ใช้งาน',     cls: 'bg-red-50 text-red-700 border-red-200' },
  }
  const m = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600 border-gray-200' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${m.cls}`}>
      {m.label}
    </span>
  )
}

/* ── Station row (pair view — แนวทาง B) ───────────────────── */

function shortAddr(code: string, addr: string | null | undefined): string {
  if (!addr) return '—'
  let a = addr.replace(/^[A-Z0-9]+ ?: ?/, '')  // strip leading station code
  a = a.replace(/ \| /g, ' · ')
  return a.length > 64 ? `${a.slice(0, 62)}…` : a
}

function StationRow({
  code,
  side,
  address,
  lat,
  lon,
  azimuth,
  height,
  hub,
  band,
}: {
  code: string
  side: 'TX' | 'RX'
  address: string
  lat: number
  lon: number
  azimuth: number
  height: number | null
  hub: boolean
  band: string
}) {
  return (
    <tr className={`${band} bg-white border-b border-[#F0F0EC] hover:bg-[#F8F8F5]`}>
      <td className="px-4 py-2.5">
        <span className="font-semibold text-[#1A1A2E]">{code}</span>
        {hub && (
          <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#FFDAD6] text-[#C00000]">
            hub
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${side === 'TX' ? 'bg-[#1A1A2E] text-white' : 'bg-[#C00000] text-white'}`}>
          {side}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs text-[#666666] max-w-[300px]">{address}</td>
      <td className="px-4 py-2.5 text-xs font-mono text-[#333333]">
        {lat.toFixed(5)}, {lon.toFixed(5)}
      </td>
      <td className="px-4 py-2.5 text-xs font-mono text-[#333333]">{azimuth.toFixed(1)}°</td>
      <td className="px-4 py-2.5 text-xs text-[#333333]">{height != null ? `${height} ม.` : '—'}</td>
    </tr>
  )
}

/* ── Field helper ──────────────────────────────────────── */
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[#555555] mb-1">
        {label}
      </label>
      {children}
    </div>
  )
}

const inputCls =
  'w-full border border-[#D4D4CC] rounded-lg px-3 py-2 text-sm ' +
  'focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none ' +
  'bg-white placeholder-gray-400'

const monoInputCls =
  inputCls + ' font-mono'

/* ══════════════════════════════════════════════════════════
   FSLinkManager — Gridgeist redesign
   ══════════════════════════════════════════════════════════ */
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

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<FSLink | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchLinks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchWithAuth('/api/fs-links/')
      if (!res.ok) throw new Error('ไม่สามารถโหลดรายการ FS Link ได้')
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
      setFormError('กรุณากรอกชื่อ FS Link และชื่อผู้ให้บริการ')
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
        throw new Error(detail.detail || 'ไม่สามารถบันทึกข้อมูล FS Link ได้')
      }

      closeModal()
      fetchLinks()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึก')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = (link: FSLink) => {
    setDeleteTarget(link)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetchWithAuth(`/api/fs-links/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('ไม่สามารถลบ FS Link ได้')
      setDeleteTarget(null)
      fetchLinks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลบ')
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = Math.ceil(links.length / PAGE_SIZE)
  const displayed = links.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Hub detection — station codes that appear in more than one link
  const stationCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of links) {
      if (l.license?.tx_code) m.set(l.license.tx_code, (m.get(l.license.tx_code) ?? 0) + 1)
      if (l.license?.rx_code) m.set(l.license.rx_code, (m.get(l.license.rx_code) ?? 0) + 1)
    }
    return m
  }, [links])
  const isHub = (code: string) => (stationCounts.get(code) ?? 0) > 1

  /* ── Render ─────────────────────────────────────────── */

  const headerRowCls =
    'text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide'

  return (
    <div className="h-full flex flex-col bg-[#F5F5F0] font-[Sarabun]">
      {/* ══════════ Page Header ══════════ */}
      <div className="flex items-center justify-between px-6 py-5">
        <div>
          <h2 className="text-xl font-bold text-[#1A1A2E] leading-tight">
            จัดการ FS Link
          </h2>
          <p className="text-sm text-[#666666] mt-0.5">
            Fixed Service Links
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchLinks}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-[#4A4A5E] hover:bg-white rounded-lg border border-transparent hover:border-[#E5E5E0] transition-colors"
            title="รีเฟรช"
          >
            <RefreshCw className="w-4 h-4" />
            รีเฟรช
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#C00000] hover:bg-[#A00000] text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            เพิ่ม FS Link
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
        ) : links.length === 0 ? (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Radio className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-sm font-medium text-[#666666]">ยังไม่มี FS Link</p>
            <button
              onClick={openCreate}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-[#C00000] hover:bg-[#A00000] text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <PlusCircle className="w-4 h-4" />
              เพิ่ม FS Link แรก
            </button>
          </div>
        ) : (
          /* ── Table ── */
          <div className="bg-white rounded-lg border border-[#E5E5E0] overflow-hidden"
               style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#1A1A2E] text-white">
                    <th className={`${headerRowCls} rounded-tl-lg`}>สถานี</th>
                    <th className={headerRowCls}>บทบาท</th>
                    <th className={headerRowCls}>ที่ตั้ง</th>
                    <th className={headerRowCls}>พิกัด</th>
                    <th className={headerRowCls}>Azimuth</th>
                    <th className={`${headerRowCls} rounded-tr-lg`}>ความสูง</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((link, i) => {
                    const nameParts = link.name.includes('-') ? link.name.split('-') : [link.name, '']
                    const txCode = link.license?.tx_code ?? nameParts[0]
                    const rxCode = link.license?.rx_code ?? nameParts[1]
                    const dist = haversineKm(link.tx.lat, link.tx.lon, link.rx.lat, link.rx.lon)
                    const eirp = link.license?.eirp ?? link.rf.tx_power + link.rf.tx_antenna_gain
                    const bandCls = 'border-l-[3px] border-l-[#C00000]'
                    return (
                      <Fragment key={link.id}>
                        {/* ── Group header: link pair summary ── */}
                        <tr className="bg-[#1A1A2E] text-white">
                          <td colSpan={6} className="px-4 py-2.5">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="flex items-center gap-2.5 flex-wrap">
                                <Radio className="w-4 h-4 text-[#FF8A80]" />
                                <span className="mono font-bold text-sm">
                                  {txCode} <span className="text-[#FF8A80]">⇄</span> {rxCode}
                                </span>
                                <span className="text-xs text-white/60">{link.operator}</span>
                                <span className="text-xs font-mono text-white/80">
                                  {link.frequency.low.toLocaleString()}–{link.frequency.high.toLocaleString()} MHz
                                </span>
                                <span className="text-xs text-white/60">BW {link.frequency.bandwidth}</span>
                                <span className="text-xs font-mono text-white/80">{link.license?.class_of_emission ?? '—'}</span>
                                <span className="text-xs text-white/60">{link.license?.distance_km ?? dist.toFixed(2)} กม.</span>
                                <span className="text-xs text-white/60">EIRP {eirp.toFixed(1)} dBm</span>
                                <span className={`text-xs font-mono ${(link.license?.rx_power_dbm ?? -99) > -80 ? 'text-emerald-300' : 'text-amber-300'}`}>
                                  Pr {link.license?.rx_power_dbm ?? '—'} dBm
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <StatusBadge status={link.status} />
                                <button
                                  onClick={() => openEdit(link)}
                                  className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors"
                                  title="แก้ไข"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => confirmDelete(link)}
                                  className="p-1.5 text-white/60 hover:text-[#FF8A80] hover:bg-white/10 rounded transition-colors"
                                  title="ลบ"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                        {/* ── TX station ── */}
                        <StationRow
                          code={txCode}
                          side="TX"
                          address={shortAddr(txCode, link.license?.tx_address)}
                          lat={link.tx.lat}
                          lon={link.tx.lon}
                          azimuth={link.rf.azimuth}
                          height={link.tx.altitude}
                          hub={isHub(txCode)}
                          band={bandCls}
                        />
                        {/* ── RX station ── */}
                        <StationRow
                          code={rxCode}
                          side="RX"
                          address={shortAddr(rxCode, link.license?.rx_address)}
                          lat={link.rx.lat}
                          lon={link.rx.lon}
                          azimuth={(link.rf.azimuth + 180) % 360}
                          height={link.rx.altitude}
                          hub={isHub(rxCode)}
                          band={bandCls}
                        />
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ── */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#E5E5E0] bg-[#FAFAFA]">
                <span className="text-xs text-[#888888]">
                  แสดง {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, links.length)}
                  {' '}จาก {links.length} รายการ
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

      {/* ══════════ Create / Edit Modal ══════════ */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <ScaleIn>
            <div
              className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4"
              style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E0] sticky top-0 bg-white rounded-t-lg z-10">
                <div>
                  <h3 className="text-lg font-bold text-[#1A1A2E]">
                    {editingId ? 'แก้ไข FS Link' : 'เพิ่ม FS Link ใหม่'}
                  </h3>
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
                    <Field label="ชื่อ FS Link *">
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => handleFieldChange('name', e.target.value)}
                        placeholder="เช่น BKK-CNX Link 1"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="ผู้ให้บริการ *">
                      <input
                        type="text"
                        value={form.operator}
                        onChange={(e) => handleFieldChange('operator', e.target.value)}
                        placeholder="เช่น NT, AIS, True"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <div className="mt-4 max-w-xs">
                    <Field label="สถานะ">
                      <select
                        value={form.status}
                        onChange={(e) => handleFieldChange('status', e.target.value)}
                        className={inputCls}
                      >
                        <option value="active">ใช้งาน (Active)</option>
                        <option value="pending">รอดำเนินการ (Pending)</option>
                        <option value="inactive">ไม่ใช้งาน (Inactive)</option>
                      </select>
                    </Field>
                  </div>
                </div>

                {/* Frequency */}
                <div>
                  <h4 className="text-sm font-semibold text-[#1A1A2E] mb-3 pb-2 border-b border-[#E5E5E0]">
                    ความถี่
                  </h4>
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="ความถี่ต่ำสุด (MHz)">
                      <input
                        type="number"
                        value={form.freq_low}
                        onChange={(e) => handleFieldChange('freq_low', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                    <Field label="ความถี่สูงสุด (MHz)">
                      <input
                        type="number"
                        value={form.freq_high}
                        onChange={(e) => handleFieldChange('freq_high', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                    <Field label="แบนด์วิดท์ (MHz)">
                      <input
                        type="number"
                        value={form.bandwidth}
                        onChange={(e) => handleFieldChange('bandwidth', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                  </div>
                </div>

                {/* TX (Station A) */}
                <div>
                  <h4 className="text-sm font-semibold text-[#1A1A2E] mb-3 pb-2 border-b border-[#E5E5E0]">
                    สถานีส่ง (Station A — TX)
                  </h4>
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="ละติจูด (Latitude)">
                      <input
                        type="number"
                        step="0.0001"
                        value={form.tx_lat}
                        onChange={(e) => handleFieldChange('tx_lat', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                    <Field label="ลองจิจูด (Longitude)">
                      <input
                        type="number"
                        step="0.0001"
                        value={form.tx_lon}
                        onChange={(e) => handleFieldChange('tx_lon', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                    <Field label="ความสูง (m)">
                      <input
                        type="number"
                        value={form.tx_altitude}
                        onChange={(e) => handleFieldChange('tx_altitude', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                  </div>
                </div>

                {/* RX (Station B) */}
                <div>
                  <h4 className="text-sm font-semibold text-[#1A1A2E] mb-3 pb-2 border-b border-[#E5E5E0]">
                    สถานีรับ (Station B — RX)
                  </h4>
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="ละติจูด (Latitude)">
                      <input
                        type="number"
                        step="0.0001"
                        value={form.rx_lat}
                        onChange={(e) => handleFieldChange('rx_lat', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                    <Field label="ลองจิจูด (Longitude)">
                      <input
                        type="number"
                        step="0.0001"
                        value={form.rx_lon}
                        onChange={(e) => handleFieldChange('rx_lon', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                    <Field label="ความสูง (m)">
                      <input
                        type="number"
                        value={form.rx_altitude}
                        onChange={(e) => handleFieldChange('rx_altitude', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                  </div>
                </div>

                {/* RF Parameters */}
                <div>
                  <h4 className="text-sm font-semibold text-[#1A1A2E] mb-3 pb-2 border-b border-[#E5E5E0]">
                    พารามิเตอร์ RF
                  </h4>
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="กำลังส่ง TX (dBm)">
                      <input
                        type="number"
                        value={form.tx_power}
                        onChange={(e) => handleFieldChange('tx_power', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                    <Field label="อัตราขยายสายอากาศส่ง (dBi)">
                      <input
                        type="number"
                        step="0.1"
                        value={form.tx_antenna_gain}
                        onChange={(e) => handleFieldChange('tx_antenna_gain', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                    <Field label="อัตราขยายสายอากาศรับ (dBi)">
                      <input
                        type="number"
                        step="0.1"
                        value={form.rx_antenna_gain}
                        onChange={(e) => handleFieldChange('rx_antenna_gain', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-4">
                    <Field label="มุมทิศ (Azimuth)">
                      <input
                        type="number"
                        value={form.azimuth}
                        onChange={(e) => handleFieldChange('azimuth', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                    <Field label="ความกว้างลำคลื่น (Beamwidth)">
                      <input
                        type="number"
                        step="0.1"
                        value={form.beamwidth_deg}
                        onChange={(e) => handleFieldChange('beamwidth_deg', Number(e.target.value))}
                        className={monoInputCls}
                      />
                    </Field>
                    <Field label="โพลาไรเซชัน">
                      <select
                        value={form.polarization}
                        onChange={(e) => handleFieldChange('polarization', e.target.value)}
                        className={inputCls}
                      >
                        <option value="V">V (แนวตั้ง — Vertical)</option>
                        <option value="H">H (แนวนอน — Horizontal)</option>
                        <option value="VH">V/H (สองทิศทาง — Dual)</option>
                      </select>
                    </Field>
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
                    {saving
                      ? 'กำลังบันทึก...'
                      : editingId
                        ? 'บันทึกการแก้ไข'
                        : 'เพิ่ม FS Link'}
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
            <h3 className="text-lg font-bold text-[#1A1A2E]">
              ยืนยันการลบ
            </h3>
            <p className="mt-2 text-sm text-[#666666]">
              คุณต้องการลบ FS Link{' '}
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
                {deleting ? 'กำลังลบ...' : 'ลบ FS Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
