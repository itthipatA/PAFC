import { BlockResult } from '../types'

interface BlockPanelProps {
  blocks: BlockResult[]
}

const STATUS_LABELS: Record<string, string> = {
  green: 'ใช้ได้',
  gray: 'Guard Band',
  red: 'ใช้ไม่ได้',
}

const STATUS_ICONS: Record<string, string> = {
  green: '🟢',
  gray: '⚪',
  red: '🔴',
}

export default function BlockPanel({ blocks }: BlockPanelProps) {
  const summary = {
    green: blocks.filter(b => b.status === 'green').length,
    gray: blocks.filter(b => b.status === 'gray').length,
    red: blocks.filter(b => b.status === 'red').length,
    totalMhz: blocks.filter(b => b.status === 'green').length * 10,
  }

  return (
    <div className="p-4">
      <h2 className="text-base font-bold text-[#1A365D] mb-3">
        ผลการวิเคราะห์ Spectrum
      </h2>

      {/* Summary */}
      <div className="flex gap-2 mb-4 text-sm">
        <div className="flex-1 text-center p-2 bg-green-50 rounded">
          <div className="font-bold text-[#16A34A]">{summary.green}</div>
          <div className="text-xs text-gray-500">ใช้ได้</div>
        </div>
        <div className="flex-1 text-center p-2 bg-gray-50 rounded">
          <div className="font-bold text-gray-500">{summary.gray}</div>
          <div className="text-xs text-gray-500">Guard</div>
        </div>
        <div className="flex-1 text-center p-2 bg-red-50 rounded">
          <div className="font-bold text-[#DC2626]">{summary.red}</div>
          <div className="text-xs text-gray-500">ไม่ได้</div>
        </div>
      </div>

      <div className="text-xs text-gray-400 mb-3">
        {summary.totalMhz} MHz available จาก 190 MHz
      </div>

      {/* Block Grid */}
      <div className="grid grid-cols-4 gap-1.5">
        {blocks.map((b, i) => (
          <div
            key={i}
            title={`${b.freq_low}-${b.freq_high} MHz: ${b.reason}`}
            className={`block-cell ${b.status}`}
          >
            {Math.round(b.freq_low)}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 space-y-1.5 text-xs text-gray-500">
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded`} style={{
              backgroundColor: key === 'green' ? '#16A34A' : key === 'gray' ? '#9CA3AF' : '#DC2626'
            }} />
            {label}
          </div>
        ))}
      </div>

      {/* Detail */}
      <div className="mt-4 space-y-1.5 max-h-60 overflow-y-auto">
        {blocks.filter(b => b.status !== 'green').map((b, i) => (
          <div key={i} className="text-xs p-2 bg-gray-50 rounded">
            <span className="font-mono font-medium">{b.freq_low}-{b.freq_high} MHz</span>
            <span className="text-gray-400"> — {b.reason}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
