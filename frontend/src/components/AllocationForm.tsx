import { useState } from 'react'

interface AllocationFormProps {
  lat: number
  lon: number
  onAnalyze: (params: {
    cell_radius: number
    antenna_height: number
    antenna_gain: number
    max_eirp: number
  }) => void
  loading: boolean
}

export default function AllocationForm({ lat, lon, onAnalyze, loading }: AllocationFormProps) {
  const [cellRadius, setCellRadius] = useState(500)
  const [antennaHeight, setAntennaHeight] = useState(15)
  const [antennaGain, setAntennaGain] = useState(12)
  const [maxEirp, setMaxEirp] = useState(23)

  return (
    <div>
      <h3 className="font-bold text-[#1A365D] mb-2 text-sm">
        📍 วิเคราะห์พื้นที่
      </h3>

      <div className="text-xs text-gray-500 mb-3 font-mono">
        {lat.toFixed(6)}, {lon.toFixed(6)}
      </div>

      {/* Parameters */}
      <div className="space-y-2 mb-3">
        <div>
          <label className="text-xs text-gray-500 block mb-0.5">
            Cell Radius (m)
          </label>
          <input
            type="number"
            value={cellRadius}
            onChange={(e) => setCellRadius(Number(e.target.value))}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-0.5">
            Antenna Height (m AGL)
          </label>
          <input
            type="number"
            value={antennaHeight}
            onChange={(e) => setAntennaHeight(Number(e.target.value))}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">
              Antenna Gain (dBi)
            </label>
            <input
              type="number"
              value={antennaGain}
              onChange={(e) => setAntennaGain(Number(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">
              Max EIRP (dBm)
            </label>
            <input
              type="number"
              value={maxEirp}
              onChange={(e) => setMaxEirp(Number(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </div>

      <button
        onClick={() => onAnalyze({
          cell_radius: cellRadius,
          antenna_height: antennaHeight,
          antenna_gain: antennaGain,
          max_eirp: maxEirp,
        })}
        disabled={loading}
        className="w-full bg-[#C00000] hover:bg-[#8B0000] text-white font-medium py-2 rounded text-sm transition-colors disabled:opacity-50"
      >
        {loading ? 'กำลังคำนวณ...' : '🔍 วิเคราะห์ Spectrum'}
      </button>
    </div>
  )
}
