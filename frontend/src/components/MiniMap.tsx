import { useState, useEffect, useMemo, useRef, useCallback } from 'react'

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
  towerPoints?: { lat: number; lon: number; cellRadius?: number }[]  // per-tower positions
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
  towerPoints,
  className = '',
}: MiniMapProps) {
  // Track previous antenna type for morph transition
  const [displayAntennaType, setDisplayAntennaType] = useState<AntennaType>(antennaType)

  // Zoom/Pan/Rotate state
  const [zoom, setZoom] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [rotate, setRotate] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [isRotating, setIsRotating] = useState(false)
  const [rotateStart, setRotateStart] = useState({ x: 0, y: 0 })
  const svgContainerRef = useRef<HTMLDivElement>(null)

  // Zoom with scroll
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(z => Math.max(0.3, Math.min(5, z * delta)))
  }, [])

  // Pan with left-click drag, Rotate with middle-click or Shift+Click
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      // Middle-click or Shift+Click = rotate
      setIsRotating(true)
      setRotateStart({ x: e.clientX, y: e.clientY })
      e.preventDefault()
    } else if (e.button === 0 && !e.shiftKey) {
      // Left click = pan
      setIsDragging(true)
      setDragStart({ x: e.clientX - panX, y: e.clientY - panY })
    }
  }, [panX, panY])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPanX(e.clientX - dragStart.x)
      setPanY(e.clientY - dragStart.y)
    }
    if (isRotating && svgContainerRef.current) {
      const rect = svgContainerRef.current.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const startAngle = Math.atan2(rotateStart.y - cy, rotateStart.x - cx)
      const currentAngle = Math.atan2(e.clientY - cy, e.clientX - cx)
      const deltaRotate = (currentAngle - startAngle) * (180 / Math.PI)
      setRotate(r => r + deltaRotate * 0.5)
      setRotateStart({ x: e.clientX, y: e.clientY })
    }
  }, [isDragging, isRotating, dragStart, rotateStart])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setIsRotating(false)
  }, [])

  // Reset view
  const resetView = useCallback(() => {
    setZoom(1)
    setPanX(0)
    setPanY(0)
    setRotate(0)
  }, [])

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
  const { polyPath, polyScale } = useMemo(() => {
    if (!polygonVertices || polygonVertices.length < 3) return { polyPath: '', polyScale: 1 }
    const lons = polygonVertices.map(v => v[0])
    const lats = polygonVertices.map(v => v[1])
    const cosCenter = Math.cos((lat * Math.PI) / 180)
    const metersPerDeg = 111320
    const dxs = lons.map(l => (l - lon) * metersPerDeg * cosCenter)
    const dys = lats.map(l => -(l - lat) * metersPerDeg)
    const maxAbs = Math.max(...dxs.map(Math.abs), ...dys.map(Math.abs))
    const scale = maxAbs > 0 ? 100 / maxAbs : 1
    const path = polygonVertices.map((v, i) => {
      const sx = dxs[i] * scale
      const sy = dys[i] * scale
      return `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)}`
    }).join(' ') + ' Z'
    return { polyPath: path, polyScale: scale }
  }, [polygonVertices, lat, lon])

  // Per-tower positions → SVG coordinates
  const towerSvgs = useMemo(() => {
    if (!towerPoints || towerPoints.length === 0) return []
    const cosCenter = Math.cos((lat * Math.PI) / 180)
    const metersPerDeg = 111320
    // Use same scale factor as polygon calculation
    const centerLon = lon
    const centerLat = lat
    return towerPoints.map(t => {
      const dx = (t.lon - centerLon) * metersPerDeg * cosCenter
      const dy = -(t.lat - centerLat) * metersPerDeg
      // Scale: use same logic as polygon (100 SVG units for max extent)
      // For towers, just use the polygon's scale if available, otherwise 1
      return { x: dx, y: dy, radius: t.cellRadius || radius }
    })
  }, [towerPoints, lat, lon, radius])

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
    <div 
      ref={svgContainerRef}
      className={`relative overflow-hidden bg-[#F5F5F0] rounded-xl border border-gray-200 ${className}`}
      style={{ cursor: isDragging ? 'grabbing' : isRotating ? 'crosshair' : 'grab' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Zoom/Pan/Rotate controls */}
      <div className="absolute top-1 right-1 z-10 flex gap-0.5">
        <button onClick={() => setZoom(z => Math.min(5, z * 1.2))} 
          className="bg-white/80 hover:bg-white rounded px-1.5 py-0.5 text-xs font-bold text-gray-600 border border-gray-200">+</button>
        <button onClick={() => setZoom(z => Math.max(0.3, z * 0.8))}
          className="bg-white/80 hover:bg-white rounded px-1.5 py-0.5 text-xs font-bold text-gray-600 border border-gray-200">−</button>
        <button onClick={resetView}
          className="bg-white/80 hover:bg-white rounded px-1.5 py-0.5 text-xs text-gray-500 border border-gray-200" title="รีเซ็ตมุมมอง">↺</button>
      </div>
      {/* Grid background */}
      <svg
        viewBox="-120 -120 240 240"
        className="w-full h-full pointer-events-none"
        style={{
          minHeight: '200px',
          transform: `scale(${zoom}) translate(${panX / zoom}px, ${panY / zoom}px) rotate(${rotate}deg)`,
          transformOrigin: 'center center',
        }}
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

        {/* ─── Per-Tower Coverage Circles ─── */}
        {towerSvgs.length > 0 && (() => {
          // Use polygon's scale factor (SVG units per meter)
          const scale = polyScale || 1
          return towerSvgs.map((t, i) => {
            const sx = t.x * scale
            const sy = t.y * scale
            // Circle radius in SVG units: radius_meters × SVG_units_per_meter
            const vr = Math.max(4, (t.radius || radius) * scale)
            return (
              <g key={i}>
                <circle cx={sx} cy={sy} r={vr}
                  fill="rgba(192, 0, 0, 0.12)" stroke="#C00000" strokeWidth="1"
                  strokeOpacity="0.5" />
                <circle cx={sx} cy={sy} r="2.5" fill="#C00000" />
                <text x={sx} y={sy - vr - 3} textAnchor="middle"
                  fill="#1A1A2E" fontSize="6" fontWeight="bold">{i + 1}</text>
              </g>
            )
          })
        })()}

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
