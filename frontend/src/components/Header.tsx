interface HeaderProps {
  model: string
  onModelChange: (model: string) => void
}

const MODELS = [
  { id: 'free_space', label: 'Free Space' },
  { id: 'p452', label: 'ITU-R P.452' },
  { id: 'hata', label: 'Hata' },
]

export default function Header({ model, onModelChange }: HeaderProps) {
  return (
    <header className="nbtc-header px-6 py-3 flex items-center justify-between shadow-md">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white rounded flex items-center justify-center">
            <span className="text-[#C00000] font-bold text-sm">RF</span>
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
        <span className="text-xs opacity-80">ย่าน 4800-4990 MHz</span>
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
