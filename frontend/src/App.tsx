import { useState, useCallback } from 'react'
import {
  Map as MapIcon,
  Layout,
  LogOut,
  Shield,
  Radio,
  Search,
  Globe,
  PlusCircle,
} from 'lucide-react'
import MapView, { MAP_STYLES } from './components/MapView'
import BlockPanel from './components/BlockPanel'
import AllocationForm from './components/AllocationForm'
import LoginPage from './components/LoginPage'
import FSLinkManager from './components/FSLinkManager'
import IMTManager from './components/IMTManager'
import IMTAddWorkspace from './components/IMTAddWorkspace'
import QueryPanel from './components/QueryPanel'
import { useAuth } from './contexts/AuthContext'
import type { BlockResult } from './types'

type Tab = 'dashboard' | 'fslinks' | 'imt' | 'search'

export default function App() {
  const { isAuthenticated, user, logout } = useAuth()

  if (!isAuthenticated) {
    return <LoginPage />
  }

  return <AuthenticatedApp user={user} onLogout={logout} />
}

function AuthenticatedApp({
  user,
  onLogout,
}: {
  user: { username: string; role: string } | null
  onLogout: () => void
}) {
  const [tab, setTab] = useState<Tab>('dashboard')

  const [selectedLat, setSelectedLat] = useState<number | null>(null)
  const [selectedLon, setSelectedLon] = useState<number | null>(null)
  const [workspaceMapClickLat, setWorkspaceMapClickLat] = useState<number | null>(null)
  const [workspaceMapClickLon, setWorkspaceMapClickLon] = useState<number | null>(null)
  const [blocks, setBlocks] = useState<BlockResult[]>([])
  const [loading, setLoading] = useState(false)
  const [model, setModel] = useState('free_space')
  const [mapStyle, setMapStyle] = useState('voyager')
  const [showDashboardWorkspace, setShowDashboardWorkspace] = useState(false)
  const { fetchWithAuth } = useAuth()

  const handleMapClick = useCallback((lat: number, lon: number) => {
    setSelectedLat(lat)
    setSelectedLon(lon)
    if (showDashboardWorkspace) {
      setWorkspaceMapClickLat(lat)
      setWorkspaceMapClickLon(lon)
    }
  }, [showDashboardWorkspace])

  const handleAnalyze = useCallback(
    async (params: {
      cell_radius: number
      antenna_height: number
      antenna_gain: number
      max_eirp: number
    }) => {
      if (!selectedLat || !selectedLon) return

      setLoading(true)
      try {
        const res = await fetchWithAuth('/api/allocate/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            center_lat: selectedLat,
            center_lon: selectedLon,
            cell_radius: params.cell_radius,
            antenna_height: params.antenna_height,
            antenna_gain: params.antenna_gain,
            max_eirp: params.max_eirp,
            model,
          }),
        })
        const data = await res.json()
        setBlocks(data.blocks || [])
      } catch (err) {
        console.error('Analysis failed:', err)
      } finally {
        setLoading(false)
      }
    },
    [selectedLat, selectedLon, model, fetchWithAuth],
  )

  const handleCloseAllocation = useCallback(() => {
    setSelectedLat(null)
    setSelectedLon(null)
    setBlocks([])
  }, [])

  const handleZoomTo = useCallback((lat: number, lon: number) => {
    setTab('dashboard')
    setSelectedLat(lat)
    setSelectedLon(lon)
  }, [])

  const handleOpenWorkspace = useCallback(() => {
    setShowDashboardWorkspace(true)
  }, [])

  const handleCloseWorkspace = useCallback(() => {
    setShowDashboardWorkspace(false)
  }, [])

  return (
    <div className="h-screen flex flex-col">
      {/* Top Navigation Bar */}
      <nav className="nbtc-header px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">PAFC</h1>
              <p className="text-xs opacity-80 leading-tight">
                ระบบจัดสรรคลื่นความถี่ | 4800-4990 MHz
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Tab: Dashboard */}
          <button
            onClick={() => setTab('dashboard')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'dashboard'
                ? 'bg-white/20 text-white'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Layout className="w-4 h-4" />
            Dashboard
          </button>

          {/* Tab: FS Links */}
          <button
            onClick={() => setTab('fslinks')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'fslinks'
                ? 'bg-white/20 text-white'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <MapIcon className="w-4 h-4" />
            FS Links
          </button>

          {/* Tab: IMT */}
          <button
            onClick={() => setTab('imt')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'imt'
                ? 'bg-white/20 text-white'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Radio className="w-4 h-4" />
            IMT
          </button>

          {/* Tab: Search */}
          <button
            onClick={() => setTab('search')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'search'
                ? 'bg-white/20 text-white'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Search className="w-4 h-4" />
            ค้นหา
          </button>

          {/* Map Style Selector */}
          <div className="flex items-center gap-1.5 bg-white/10 rounded-lg px-2 py-1">
            <Globe className="w-4 h-4 opacity-70" />
            <select
              value={mapStyle}
              onChange={(e) => setMapStyle(e.target.value)}
              className="bg-transparent text-white text-sm cursor-pointer border-none outline-none"
            >
              {Object.entries(MAP_STYLES).map(([key, s]) => (
                <option key={key} value={key} className="text-gray-900">{s.label}</option>
              ))}
            </select>
          </div>

          {/* User info + Logout */}
          <div className="ml-4 flex items-center gap-2 pl-4 border-l border-white/20">
            <span className="text-xs text-white/70">
              {user?.username || 'ผู้ใช้'} ({user?.role || '-'})
            </span>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
              title="ออกจากระบบ"
            >
              <LogOut className="w-4 h-4" />
              ออกจากระบบ
            </button>
          </div>
        </div>
      </nav>

      {/* Tab Content */}
      {tab === 'dashboard' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Dashboard toolbar */}
          <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shadow-sm">
            <h2 className="text-sm font-semibold text-[#1A1A2E]">
              แผนที่จัดสรรคลื่นความถี่ 4800-4990 MHz
            </h2>
            <button
              onClick={handleOpenWorkspace}
              className="flex items-center gap-1.5 bg-[#C00000] hover:bg-[#8B0000] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
            >
              <PlusCircle className="w-4 h-4" />
              เพิ่ม IMT
            </button>
          </div>

          {showDashboardWorkspace ? (
            /* ─── 70/30 SPLIT: Map left 30%, Workspace right 70% ─── */
            <div className="flex-1 flex overflow-hidden">
              {/* Left 30% — Compact Map */}
              <div className="w-[30%] min-w-[280px] relative border-r border-gray-300">
                <MapView
                  onMapClick={handleMapClick}
                  selectedLat={selectedLat}
                  selectedLon={selectedLon}
                  blocks={blocks}
                  mapStyle={mapStyle}
                />
              </div>

              {/* Right 70% — Workspace Panel */}
              <div className="flex-1 overflow-hidden">
                <IMTAddWorkspace onBack={handleCloseWorkspace} mode="panel" onMapClickLat={workspaceMapClickLat} onMapClickLon={workspaceMapClickLon} />
              </div>
            </div>
          ) : (
            /* ─── FULL MAP with overlay (existing layout) ─── */
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 relative">
                <MapView
                  onMapClick={handleMapClick}
                  selectedLat={selectedLat}
                  selectedLon={selectedLon}
                  blocks={blocks}
                  mapStyle={mapStyle}
                />

                {selectedLat && selectedLon && (
                  <div className="absolute top-4 right-4 z-10 bg-white rounded-lg shadow-lg p-4 w-80">
                    <AllocationForm
                      lat={selectedLat}
                      lon={selectedLon}
                      onAnalyze={handleAnalyze}
                      loading={loading}
                      onClose={handleCloseAllocation}
                      model={model}
                      onModelChange={setModel}
                    />
                  </div>
                )}
              </div>

              {blocks.length > 0 && (
                <div className="w-80 bg-white border-l overflow-y-auto">
                  <BlockPanel blocks={blocks} />
                </div>
              )}
            </div>
          )}
        </div>
      ) : tab === 'fslinks' ? (
        <div className="flex-1 overflow-hidden">
          <FSLinkManager />
        </div>
      ) : tab === 'imt' ? (
        <div className="flex-1 overflow-hidden">
          <IMTManager />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <QueryPanel onZoomTo={handleZoomTo} />
        </div>
      )}
    </div>
  )
}
