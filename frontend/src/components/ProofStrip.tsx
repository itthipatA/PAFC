import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

function countOf(data: unknown): number {
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (typeof o.count === 'number') return o.count
    for (const k of ['links', 'allocations', 'items']) {
      if (Array.isArray(o[k])) return (o[k] as unknown[]).length
    }
  }
  if (Array.isArray(data)) return data.length
  return 0
}

export default function ProofStrip() {
  const { fetchWithAuth } = useAuth()
  const [fsCount, setFsCount] = useState<number | null>(null)
  const [imtCount, setImtCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchWithAuth('/api/fs-links/')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setFsCount(countOf(data))
      })
      .catch(() => {
        if (!cancelled) setFsCount(0)
      })
    fetchWithAuth('/api/imt/')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setImtCount(countOf(data))
      })
      .catch(() => {
        if (!cancelled) setImtCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [fetchWithAuth])

  return (
    <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none flex justify-center">
      <div className="flex items-stretch gap-2 bg-[#1A1A2E]/90 text-white pl-1.5 pr-3 py-1 rounded-b-lg shadow-md">
        <span className="w-1 rounded-full bg-[#C00000]" aria-hidden="true" />
        <span
          className="self-center w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: '#C9A227' }}
          aria-hidden="true"
        />
        <span className="font-mono text-[11px] tracking-wide self-center">
          {fsCount ?? '–'} ลิงก์ · {imtCount ?? '–'} IMT · ย่าน 4800–4990 MHz
        </span>
      </div>
    </div>
  )
}
