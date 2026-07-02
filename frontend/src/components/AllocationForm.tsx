import { useState, useEffect } from 'react'
import { Search, MapPin, X, Radio } from 'lucide-react'

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
  onClose: () => void
  model: string
  onModelChange: (m: string) => void
}

export default function AllocationForm({ lat, lon, onAnalyze, loading, onClose, model, onModelChange }: AllocationFormProps) {
  const [cellRadius, setCellRadius] = useState(500)
  const [antennaHeight, setAntennaHeight] = useState(15)
  const [antennaGain, setAntennaGain] = useState(12)
  const [maxEirp, setMaxEirp] = useState(23)
  const [logLines, setLogLines] = useState<string[]>([])

  // ESC key listener
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Calc log: add lines when loading, clear when not loading
  useEffect(() => {
    if (loading) {
      setLogLines([])
      const steps = [
        'กำลังคำนวณ propagation loss...',
        'กำลังตรวจสอบ FS links...',
        'กำลังวิเคราะห์ guard band...',
        'กำลังสรุปผล...',
      ]
      let i = 0
      const timer = setInterval(() => {
        setLogLines((prev) => {
          if (i < steps.length) {
            const next = prev.concat(steps[i])
            i++
            return next
          }
          return prev
        })
      }, 500)
      return () => clearInterval(timer)
    } else {
      setLogLines([])
    }
  }, [loading])

  return (
    <div className="relative">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-0 right-0 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
        title="ปิด"
      >
        <X className="w-4 h-4" />
      </button>

      <h3 className="font-bold text-[#1A365D] mb-2 text-sm flex items-center gap-1.5 pr-6">
        <MapPin className="w-4 h-4 text-[#C00000]" />
        วิเคราะห์ตำแหน่ง
      </h3>

      <div className="text-xs text-gray-500 mb-3 font-mono">
        {lat.toFixed(6)}, {lon.toFixed(6)}
      </div>

      <div className="space-y-2 mb-3">
        <div>
          <label className="text-xs text-gray-500 block mb-0.5">Propagation Model</label>
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
          >
            <option value="free_space">Free Space</option>
            <option value="p452">ITU-R P.452</option>
            <option value="hata">Hata</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-0.5">
            รัศมีเซลล์ (m)
          </label>
          <input
            type="number"
            value={cellRadius}
            onChange={(e) => setCellRadius(Number(e.target.value))}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-0.5">
            ความสูงเสาอากาศ (m AGL)
          </label>
          <input
            type="number"
            value={antennaHeight}
            onChange={(e) => setAntennaHeight(Number(e.target.value))}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">
              อัตราขยาย (dBi)
            </label>
            <input
              type="number"
              value={antennaGain}
              onChange={(e) => setAntennaGain(Number(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
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
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() =>
            onAnalyze({
              cell_radius: cellRadius,
              antenna_height: antennaHeight,
              antenna_gain: antennaGain,
              max_eirp: maxEirp,
            })
          }
          disabled={loading}
          className="flex-1 bg-[#C00000] hover:bg-[#8B0000] text-white font-medium py-2 rounded text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Search className="w-4 h-4" />
          {loading ? 'กำลังวิเคราะห์...' : 'วิเคราะห์คลื่นความถี่'}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors"
        >
          ยกเลิก
        </button>
      </div>

      {logLines.length > 0 && (
        <div className="mt-3 p-2 bg-gray-50 rounded border border-gray-100 text-xs font-mono text-gray-600 max-h-24 overflow-y-auto">
          {logLines.map((line, i) => (
            <div key={i} className="py-0.5 transition-opacity duration-300" style={{ opacity: 1 }}>
              [{i + 1}/4] {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
