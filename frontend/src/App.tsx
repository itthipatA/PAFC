import { useState, useCallback } from 'react'
import MapView from './components/MapView'
import Header from './components/Header'
import BlockPanel from './components/BlockPanel'
import AllocationForm from './components/AllocationForm'
import { BlockResult } from './types'

export default function App() {
  const [selectedLat, setSelectedLat] = useState<number | null>(null)
  const [selectedLon, setSelectedLon] = useState<number | null>(null)
  const [blocks, setBlocks] = useState<BlockResult[]>([])
  const [loading, setLoading] = useState(false)
  const [model, setModel] = useState('free_space')

  const handleMapClick = useCallback((lat: number, lon: number) => {
    setSelectedLat(lat)
    setSelectedLon(lon)
  }, [])

  const handleAnalyze = useCallback(async (params: {
    cell_radius: number
    antenna_height: number
    antenna_gain: number
    max_eirp: number
  }) => {
    if (!selectedLat || !selectedLon) return

    setLoading(true)
    try {
      const res = await fetch('/api/allocate/analyze', {
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
  }, [selectedLat, selectedLon, model])

  return (
    <div className="h-screen flex flex-col">
      <Header model={model} onModelChange={setModel} />

      <div className="flex-1 flex overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          <MapView
            onMapClick={handleMapClick}
            selectedLat={selectedLat}
            selectedLon={selectedLon}
            blocks={blocks}
          />

          {/* Floating panel */}
          {selectedLat && selectedLon && (
            <div className="absolute top-4 right-4 z-10 bg-white rounded-lg shadow-lg p-4 w-80">
              <AllocationForm
                lat={selectedLat}
                lon={selectedLon}
                onAnalyze={handleAnalyze}
                loading={loading}
              />
            </div>
          )}
        </div>

        {/* Block Results */}
        {blocks.length > 0 && (
          <div className="w-80 bg-white border-l overflow-y-auto">
            <BlockPanel blocks={blocks} />
          </div>
        )}
      </div>
    </div>
  )
}
