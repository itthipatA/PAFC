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

const NAV_ITEMS: { tab: Tab; icon: typeof Layout; label: string }[] = [
  { tab: 'dashboard', icon: Layout, label: 'Dashboard' },
  { tab: 'fslinks', icon: MapIcon, label: 'FS Links' },
  { tab: 'imt', icon: Radio, label: 'IMT' },
  { tab: 'polygon', icon: Octagon, label: 'สร้างโพลีกอน' },
  { tab: 'search', icon: Search, label: 'ค้นหา' },
]

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

  const renderContent = () => {
    if (tab === 'dashboard') {
      return (
        <div className="flex-1 relative overflow-hidden animate-fade-in">
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

          {/* Floating 3D toggle */}
          {plottedPolygon && (
            <button
              onClick={() => setParcelView3D(!parcelView3D)}
              className={`absolute bottom-4 left-4 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors z-10 ${
                parcelView3D
                  ? 'bg-[#C00000] text-white border-[#C00000]'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50 shadow-sm'
              }`}
            >
              {parcelView3D ? '2D' : '3D'}
            </button>
          )}

          {/* Floating "เพิ่ม IMT" button */}
          {!showDashboardWorkspace && (
            <button
              onClick={handleOpenWorkspace}
              className="absolute bottom-4 right-4 flex items-center gap-1.5 bg-[#C00000] hover:bg-[#8B0000] text-white px-4 py-2.5 rounded-full text-sm font-semibold transition-colors shadow-lg z-10"
            >
              <PlusCircle className="w-4 h-4" />
              เพิ่ม IMT
            </button>
          )}

          {/* Dashboard workspace panel — slides from right (40% width) */}
          {(showDashboardWorkspace || workspaceClosing) && (
            <div
              className={`absolute inset-y-0 right-0 w-[40%] min-w-[400px] bg-white border-l border-[#E5E5E0] shadow-2xl z-20 ${
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
      )
    }

    if (tab === 'fslinks') {
      return (
        <div className="flex-1 overflow-hidden animate-fade-in">
          <FSLinkManager />
        </div>
      )
    }

    if (tab === 'imt') {
      return (
        <div className="flex-1 overflow-hidden animate-fade-in">
          <IMTManager
            onViewPolygon={(coords, towers, centroid) => {
              setPlottedPolygon(coords)
              setParcelTowers(towers)
              setParcelCentroid(centroid)
              setTab('dashboard')
            }}
            onAdd={() => {
              setTab('dashboard')
              handleOpenWorkspace()
            }}
          />
        </div>
      )
    }

    if (tab === 'polygon') {
      return (
        <div className="flex-1 relative overflow-hidden animate-fade-in">
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

          {/* Floating "เพิ่มที่ดิน" button */}
          {!showPolygonWorkspace && (
            <button
              onClick={() => {
                setShowPolygonWorkspace(true)
                setPolygonVertices([])
              }}
              className="absolute bottom-4 right-4 flex items-center gap-1.5 bg-[#C00000] hover:bg-[#8B0000] text-white px-4 py-2.5 rounded-full text-sm font-semibold transition-colors shadow-lg z-10"
            >
              <PlusCircle className="w-4 h-4" />
              เพิ่มที่ดิน
            </button>
          )}

          {/* Polygon creator panel — slides from right (40% width) */}
          {(showPolygonWorkspace || polygonClosing) && (
            <div
              className={`absolute inset-y-0 right-0 w-[40%] min-w-[400px] bg-white border-l border-[#E5E5E0] shadow-2xl z-20 ${
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
      )
    }

    // search tab
    return (
      <div className="flex-1 overflow-hidden animate-fade-in">
        <QueryPanel onZoomTo={handleZoomTo} />
      </div>
    )
  }

  return (
    <div className="h-screen flex">
      {/* ── SIDEBAR (56px, dark navy #1A1A2E) ────────────────── */}
      <aside className="w-[56px] bg-[#1A1A2E] flex flex-col items-center py-2 shrink-0">
        {/* Logo */}
        <div className="w-10 h-10 mb-2 flex items-center justify-center">
          <Shield className="w-5 h-5 text-white" />
        </div>

        {/* Nav items */}
        <nav className="flex flex-col items-center gap-1 flex-1">
          {NAV_ITEMS.map(({ tab: navTab, icon: Icon, label }) => (
            <div key={navTab} className="relative group">
              <button
                onClick={() => setTab(navTab)}
                className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
                  tab === navTab
                    ? 'bg-[#C00000] text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
                aria-label={label}
              >
                <Icon className="w-5 h-5" />
              </button>
              {/* Tooltip */}
              <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#1A1A2E] text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                {label}
              </span>
            </div>
          ))}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Map style selector */}
        <div className="relative group mb-2">
          <button
            className="w-10 h-10 flex items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="เปลี่ยนรูปแบบแผนที่"
          >
            <Globe className="w-5 h-5" />
          </button>
          {/* Tooltip */}
          <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#1A1A2E] text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
            เปลี่ยนรูปแบบแผนที่
          </span>
          {/* Dropdown menu */}
          <div className="absolute left-full bottom-0 ml-2 bg-white rounded-lg shadow-lg border border-gray-200 py-1 w-36 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50">
            {Object.entries(MAP_STYLES).map(([key, s]) => (
              <button
                key={key}
                onClick={() => setMapStyle(key)}
                className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 transition-colors ${
                  mapStyle === key ? 'text-[#C00000] font-semibold' : 'text-gray-700'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* User avatar (first letter) */}
        {user && (
          <div className="w-8 h-8 rounded-full bg-[#C00000] flex items-center justify-center text-white text-xs font-bold mb-1">
            {user.username.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Logout */}
        <button
          onClick={onLogout}
          className="w-10 h-10 flex items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          title="ออกจากระบบ"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </aside>

      {/* ── MAIN CONTENT AREA (flex-1) ──────────────────────── */}
      {renderContent()}
    </div>
  )
}
