import { useState } from 'react'
import { CheckCircle, Shield, XCircle, Info } from 'lucide-react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { AllocationBlock } from '../types'

interface BlockPanelProps {
  blocks: AllocationBlock[]
}

export default function BlockPanel({ blocks }: BlockPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const reduced = useReducedMotion()

  const statusCounts = {
    available: blocks.filter((b) => b.status === 'available' && !b.can_be_guard).length,
    guard: blocks.filter((b) => b.can_be_guard).length,
    blocked: blocks.filter((b) => b.status !== 'available' && !b.can_be_guard).length,
  }
  const totalMhz = statusCounts.available * 10

  // Sort blocks by freq_low for display
  const sorted = [...blocks].sort((a, b) => a.freq_low - b.freq_low)

  const statusColor = (block: AllocationBlock): string => {
    if (block.can_be_guard) return '#9CA3AF'
    if (block.status === 'available') return '#16A34A'
    return '#DC2626'
  }

  const statusBg = (block: AllocationBlock): string => {
    if (block.can_be_guard) return 'bg-gray-400'
    if (block.status === 'available') return 'bg-green-500'
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
            title={`${b.freq_low.toFixed(0)}-${b.freq_high.toFixed(0)} MHz: ${b.reason_th}`}
            className={`flex-1 ${statusBg(b)} cursor-pointer hover:brightness-110 relative ${!reduced ? `animate-fade-in-up stagger-${Math.min(i + 1, 10)}` : ''}`}
            style={{
              backgroundColor: statusColor(b),
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
        <div className={`mb-3 p-3 bg-white rounded border border-gray-200 shadow-sm ${!reduced ? 'animate-scale-in' : ''}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold text-[#1A1A2E]">
              {sorted[selectedIndex].freq_low.toFixed(0)}-{sorted[selectedIndex].freq_high.toFixed(0)} MHz
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              sorted[selectedIndex].can_be_guard ? 'bg-gray-100 text-gray-600' :
              sorted[selectedIndex].status === 'available' ? 'bg-green-100 text-green-700' :
              'bg-red-100 text-red-700'
            }`}>
              {sorted[selectedIndex].can_be_guard ? 'Guard Band' :
               sorted[selectedIndex].status === 'available' ? 'ว่าง' : 'ถูกจอง'}
            </span>
          </div>
          <p className="text-xs text-gray-600">
            <Info className="w-3 h-3 inline mr-1" />
            {sorted[selectedIndex].can_be_guard
              ? `Guard Band — ${sorted[selectedIndex].guard_reason_th}`
              : sorted[selectedIndex].status === 'available'
                ? 'สามารถจัดสรรได้'
                : `ไม่สามารถจัดสรรได้ — ${sorted[selectedIndex].reason_th} (${sorted[selectedIndex].blocked_by.join(', ')})`
            }
          </p>
        </div>
      )}

      {/* Conflicts detail */}
      <div className="space-y-1.5 max-h-60 overflow-y-auto">
        {blocks
          .filter((b) => b.status !== 'available')
          .map((b, i) => (
            <div key={i} className="text-xs p-2 bg-gray-50 rounded border border-gray-100">
              <span className="font-mono font-medium">
                {b.freq_low.toFixed(0)}-{b.freq_high.toFixed(0)} MHz
              </span>
              <span className="text-gray-400"> - {b.reason_th}</span>
            </div>
          ))}
      </div>
    </div>
  )
}
