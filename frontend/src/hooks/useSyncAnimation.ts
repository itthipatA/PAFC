import { useState, useRef, useCallback, useEffect } from 'react'
import { debounce, sleep } from '../utils/animation'

// ─── Types ────────────────────────────────────────────────────

export interface SyncAnimationOptions {
  /** Called when lat/lon sync fires (after debounce) */
  onSyncLatLon?: (lat: number, lon: number) => void
  /** Called when radius sync fires */
  onSyncRadius?: (radius: number) => void
  /** Called when antenna type changes */
  onSyncAntenna?: (type: 'omni' | 'sector') => void
  /** Called when propagation model changes */
  onSyncModel?: (model: string) => void
  /** Called when analyze phase changes */
  onSyncAnalyze?: () => void
  /** Called when results should be revealed (with item count for stagger) */
  onSyncResults?: (itemCount: number) => void
}

export interface SyncAnimation {
  /** Sync lat/lon (debounced 300ms) */
  syncLatLon: (lat: number, lon: number) => void
  /** Sync radius (debounced 200ms) */
  syncRadius: (radius: number) => void
  /** Sync antenna type — triggers morph animation */
  syncAntenna: (type: 'omni' | 'sector') => void
  /** Sync propagation model — transitions coverage color */
  syncModel: (model: string) => void
  /** Trigger analyze pulse wave → reveal */
  syncAnalyze: () => Promise<void>
  /** Reveal results with stagger */
  syncResults: (itemCount: number) => Promise<void>
  /** Whether a transition animation is in progress */
  isAnimating: boolean
  /** Current analyze phase */
  analyzePhase: 'idle' | 'pulsing' | 'revealing'
}

// ─── Hook ─────────────────────────────────────────────────────

export function useSyncAnimation(
  options: SyncAnimationOptions = {}
): SyncAnimation {
  const { onSyncLatLon, onSyncRadius, onSyncAntenna, onSyncModel, onSyncAnalyze, onSyncResults } = options

  const [isAnimating, setIsAnimating] = useState(false)
  const [analyzePhase, setAnalyzePhase] = useState<'idle' | 'pulsing' | 'revealing'>('idle')

  // Keep refs for latest callbacks (avoid stale closures)
  const optionsRef = useRef(options)
  optionsRef.current = options

  // ─── Debounced sync callbacks ──────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedLatLon = useRef(
    debounce((lat: number, lon: number) => {
      optionsRef.current.onSyncLatLon?.(lat, lon)
    }, 300)
  ).current

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedRadius = useRef(
    debounce((radius: number) => {
      optionsRef.current.onSyncRadius?.(radius)
    }, 200)
  ).current

  // ─── syncLatLon ────────────────────────────────────────────────
  const syncLatLon = useCallback(
    (lat: number, lon: number) => {
      debouncedLatLon(lat, lon)
    },
    [debouncedLatLon]
  )

  // ─── syncLatLonImmediate (for OK button) ──────────────────────

  // ─── syncRadius ───────────────────────────────────────────────
  const syncRadius = useCallback(
    (radius: number) => {
      debouncedRadius(radius)
    },
    [debouncedRadius]
  )

  // ─── syncAntenna ──────────────────────────────────────────────
  const syncAntenna = useCallback(
    (type: 'omni' | 'sector') => {
      setIsAnimating(true)
      optionsRef.current.onSyncAntenna?.(type)
      // Clear animating flag after transition duration
      setTimeout(() => setIsAnimating(false), 500)
    },
    []
  )

  // ─── syncModel ────────────────────────────────────────────────
  const syncModel = useCallback(
    (model: string) => {
      setIsAnimating(true)
      optionsRef.current.onSyncModel?.(model)
      setTimeout(() => setIsAnimating(false), 600)
    },
    []
  )

  // ─── syncAnalyze ──────────────────────────────────────────────
  const syncAnalyze = useCallback(async () => {
    setIsAnimating(true)
    setAnalyzePhase('pulsing')
    optionsRef.current.onSyncAnalyze?.()

    // Pulse for 1200ms then transition to revealing
    await sleep(1200)
    setAnalyzePhase('revealing')
  }, [])

  // ─── syncResults ──────────────────────────────────────────────
  const syncResults = useCallback(
    async (itemCount: number) => {
      setIsAnimating(true)
      // Stagger reveal — 50ms per result item
      optionsRef.current.onSyncResults?.(itemCount)
      await sleep(itemCount * 50 + 100)
      setIsAnimating(false)
    },
    []
  )

  // ─── Cleanup animate state on unmount ─────────────────────────
  useEffect(() => {
    return () => {
      setAnalyzePhase('idle')
      setIsAnimating(false)
    }
  }, [])

  return {
    syncLatLon,
    syncRadius,
    syncAntenna,
    syncModel,
    syncAnalyze,
    syncResults,
    isAnimating,
    analyzePhase,
  }
}
