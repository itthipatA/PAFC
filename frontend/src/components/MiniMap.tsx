import { useState, useEffect, useMemo } from 'react'

// ─── Types ────────────────────────────────────────────────────

export type AntennaType = 'omni' | 'sector'
export type CoverageColorKey = 'inner' | 'mid' | 'outer'

export interface MiniMapProps {
  lat: number
  lon: number
  radius: number
  antennaType: AntennaType
  coverageColor?: CoverageColorKey
  isAnalyzing?: boolean
  analyzePhase?: 'idle' | 'pulsing' | 'revealing'
  isAnimating?: boolean
  sectorBeamwidth?: number
  sectorAzimuth?: number
  polygonVertices?: [number, number][]  // [lon, lat] from GeoJSON
  className?: string
}

// ─── Coverage color mapping (PAFC NBTC theme) ─────────────────

const COVERAGE_COLORS: Record<CoverageColorKey, { fill: string; stroke: string }> = {
  inner: { fill: 'rgba(13, 148, 136, 0.35)', stroke: '#0D9488' },  // Teal
  mid:   { fill: 'rgba(139, 92, 246, 0.30)', stroke: '#8B5CF6' },  // Violet
  outer: { fill: 'rgba(244, 114, 182, 0.25)', stroke: '#F472B6' }, // Pink
}

// Model → coverage color mapping
const MODEL_COLORS: Record<string, CoverageColorKey> = {
  free_space: 'inner',
  p452: 'mid',
  p2108: 'outer',
  p1411: 'mid',
  hata: 'inner',
}

// ─── Sector Wedge SVG path generator ──────────────────────────

