import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, X, MapPin, Radio, Building2 } from 'lucide-react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { staggerDelay, debounce } from '../utils/animation'
import { useAuth } from '../contexts/AuthContext'

/* ══════════════════════════════════════════════════════════
   QueryPanel — Gridgeist Redesign
   DESIGN.md tokens:
     primary: #C00000 | surface: #F5F5F0
     surface-container: #FFFFFF | secondary: #1A1A2E
     on-surface: #333333 | on-surface-variant: #666666
     outline: #CCCCCC | card-border: #E5E5E0
     card-radius: 8px (rounded-lg) | button-radius: 8px
     data-mono: JetBrains Mono | heading: TH Sarabun New
     spacing: 8/16/24/32 | motion: causality only
   ══════════════════════════════════════════════════════════ */

interface QueryPanelProps {
  onZoomTo: (lat: number, lon: number) => void
}

type SearchTab = 'all' | 'fs' | 'imt'

interface FSResult {
  id: string
  name: string
  operator: string
  tx_lat: number
  tx_lon: number
  rx_lat: number
  rx_lon: number
  freq_low: number
  freq_high: number
  status: string
}

interface IMTResult {
  id: string
  name: string
  site_owner: string
  station_type: string | null
  center_lat: number
  center_lon: number
  cell_radius: number
  status: string
  created_at: string
}

// ── Haversine distance (km) between two lat/lon points ────
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

// ── Mini spectrum block colors ────────────────────────────
const SPECTRUM_COLORS = ['#2E7D32', '#2E7D32', '#E65100', '#2E7D32', '#C62828', '#2E7D32', '#E65100', '#2E7D32', '#C62828', '#2E7D32']

