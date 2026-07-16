import { useState, useCallback } from 'react'
import { LogIn, Shield } from 'lucide-react'
import MapView, { MAP_STYLES } from './MapView'
import type { AllocationBlock } from '../types'

interface PublicDashboardProps {
  onNavigateLogin: () => void
}

export default function PublicDashboard({ onNavigateLogin }: PublicDashboardProps) {
  const [selectedLat, setSelectedLat] = useState<number | null>(null)
  const [selectedLon, setSelectedLon] = useState<number | null>(null)
  const [blocks] = useState<AllocationBlock[]>([])
  const [mapStyle] = useState('voyager')

  const handleMapClick = useCallback((lat: number, lon: number) => {
    setSelectedLat(lat)
    setSelectedLon(lon)
  }, [])

  return (
    <div className="h-screen flex flex-col">
      {/* Public NBTC Header */}
      <header className="nbtc-header px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">
              ระบบจัดสรรคลื่นความถี่ IMT Private Network
            </h1>
            <p className="text-xs opacity-80 leading-tight">
              4800-4990 MHz | NBTC
            </p>
          </div>
        </div>

        <button
          onClick={onNavigateLogin}
          className="flex items-center gap-2 bg-white text-[#C00000] font-semibold px-4 py-2 rounded-lg text-sm hover:bg-gray-100 transition-colors shadow-sm"
        >
          <LogIn className="w-4 h-4" />
          เขาสูระบบสำหรับเจาหนาที่
        </button>
      </header>

      {/* Map Area */}
      <div className="flex-1 relative">
        <MapView
          onMapClick={handleMapClick}
          selectedLat={selectedLat}
          selectedLon={selectedLon}
          blocks={blocks}
          mapStyle={mapStyle}
        />

        {/* Click coordinates display */}
        {selectedLat && selectedLon && (
          <div className="absolute top-4 right-4 z-10 bg-white/90 backdrop-blur rounded-lg shadow-lg p-3 text-sm font-mono text-gray-600 border border-gray-200">
            {selectedLat.toFixed(6)}, {selectedLon.toFixed(6)}
          </div>
        )}

        {/* Watermark */}
        <div className="absolute bottom-4 left-4 z-10 text-xs text-gray-400 bg-white/80 backdrop-blur rounded px-3 py-1.5 border border-gray-100">
          NBTC IMT Private Network 4800-4990 MHz
        </div>
      </div>
    </div>
  )
}
