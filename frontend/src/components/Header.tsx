import { Map, Globe, Radio } from 'lucide-react'
import { MAP_STYLES } from './MapView'

interface HeaderProps {
  model: string
  onModelChange: (model: string) => void
  mapStyle: string
  onMapStyleChange: (style: string) => void
}

const MODELS = [
  { id: 'free_space', label: 'Free Space' },
  { id: 'p452', label: 'ITU-R P.452' },
  { id: 'hata', label: 'Hata' },
]

export default function Header({ model, onModelChange, mapStyle, onMapStyleChange }: HeaderProps) {
  return (
    <header className="nbtc-header px-6 py-3 flex items-center justify-between shadow-md">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">PAFC</h1>
            <p className="text-xs opacity-80 leading-tight">
              Private Automated Frequency Coordinator
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Map Style Selector */}
        <div className="flex items-center gap-1.5 bg-white/10 rounded-lg px-2 py-1">
          <Globe className="w-4 h-4 opacity-70" />
          <select
            value={mapStyle}
            onChange={(e) => onMapStyleChange(e.target.value)}
            className="bg-transparent text-white text-sm cursor-pointer border-none outline-none"
          >
            {Object.entries(MAP_STYLES).map(([key, s]) => (
              <option key={key} value={key} className="text-gray-900">
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <span className="text-xs opacity-70">4800-4990 MHz</span>

        {/* Propagation Model */}
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="bg-white/15 text-white border border-white/20 rounded px-3 py-1.5 text-sm cursor-pointer"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id} className="text-gray-900">
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </header>
  )
}