export default function QueryPanel({ onZoomTo }: QueryPanelProps) {
  const { fetchWithAuth } = useAuth()
  const reducedMotion = useReducedMotion()

  // ── State (preserved from original) ─────────────────────
  const [activeTab, setActiveTab] = useState<SearchTab>('all')
  const [query, setQuery] = useState('')
  const [fsResults, setFsResults] = useState<FSResult[]>([])
  const [imtResults, setImtResults] = useState<IMTResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ── API fetch callbacks (preserved logic) ───────────────
  const searchFS = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchWithAuth('/api/fs-links/')
      if (!res.ok) throw new Error('ไม่สามารถโหลด FS Links ได้')
      const data = await res.json()
      const links = (data.links || data || []).map((l: any) => ({
        id: l.id,
        name: l.name,
        operator: l.operator,
        tx_lat: l.tx?.lat ?? l.tx_lat,
        tx_lon: l.tx?.lon ?? l.tx_lon,
        rx_lat: l.rx?.lat ?? l.rx_lat,
        rx_lon: l.rx?.lon ?? l.rx_lon,
        freq_low: l.frequency?.low ?? l.freq_low,
        freq_high: l.frequency?.high ?? l.freq_high,
        status: l.status,
      }))
      setFsResults(links)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth])

  const searchIMT = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchWithAuth('/api/imt/')
      if (!res.ok) throw new Error('ไม่สามารถโหลด IMT Allocations ได้')
      const data = await res.json()
      const allocations = (data.allocations || data || []).map((a: any) => ({
        id: a.id,
        name: a.name,
        site_owner: a.site_owner,
        station_type: a.station_type,
        center_lat: a.center_lat,
        center_lon: a.center_lon,
        cell_radius: a.cell_radius,
        status: 'active',
        created_at: a.created_at,
      }))
      setImtResults(allocations)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth])

  const handleSearch = useCallback(() => {
    if (activeTab === 'all') {
      Promise.all([searchFS(), searchIMT()])
    } else if (activeTab === 'fs') {
      searchFS()
    } else {
      searchIMT()
    }
  }, [activeTab, searchFS, searchIMT])

  // ── Debounced search on query change ────────────────────
  const debouncedSearchRef = useRef(debounce(() => handleSearch(), 300))
  useEffect(() => {
    debouncedSearchRef.current()
  }, [query, activeTab])

  // ── Client-side filtering ───────────────────────────────
  const q = query.toLowerCase().trim()
  const filteredFS = q
    ? fsResults.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.operator.toLowerCase().includes(q),
      )
    : fsResults

  const filteredIMT = q
    ? imtResults.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.site_owner.toLowerCase().includes(q),
      )
    : imtResults

  const totalResults =
    activeTab === 'all'
      ? (activeTab === 'all' ? filteredFS.length + filteredIMT.length : 0)
      : activeTab === 'fs'
        ? filteredFS.length
        : filteredIMT.length

  // ── Render helpers ──────────────────────────────────────

  const renderFSResultCount = activeTab === 'all' || activeTab === 'fs'
  const renderIMTResultCount = activeTab === 'all' || activeTab === 'imt'

  return (
    <div className="h-full flex flex-col bg-[#F5F5F0]">
      {/* ══════════════════════════════════════════════════════
          ZONE 1: PAGE HEADER
          ══════════════════════════════════════════════════════ */}
      <div className="px-6 py-5 bg-white border-b border-[#E5E5E0]">
        <h2
          className="text-[1.5rem] font-bold text-[#1A1A2E] mb-1"
          style={{ fontFamily: 'TH Sarabun New, Sarabun, sans-serif' }}
        >
          ค้นหา
        </h2>
        <p className="text-sm text-[#666666]">
          ค้นหา FS Links และ IMT Allocations
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════
          ZONE 2: HERO SEARCH BAR
          ══════════════════════════════════════════════════════ */}
      <div className="px-6 pt-5 pb-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#999999]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
            placeholder="ค้นหาด้วยชื่อ, พิกัด, operator..."
            className="w-full pl-12 pr-10 py-3.5 border border-[#CCCCCC] rounded-lg text-base
                       focus:outline-none focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000]
                       transition-shadow placeholder:text-[#999999] bg-white"
            style={{ fontFamily: 'TH Sarabun New, Sarabun, sans-serif' }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="ล้างการค้นหา"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          ZONE 3: FILTER CHIPS
          ══════════════════════════════════════════════════════ */}
      <div className="px-6 pb-4 flex items-center gap-2">
        {([
          { tab: 'all', label: 'ทั้งหมด', icon: Search },
          { tab: 'fs', label: 'FS Links', icon: MapPin },
          { tab: 'imt', label: 'IMT', icon: Radio },
        ] as const).map(({ tab, label, icon: Icon }) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab as SearchTab)
              setError('')
            }}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition-colors ${
              activeTab === tab
                ? 'bg-[#C00000] text-white'
                : 'bg-white text-[#666666] border border-[#CCCCCC] hover:bg-gray-50 hover:text-[#333333]'
            }`}
            style={{ fontFamily: 'TH Sarabun New, Sarabun, sans-serif' }}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════
          ZONE 4: RESULTS COUNT + CONTENT AREA
          ══════════════════════════════════════════════════════ */}

      {/* ── Error state ──────────────────────────────────── */}
      {error && (
        <div className="mx-6 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Results count ────────────────────────────────── */}
      {!loading && !error && totalResults > 0 && (
        <div className="px-6 pb-3">
          <p className="text-xs text-[#999999]">
            พบ {totalResults} รายการ
          </p>
        </div>
      )}

      {/* ── Scrollable results area ──────────────────────── */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {/* ── Loading: 3 skeleton cards ──────────────────── */}
        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`bg-white rounded-lg border border-[#E5E5E0] p-4 ${
                  reducedMotion ? '' : 'animate-pulse'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gray-200 shrink-0" />
                  <div className="flex-1 space-y-2.5">
                    <div className="h-4 bg-gray-200 rounded w-2/3" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                    <div className="h-3 bg-gray-100 rounded w-1/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Empty state ────────────────────────────────── */}
        {!loading && !error && totalResults === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-[#999999]">
            <Search className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">
              {fsResults.length === 0 && imtResults.length === 0
                ? 'คลิก "ค้นหา" เพื่อโหลดข้อมูล'
                : 'ไม่พบผลการค้นหา'}
            </p>
          </div>
        )}

        {/* ── FS Link cards ──────────────────────────────── */}
        {!loading && renderFSResultCount && filteredFS.length > 0 && (
          <div className="space-y-2">
            {activeTab === 'all' && filteredFS.length > 0 && (
              <p className="text-xs font-semibold text-[#999999] pt-1 pb-1 uppercase tracking-wide">
                FS Links
              </p>
            )}
            {filteredFS.map((r, idx) => (
              <div
                key={r.id}
                className={`bg-white rounded-lg border border-[#E5E5E0] p-4 hover:bg-[#FAFAFA] hover:border-[#C00000]/20 transition-all cursor-pointer group ${
                  reducedMotion ? '' : 'animate-fade-in-up'
                }`}
                style={
                  reducedMotion
                    ? undefined
                    : { animationDelay: staggerDelay(idx) }
                }
                onClick={() => onZoomTo(r.tx_lat, r.tx_lon)}
              >
                <div className="flex items-start gap-3">
                  {/* ── MapPin icon ──────────────────────── */}
                  <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                    <MapPin className="w-4 h-4 text-[#C00000]" />
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* ── Name (bold) ───────────────────── */}
                    <h4
                      className="font-bold text-[#1A1A2E] text-sm group-hover:text-[#C00000] transition-colors truncate"
                      style={{ fontFamily: 'TH Sarabun New, Sarabun, sans-serif' }}
                    >
                      {r.name}
                    </h4>

                    {/* ── Operator ───────────────────────── */}
                    <p className="text-xs text-[#666666] mt-0.5">
                      {r.operator}
                    </p>

                    {/* ── Station endpoints ──────────────── */}
                    <p className="text-xs text-[#999999] mt-1 flex items-center gap-1">
                      <span>สถานีส่ง</span>
                      <span
                        className="text-[#666666]"
                        style={{ fontFamily: 'JetBrains Mono, monospace' }}
                      >
                        ({r.tx_lat.toFixed(4)}, {r.tx_lon.toFixed(4)})
                      </span>
                      <span className="mx-0.5">→</span>
                      <span>สถานีรับ</span>
                      <span
                        className="text-[#666666]"
                        style={{ fontFamily: 'JetBrains Mono, monospace' }}
                      >
                        ({r.rx_lat.toFixed(4)}, {r.rx_lon.toFixed(4)})
                      </span>
                    </p>

                    {/* ── Frequency + distance (mono) ────── */}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span
                        className="text-xs text-[#333333]"
                        style={{ fontFamily: 'JetBrains Mono, monospace' }}
                      >
                        {r.freq_low}–{r.freq_high} MHz
                      </span>
                      <span className="text-[#CCCCCC]">|</span>
                      <span
                        className="text-xs text-[#333333]"
                        style={{ fontFamily: 'JetBrains Mono, monospace' }}
                      >
                        {haversineKm(r.tx_lat, r.tx_lon, r.rx_lat, r.rx_lon).toFixed(1)} km
                      </span>
                    </div>
                  </div>

                  {/* ── "ซูมไปที่" on hover ──────────────── */}
                  <div className="flex items-center gap-1 text-[#C00000] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
                    <MapPin className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">ซูมไปที่</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── IMT cards ──────────────────────────────────── */}
        {!loading && renderIMTResultCount && filteredIMT.length > 0 && (
          <div className="space-y-2">
            {activeTab === 'all' && filteredIMT.length > 0 && (
              <p
                className={`text-xs font-semibold text-[#999999] pt-3 pb-1 uppercase tracking-wide ${
                  filteredFS.length > 0 ? '' : 'pt-1'
                }`}
              >
                IMT Allocations
              </p>
            )}
            {filteredIMT.map((r, idx) => (
              <div
                key={r.id}
                className={`bg-white rounded-lg border border-[#E5E5E0] p-4 hover:bg-[#FAFAFA] hover:border-[#C00000]/20 transition-all cursor-pointer group ${
                  reducedMotion ? '' : 'animate-fade-in-up'
                }`}
                style={
                  reducedMotion
                    ? undefined
                    : { animationDelay: staggerDelay(idx) }
                }
                onClick={() => onZoomTo(r.center_lat, r.center_lon)}
              >
                <div className="flex items-start gap-3">
                  {/* ── Radio icon ──────────────────────── */}
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <Radio className="w-4 h-4 text-[#1565C0]" />
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* ── Name (bold) ───────────────────── */}
                    <h4
                      className="font-bold text-[#1A1A2E] text-sm group-hover:text-[#C00000] transition-colors truncate"
                      style={{ fontFamily: 'TH Sarabun New, Sarabun, sans-serif' }}
                    >
                      {r.name}
                    </h4>

                    {/* ── Operator ───────────────────────── */}
                    <p className="text-xs text-[#666666] mt-0.5 flex items-center gap-1">
                      <Building2 className="w-3 h-3" />
                      {r.site_owner}
                    </p>

                    {/* ── Location (mono) ────────────────── */}
                    <p className="text-xs text-[#333333] mt-1">
                      <span
                        style={{ fontFamily: 'JetBrains Mono, monospace' }}
                      >
                        {r.center_lat.toFixed(4)}, {r.center_lon.toFixed(4)}
                      </span>
                      <span className="text-[#CCCCCC] mx-1.5">|</span>
                      <span
                        className="text-[#666666]"
                        style={{ fontFamily: 'JetBrains Mono, monospace' }}
                      >
                        {r.cell_radius} m
                      </span>
                    </p>

                    {/* ── Mini spectrum blocks ─────────────── */}
                    <div className="flex items-center gap-0.5 mt-2">
                      {SPECTRUM_COLORS.map((color, i) => (
                        <div
                          key={i}
                          className="w-2.5 h-2.5 rounded-sm"
                          style={{ backgroundColor: color, border: '1px solid rgba(0,0,0,0.15)' }}
                          title={`บล็อก ${4800 + i * 10}-${4810 + i * 10} MHz`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* ── "ซูมไปที่" on hover ──────────────── */}
                  <div className="flex items-center gap-1 text-[#C00000] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
                    <MapPin className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">ซูมไปที่</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
