import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, MapPin, Radio, ArrowUpDown, RefreshCw } from 'lucide-react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { staggerDelay } from '../utils/animation'
import { useAuth } from '../contexts/AuthContext'

interface QueryPanelProps {
  onZoomTo: (lat: number, lon: number) => void
}

type SearchTab = 'fs' | 'imt'

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
  operator: string
  center_lat: number
  center_lon: number
  cell_radius: number
  status: string
  created_at: string
}

export default function QueryPanel({ onZoomTo }: QueryPanelProps) {
  const { fetchWithAuth } = useAuth()
  const reducedMotion = useReducedMotion()
  const [activeTab, setActiveTab] = useState<SearchTab>('fs')
  const [query, setQuery] = useState('')
  const [fsResults, setFsResults] = useState<FSResult[]>([])
  const [imtResults, setImtResults] = useState<IMTResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
        operator: a.operator,
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

  const handleSearch = () => {
    if (activeTab === 'fs') {
      searchFS()
    } else {
      searchIMT()
    }
  }

  // Filter by query
  const filteredFS = fsResults.filter(
    (r) =>
      !query ||
      r.name.toLowerCase().includes(query.toLowerCase()) ||
      r.operator.toLowerCase().includes(query.toLowerCase()),
  )

  const filteredIMT = imtResults.filter(
    (r) =>
      !query ||
      r.name.toLowerCase().includes(query.toLowerCase()) ||
      r.operator.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <div className="h-full flex flex-col bg-[#F5F5F0]">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-gray-200">
        <h2 className="text-lg font-bold text-[#1A1A2E] mb-3 flex items-center gap-2">
          <Search className="w-5 h-5 text-[#C00000]" />
          ค้นหา
        </h2>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-3 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => { setActiveTab('fs'); setError('') }}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'fs'
                ? 'bg-white text-[#1A1A2E] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5" /> FS Links
            </span>
          </button>
          <button
            onClick={() => { setActiveTab('imt'); setError('') }}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'imt'
                ? 'bg-white text-[#1A1A2E] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Radio className="w-3.5 h-3.5" /> IMT
            </span>
          </button>
        </div>

        {/* Search input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={activeTab === 'fs' ? 'ค้นหาชื่อ FS Link หรือผู้ให้บริการ...' : 'ค้นหาชื่อ IMT หรือผู้ให้บริการ...'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 pl-9 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
            />
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="bg-[#C00000] hover:bg-[#8B0000] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            ค้นหา
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'fs' ? (
          filteredFS.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <ArrowUpDown className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">
                {loading ? 'กำลังค้นหา...' : fsResults.length === 0 ? 'คลิก "ค้นหา" เพื่อโหลดข้อมูล FS Links' : 'ไม่พบผลลัพธ์ที่ตรงกับคำค้นหา'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredFS.map((r, idx) => (
                <div
                  key={r.id}
                  className="bg-white rounded-lg border border-gray-200 p-3 hover:shadow-md hover:border-[#C00000]/30 transition-all cursor-pointer group animate-fade-in-up"
                  style={reducedMotion ? undefined : { animationDelay: staggerDelay(idx) }}
                  onClick={() => onZoomTo(r.tx_lat, r.tx_lon)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold text-[#1A1A2E] text-sm group-hover:text-[#C00000] transition-colors">
                        {r.name}
                      </h4>
                      <p className="text-xs text-gray-500 mt-0.5">{r.operator}</p>
                      <p className="text-xs text-gray-400 font-mono mt-1">
                        {r.freq_low}-{r.freq_high} MHz
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-[#C00000] opacity-0 group-hover:opacity-100 transition-opacity">
                      <MapPin className="w-4 h-4" />
                      <span className="text-xs font-medium">ซูมไปที่</span>
                    </div>
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-gray-400">
                    <span>
                      TX: {r.tx_lat.toFixed(4)}, {r.tx_lon.toFixed(4)}
                    </span>
                    <span>
                      RX: {r.rx_lat.toFixed(4)}, {r.rx_lon.toFixed(4)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          filteredIMT.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <Radio className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">
                {loading ? 'กำลังค้นหา...' : imtResults.length === 0 ? 'คลิก "ค้นหา" เพื่อโหลดข้อมูล IMT' : 'ไม่พบผลลัพธ์ที่ตรงกับคำค้นหา'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredIMT.map((r, idx) => (
                <div
                  key={r.id}
                  className="bg-white rounded-lg border border-gray-200 p-3 hover:shadow-md hover:border-[#C00000]/30 transition-all cursor-pointer group animate-fade-in-up"
                  style={reducedMotion ? undefined : { animationDelay: staggerDelay(idx) }}
                  onClick={() => onZoomTo(r.center_lat, r.center_lon)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold text-[#1A1A2E] text-sm group-hover:text-[#C00000] transition-colors">
                        {r.name}
                      </h4>
                      <p className="text-xs text-gray-500 mt-0.5">{r.operator}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        รัศมี: {r.cell_radius} m
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-[#C00000] opacity-0 group-hover:opacity-100 transition-opacity">
                      <MapPin className="w-4 h-4" />
                      <span className="text-xs font-medium">ซูมไปที่</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-xs text-gray-400">
                      {r.center_lat.toFixed(4)}, {r.center_lon.toFixed(4)}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(r.created_at).toLocaleDateString('th-TH')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
