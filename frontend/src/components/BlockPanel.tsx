import { useState } from 'react'
import { CheckCircle, Shield, XCircle, Info } from 'lucide-react'
import { BlockResult } from '../types'

interface BlockPanelProps {
  blocks: BlockResult[]
}

export default function BlockPanel({ blocks }: BlockPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const statusCounts = {
    available: blocks.filter((b) => b.status === 'green').length,
    guard: blocks.filter((b) => b.status === 'gray').length,
    blocked: blocks.filter((b) => b.status === 'red').length,
  }
  const totalMhz = statusCounts.available * 10

  // Sort blocks by freq_low for display
  const sorted = [...blocks].sort((a, b) => a.freq_low - b.freq_low)

  const statusColor = (status: string): string => {
    if (status === 'green') return '#16A34A'
    if (status === 'gray') return '#9CA3AF'
    return '#DC2626'
  }

  const statusBg = (status: string): string => {
    if (status === 'green') return 'bg-green-500'
    if (status === 'gray') return 'bg-gray-400'
    return 'bg-red-500'
  }

  return (
    <div className="p-4">
      <h2 className="text-base font-bold text-[#1A365D] mb-3">
        ผลการวิเคราะห์คลื่นความถี่
      </h2>

      {/* Summary row */}
      <div className="flex gap-2 mb-3 text-sm">
        <div className="flex-1 text-center p-2 bg-green-50 rounded border border-green-100">
          <div className="font-bold text-[#16A34A]">{statusCounts.available}</div>
          <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
            <CheckCircle className="w-3 h-3" /> ว่าง
          </div>
        </div>
        <div className="flex-1 text-center p-2 bg-gray-50 rounded border border-gray-100">
          <div className="font-bold text-gray-500">{statusCounts.guard}</div>
          <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
            <Shield className="w-3 h-3" /> Guard
          </div>
        </div>
        <div className="flex-1 text-center p-2 bg-red-50 rounded border border-red-100">
          <div className="font-bold text-[#DC2626]">{statusCounts.blocked}</div>
          <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
            <XCircle className="w-3 h-3" /> ถูกจอง
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-400 mb-3">
        {totalMhz} MHz ว่าง จากทั้งหมด 190 MHz
      </div>

      {/* Spectrum bar */}
      <div className="mb-1 flex h-8 rounded overflow-hidden border border-gray-300">
        {sorted.map((b, i) => (
          <div
            key={i}
            title={`${b.freq_low.toFixed(0)}-${b.freq_high.toFixed(0)} MHz: ${b.reason}`}
            className={`flex-1 ${statusBg(b.status)} cursor-pointer hover:brightness-110 relative`}
            style={{
              backgroundColor: statusColor(b.status),
              minWidth: `${Math.max(100 / sorted.length, 1)}%`,
              border: '1px solid #000',
            }}
            onClick={() => setSelectedIndex(selectedIndex === i ? null : i)}
          />
        ))}
      </div>

      {/* X-axis labels */}
      <div className="flex justify-between mb-4">
        <span className="text-xs text-gray-400 font-mono">4800</span>
        <span className="text-xs text-gray-400 font-mono">4820</span>
        <span className="text-xs text-gray-400 font-mono">4840</span>
        <span className="text-xs text-gray-400 font-mono">4860</span>
        <span className="text-xs text-gray-400 font-mono">4880</span>
        <span className="text-xs text-gray-400 font-mono">4900</span>
        <span className="text-xs text-gray-400 font-mono">4920</span>
        <span className="text-xs text-gray-400 font-mono">4940</span>
        <span className="text-xs text-gray-400 font-mono">4960</span>
        <span className="text-xs text-gray-400 font-mono">4980</span>
        <span className="text-xs text-gray-400 font-mono">4990</span>
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-xs text-gray-500 mb-4">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#16A34A' }} />
          ว่าง
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#9CA3AF' }} />
          Guard Band
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#DC2626' }} />
          ถูกจอง
        </div>
      </div>

      {/* Selected block detail */}
      {selectedIndex !== null && sorted[selectedIndex] && (
        <div className="mb-3 p-3 bg-white rounded border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold text-[#1A1A2E]">
              {sorted[selectedIndex].freq_low.toFixed(0)}-{sorted[selectedIndex].freq_high.toFixed(0)} MHz
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              sorted[selectedIndex].status === 'green' ? 'bg-green-100 text-green-700' :
              sorted[selectedIndex].status === 'gray' ? 'bg-gray-100 text-gray-600' :
              'bg-red-100 text-red-700'
            }`}>
              {sorted[selectedIndex].status === 'green' ? 'ว่าง' : sorted[selectedIndex].status === 'gray' ? 'Guard Band' : 'ถูกจอง'}
            </span>
          </div>
          <p className="text-xs text-gray-600">
            <Info className="w-3 h-3 inline mr-1" />
            {sorted[selectedIndex].status === 'green' ? 'สามารถจัดสรรได้' :
             sorted[selectedIndex].status === 'red' ? `ไม่สามารถจัดสรรได้ — ${sorted[selectedIndex].reason}` :
             `Guard Band — ${sorted[selectedIndex].reason}`}
          </p>
        </div>
      )}

      {/* Conflicts detail */}
      <div className="space-y-1.5 max-h-60 overflow-y-auto">
        {blocks
          .filter((b) => b.status !== 'green')
          .map((b, i) => (
            <div key={i} className="text-xs p-2 bg-gray-50 rounded border border-gray-100">
              <span className="font-mono font-medium">
                {b.freq_low.toFixed(0)}-{b.freq_high.toFixed(0)} MHz
              </span>
              <span className="text-gray-400"> - {b.reason}</span>
            </div>
          ))}
      </div>
    </div>
  )
}
