import { CheckCircle, Shield, XCircle } from 'lucide-react'
import { BlockResult } from '../types'

interface BlockPanelProps {
  blocks: BlockResult[]
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
        Spectrum Analysis
      </h2>

      {/* Summary */}
      <div className="flex gap-2 mb-4 text-sm">
        <div className="flex-1 text-center p-2 bg-green-50 rounded border border-green-100">
          <div className="font-bold text-[#16A34A]">{summary.green}</div>
          <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
            <CheckCircle className="w-3 h-3" /> Available
          </div>
        </div>
        <div className="flex-1 text-center p-2 bg-gray-50 rounded border border-gray-100">
          <div className="font-bold text-gray-500">{summary.gray}</div>
          <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
            <Shield className="w-3 h-3" /> Guard
          </div>
        </div>
        <div className="flex-1 text-center p-2 bg-red-50 rounded border border-red-100">
          <div className="font-bold text-[#DC2626]">{summary.red}</div>
          <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
            <XCircle className="w-3 h-3" /> Blocked
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-400 mb-3">
        {summary.totalMhz} MHz available from 190 MHz
      </div>

      {/* Block Grid */}
      <div className="grid grid-cols-4 gap-1.5 mb-4">
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
      <div className="flex gap-3 text-xs text-gray-500 mb-4">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#16A34A' }} />
          Available
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#9CA3AF' }} />
          Guard
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#DC2626' }} />
          Blocked
        </div>
      </div>

      {/* Conflicts only */}
      <div className="space-y-1.5 max-h-60 overflow-y-auto">
        {blocks.filter(b => b.status !== 'green').map((b, i) => (
          <div key={i} className="text-xs p-2 bg-gray-50 rounded border border-gray-100">
            <span className="font-mono font-medium">{b.freq_low}-{b.freq_high} MHz</span>
            <span className="text-gray-400"> — {b.reason}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