function sectorWedgePath(radius: number, beamwidthDeg: number, azimuthDeg: number): string {
  // azimuth: 0 = North (up in SVG), clockwise
  // SVG: 0 = 3 o'clock (right), clockwise
  // So SVG angle = (azimuth - 90) — reversed for clockwise
  const halfBW = beamwidthDeg / 2
  const startAngleDeg = azimuthDeg - halfBW - 90
  const endAngleDeg = azimuthDeg + halfBW - 90

  const startRad = (startAngleDeg * Math.PI) / 180
  const endRad = (endAngleDeg * Math.PI) / 180

  const cx = 0
  const cy = 0

  const x1 = cx + Math.cos(startRad) * radius
  const y1 = cy + Math.sin(startRad) * radius
  const x2 = cx + Math.cos(endRad) * radius
  const y2 = cy + Math.sin(endRad) * radius

  const largeArcFlag = beamwidthDeg > 180 ? 1 : 0

  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`
}

// ─── Normalize lat/lon to local pixel coordinates (simple projection) ──

// We don't need real geo-projection — we just want a consistent relative position
// The component is always centered on (lat, lon), so lat/lon values only affect
// the map center label.

// ─── Component ─────────────────────────────────────────────────

export function MiniMap({
  lat,
  lon,
  radius,
  antennaType,
  coverageColor = 'inner',
  isAnalyzing = false,
  analyzePhase = 'idle',
  isAnimating = false,
  sectorBeamwidth = 120,
  sectorAzimuth = 0,
  polygonVertices,
  className = '',
}: MiniMapProps) {
  // Track previous antenna type for morph transition
  const [displayAntennaType, setDisplayAntennaType] = useState<AntennaType>(antennaType)

  useEffect(() => {
    // Smooth transition: update immediately for CSS transition to work
    setDisplayAntennaType(antennaType)
  }, [antennaType])

  // Normalize radius to SVG scale (max visual radius ~80px at 1000m)
  const maxVisualRadius = 90
  const minVisualRadius = 15
  const visualRadius = useMemo(() => {
    // log scale: 100m → ~18px, 500m → ~60px, 2000m → ~90px, 10000m → ~90px
    const logScale = Math.log10(Math.max(radius, 50))
    const raw = ((logScale - Math.log10(50)) / (Math.log10(5000) - Math.log10(50))) * maxVisualRadius
    return Math.max(minVisualRadius, Math.min(maxVisualRadius, raw + minVisualRadius))
  }, [radius])

  // Colors
  const colors = COVERAGE_COLORS[coverageColor]

  // Sector wedge path
  const wedgePath = sectorWedgePath(visualRadius, sectorBeamwidth, sectorAzimuth)

  // Polygon vertices → SVG path (projected relative to center)
  const polyPath = useMemo(() => {
    if (!polygonVertices || polygonVertices.length < 3) return ''
    // Compute bounds to auto-scale
    const lons = polygonVertices.map(v => v[0])
    const lats = polygonVertices.map(v => v[1])
    const cosCenter = Math.cos((lat * Math.PI) / 180)
    const metersPerDeg = 111320
    // Convert to meters relative to center
    const dxs = lons.map(l => (l - lon) * metersPerDeg * cosCenter)
    const dys = lats.map(l => -(l - lat) * metersPerDeg)  // negative: SVG y-axis
    // Auto-scale to fit viewBox (-110 to 110)
    const maxAbs = Math.max(...dxs.map(Math.abs), ...dys.map(Math.abs))
    const scale = maxAbs > 0 ? 100 / maxAbs : 1  // 100 SVG units for the furthest point
    return polygonVertices.map((v, i) => {
      const sx = dxs[i] * scale
      const sy = dys[i] * scale
      return `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)}`
    }).join(' ') + ' Z'
  }, [polygonVertices, lat, lon])

  // Pulse ring animations
  const pulseRings = [
    { delay: '0ms', duration: 'var(--dur-pulse)', scale: 0.4 },
    { delay: '200ms', duration: 'var(--dur-pulse)', scale: 0.7 },
    { delay: '400ms', duration: 'var(--dur-pulse)', scale: 1.0 },
  ]

  // Determine what mode we're in for rendering
  const isOmni = displayAntennaType === 'omni'
  const isSector = displayAntennaType === 'sector'
  const isPulsing = analyzePhase === 'pulsing'
  const isRevealing = analyzePhase === 'revealing'

  return (
    <div className={`relative overflow-hidden bg-[#F5F5F0] rounded-xl border border-gray-200 ${className}`}>
      {/* Grid background */}
      <svg
        viewBox="-120 -120 240 240"
        className="w-full h-full"
        style={{ minHeight: '200px' }}
      >
        {/* Background */}
        <defs>
          {/* Grid pattern */}
          <pattern id="minimap-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="0.5" />
          </pattern>

          {/* Clip for coverage circle — clips to viewBox */}
          <clipPath id="minimap-clip">
            <rect x="-120" y="-120" width="240" height="240" />
          </clipPath>

          {/* Radial gradient for coverage */}
          <radialGradient id="coverage-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={colors.fill.replace(/[\d.]+\)$/, '0.55)')} />
            <stop offset="60%" stopColor={colors.fill} />
            <stop offset="100%" stopColor={colors.fill.replace(/[\d.]+\)$/, '0.05)')} />
          </radialGradient>

          {/* Glow filter */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Grid background */}
        <rect x="-120" y="-120" width="240" height="240" fill="url(#minimap-grid)" />

        {/* Crosshair at center */}
        <line x1="-10" y1="0" x2="10" y2="0" stroke="rgba(0,0,0,0.15)" strokeWidth="0.5" />
        <line x1="0" y1="-10" x2="0" y2="10" stroke="rgba(0,0,0,0.15)" strokeWidth="0.5" />

        {/* ─── Polygon Boundary (from upload) ─── */}
        {polyPath && (
          <path
            d={polyPath}
            fill="rgba(192, 0, 0, 0.08)"
            stroke="#C00000"
            strokeWidth="1.5"
            strokeDasharray="4 2"
          />
        )}

        {/* ─── Coverage Circle (Omni mode) ─── */}
        {isOmni && (
          <g
            style={{
              transition: `r var(--dur-sync) var(--ease-expo), opacity var(--dur-sync) var(--ease-expo)`,
            }}
          >
            <circle
              cx="0"
              cy="0"
              r={visualRadius}
              fill="url(#coverage-grad)"
              stroke={colors.stroke}
              strokeWidth="1.5"
              strokeOpacity="0.5"
              style={{
                transition: `r var(--dur-sync) var(--ease-expo)`,
              }}
            />
          </g>
        )}

        {/* ─── Sector Wedge (Sector mode) ─── */}
        {isSector && (
          <g
            style={{
              transition: `opacity var(--dur-sync) var(--ease-expo)`,
            }}
          >
            <path
              d={wedgePath}
              fill="url(#coverage-grad)"
              stroke={colors.stroke}
              strokeWidth="1.5"
              strokeOpacity="0.5"
              style={{
                transition: `d var(--dur-sync) var(--ease-expo)`,
              }}
            />
            {/* Direction line */}
            <line
              x1="0" y1="0"
              x2={Math.cos((sectorAzimuth - 90) * Math.PI / 180) * visualRadius}
              y2={Math.sin((sectorAzimuth - 90) * Math.PI / 180) * visualRadius}
              stroke={colors.stroke}
              strokeWidth="1"
              strokeOpacity="0.3"
              strokeDasharray="4 3"
            />
          </g>
        )}

        {/* ─── Marker PinDrop ─── */}
        <g
          className={isAnimating ? 'animate-marker-drop' : ''}
          style={{
            animation: isAnimating
              ? 'markerDrop var(--dur-sync) var(--ease-back) both'
              : 'none',
          }}
        >
          {/* Pin body */}
          <circle cx="0" cy="0" r="6" fill="#C00000" stroke="white" strokeWidth="1.5" filter="url(#glow)" />
          {/* Pin point */}
          <line x1="0" y1="0" x2="0" y2="8" stroke="#C00000" strokeWidth="2" strokeLinecap="round" />
          {/* White rim */}
          <circle cx="0" cy="0" r="3.5" fill="white" />
          <circle cx="0" cy="0" r="2" fill="#C00000" />
        </g>

        {/* ─── Pulse Wave Rings (on analyze) ─── */}
        {isPulsing && (
          <g>
            {pulseRings.map((ring, i) => (
              <circle
                key={i}
                cx="0"
                cy="0"
                r={visualRadius * ring.scale}
                fill="none"
                stroke={colors.stroke}
                strokeWidth={2 - i * 0.4}
                opacity={0}
                style={{
                  animation: `radialExpand var(--dur-pulse) var(--ease-smooth) both`,
                  animationDelay: ring.delay,
                }}
              />
            ))}
          </g>
        )}

        {/* ─── Reveal overlay (phase transition) ─── */}
        {isRevealing && (
          <rect
            x="-120" y="-120" width="240" height="240"
            fill={colors.fill}
            opacity="0"
            style={{
              animation: 'fadeIn 300ms var(--ease-expo) both',
            }}
          />
        )}
      </svg>

      {/* ─── Overlay info ─── */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
        {/* Coordinate label */}
        <span className="text-[10px] font-mono text-gray-400 bg-white/80 backdrop-blur-sm px-1.5 py-0.5 rounded">
          {lat.toFixed(4)}, {lon.toFixed(4)}
        </span>

        {/* Radius label */}
        <span className="text-[10px] font-mono text-gray-400 bg-white/80 backdrop-blur-sm px-1.5 py-0.5 rounded">
          r={radius}m
        </span>
      </div>

      {/* ─── Antenna type indicator ─── */}
      <div className="absolute top-2 left-2">
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full transition-colors"
          style={{
            backgroundColor: isOmni ? 'rgba(13,148,136,0.15)' : 'rgba(139,92,246,0.15)',
            color: isOmni ? '#0D9488' : '#8B5CF6',
            transition: 'background-color var(--dur-sync) var(--ease-expo), color var(--dur-sync) var(--ease-expo)',
          }}
        >
          {isOmni ? 'Omni' : `Sector ${sectorBeamwidth}°`}
        </span>
      </div>

      {/* ─── Analyze badge ─── */}
      {isPulsing && (
        <div className="absolute top-2 right-2">
          <span className="text-[10px] font-medium bg-[#C00000]/10 text-[#C00000] px-1.5 py-0.5 rounded-full animate-pulse-border">
            วิเคราะห์...
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Export model color helper ────────────────────────────────

export function getCoverageColorForModel(model: string): CoverageColorKey {
  return MODEL_COLORS[model] || 'inner'
}
