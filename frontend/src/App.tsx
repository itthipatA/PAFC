import { useState, useCallback, useEffect } from 'react'
import {
  Map as MapIcon,
  Layout,
  LogOut,
  Shield,
  Radio,
  Search,
  Globe,
  PlusCircle,
  Octagon,
} from 'lucide-react'
import MapView, { MAP_STYLES } from './components/MapView'
import type { HighlightStation } from './components/MapView'
import LoginPage from './components/LoginPage'
import FSLinkManager from './components/FSLinkManager'
import IMTManager from './components/IMTManager'
import IMTAddWorkspace from './components/IMTAddWorkspace'
import PolygonCreator from './components/PolygonCreator'
import QueryPanel from './components/QueryPanel'
import { useAuth } from './contexts/AuthContext'

type Tab = 'dashboard' | 'fslinks' | 'imt' | 'polygon' | 'search'

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
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0)

  const [selectedLat, setSelectedLat] = useState<number | null>(null)
  const [selectedLon, setSelectedLon] = useState<number | null>(null)
  const [mapStyle, setMapStyle] = useState('voyager')
  const [showDashboardWorkspace, setShowDashboardWorkspace] = useState(false)
  const [workspaceClosing, setWorkspaceClosing] = useState(false)
  const [workspaceCellRadius, setWorkspaceCellRadius] = useState(500)
  const [highlightStationNames, setHighlightStationNames] = useState<HighlightStation[] | undefined>(undefined)

  // Plotted polygon for dashboard map display
  const [plottedPolygon, setPlottedPolygon] = useState<[number, number][] | null>(null)
  const [parcelTowers, setParcelTowers] = useState<{ lat: number; lon: number }[]>([])
  const [parcelCentroid, setParcelCentroid] = useState<{ lat: number; lon: number } | null>(null)
  const [parcelView3D, setParcelView3D] = useState(false)

  // Polygon creator state
  const [showPolygonWorkspace, setShowPolygonWorkspace] = useState(false)
  const [polygonClosing, setPolygonClosing] = useState(false)
  const [polygonVertices, setPolygonVertices] = useState<[number, number][]>([])
  const [polygonDrawingMode, setPolygonDrawingMode] = useState(false)

  const handleMapClick = useCallback((lat: number, lon: number) => {
    setSelectedLat(lat)
    setSelectedLon(lon)
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
    setWorkspaceClosing(true)
    // Clear highlight immediately on close
    setHighlightStationNames(undefined)
    setTimeout(() => {
      setShowDashboardWorkspace(false)
      setWorkspaceClosing(false)
      // Clear the red placement marker when workspace closes
      setSelectedLat(null)
      setSelectedLon(null)
      // Refresh map to show new IMT marker (if save happened)
      setDashboardRefreshKey(k => k + 1)
    }, 600)
  }, [])

  const handleConfirmLocation = useCallback((lat: number, lon: number, cellRadius: number) => {
    setSelectedLat(lat)
    setSelectedLon(lon)
    setWorkspaceCellRadius(cellRadius)
  }, [])

  useEffect(() => {
    if (tab === 'dashboard') {
      setDashboardRefreshKey(k => k + 1)
    }
  }, [tab])

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
          <button
            onClick={() => setTab('polygon')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'polygon'
                ? 'bg-white/20 text-white'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Octagon className="w-4 h-4" />
            สร้างโพลีกอน
          </button>
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
          <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shadow-sm z-10">
            <h2 className="text-sm font-semibold text-[#1A1A2E]">
              แผนที่จัดสรรคลื่นความถี่ 4800-4990 MHz
            </h2>
            {!showDashboardWorkspace && (
              <div className="flex items-center gap-2">
                {plottedPolygon && (
                  <button
                    onClick={() => setParcelView3D(!parcelView3D)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      parcelView3D ? 'bg-[#C00000] text-white border-[#C00000]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {parcelView3D ? '2D' : '3D'}
                  </button>
                )}
                <button
                  onClick={handleOpenWorkspace}
                  className="flex items-center gap-1.5 bg-[#C00000] hover:bg-[#8B0000] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
                >
                  <PlusCircle className="w-4 h-4" />
                  เพิ่ม IMT
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 relative overflow-hidden">
            <MapView
              key={dashboardRefreshKey}
              onMapClick={handleMapClick}
              selectedLat={selectedLat}
              selectedLon={selectedLon}
              blocks={[]}
              mapStyle={mapStyle}
              cellRadius={workspaceCellRadius}
              centerLat={selectedLat}
              centerLon={selectedLon}
              clickMode="pan"
              workspaceOpen={showDashboardWorkspace}
              highlightStationNames={highlightStationNames}
              parcelPolygon={plottedPolygon}
              parcelTowers={parcelTowers}
              parcelCentroid={parcelCentroid}
              view3D={parcelView3D}
            />

            {(showDashboardWorkspace || workspaceClosing) && (
              <div
                className={`absolute inset-y-0 right-0 w-[60%] min-w-[400px] bg-white border-l border-gray-300 shadow-2xl z-20 ${
                  workspaceClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'
                }`}
              >
                <IMTAddWorkspace
                  onBack={handleCloseWorkspace}
                  mode="panel"
                  onPlotPolygon={(vertices) => {
                    setPlottedPolygon(vertices.length > 0 ? vertices : null)
                  }}
                />
              </div>
            )}
          </div>
        </div>
      ) : tab === 'fslinks' ? (
        <div className="flex-1 overflow-hidden">
          <FSLinkManager />
        </div>
      ) : tab === 'imt' ? (
        <div className="flex-1 overflow-hidden">
          <IMTManager onViewPolygon={(coords, towers, centroid) => {
            setPlottedPolygon(coords)
            setParcelTowers(towers)
            setParcelCentroid(centroid)
            setTab('dashboard')  // Auto-switch to see polygon on map
          }} />
        </div>
      ) : tab === 'polygon' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shadow-sm z-10">
            <h2 className="text-sm font-semibold text-[#1A1A2E]">
              สร้างโพลีกอนที่ดิน
            </h2>
            {!showPolygonWorkspace && (
              <button
                onClick={() => {
                  setShowPolygonWorkspace(true)
                  setPolygonVertices([])
                }}
                className="flex items-center gap-1.5 bg-[#C00000] hover:bg-[#8B0000] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
              >
                <PlusCircle className="w-4 h-4" />
                เพิ่มที่ดิน
              </button>
            )}
          </div>
          <div className="flex-1 relative overflow-hidden">
            <MapView
              key={dashboardRefreshKey}
              onMapClick={(lat, lon) => {
                if (polygonDrawingMode) {
                  setPolygonVertices(prev => [...prev, [lon, lat]])
                }
              }}
              onVertexDrag={(index, lon, lat) => {
                setPolygonVertices(prev => {
                  const next = [...prev]
                  next[index] = [lon, lat]
                  return next
                })
              }}
              selectedLat={selectedLat}
              selectedLon={selectedLon}
              blocks={[]}
              mapStyle={mapStyle}
              cellRadius={workspaceCellRadius}
              centerLat={selectedLat}
              centerLon={selectedLon}
              clickMode={polygonDrawingMode ? 'draw_polygon' : 'pan'}
              workspaceOpen={showPolygonWorkspace}
              highlightStationNames={undefined}
              polygonVertices={polygonVertices}
            />
            {(showPolygonWorkspace || polygonClosing) && (
              <div
                className={`absolute inset-y-0 right-0 w-[40%] min-w-[380px] bg-white border-l border-gray-300 shadow-2xl z-20 ${
                  polygonClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'
                }`}
              >
                <PolygonCreator
                  onClose={() => {
                    setPolygonClosing(true)
                    setTimeout(() => {
                      setShowPolygonWorkspace(false)
                      setPolygonClosing(false)
                      setPolygonDrawingMode(false)
                      setPolygonVertices([])
                    }, 600)
                  }}
                  vertices={polygonVertices}
                  onVerticesChange={setPolygonVertices}
                  drawingMode={polygonDrawingMode}
                  onDrawingModeChange={setPolygonDrawingMode}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <QueryPanel onZoomTo={handleZoomTo} />
        </div>
      )}
    </div>
  )
}
