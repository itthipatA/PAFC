import { useMemo } from 'react'

interface Props {
  vertices: [number, number][]  // [lon, lat] pairs
}

export default function PolygonShape({ vertices }: Props) {
  if (!vertices || vertices.length < 3) return null

  const { points, viewBox } = useMemo(() => {
    const lons = vertices.map(v => v[0])
    const lats = vertices.map(v => v[1])
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)

    const pad = 0.1
    const w = maxLon - minLon || 0.001
    const h = maxLat - minLat || 0.001

    const norm = (lon: number, lat: number) => {
      const x = ((lon - minLon) / w) * 0.8 + 0.1  // 10-90% width
      const y = (1 - (lat - minLat) / h) * 0.8 + 0.1  // 10-90% height, flipped Y
      return `${(x * 100).toFixed(1)}%`
    }

    const pts = vertices.map(([lon, lat]) => `${((lon - minLon) / w * 80 + 10).toFixed(1)},${((1 - (lat - minLat) / h) * 80 + 10).toFixed(1)}`).join(' ')

    return { points: pts, viewBox: `0 0 100 100` }
  }, [vertices])

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <polygon
        points={points}
        fill="#0D9488"
        fillOpacity={0.3}
        stroke="#0D9488"
        strokeWidth={0.5}
      />
      {/* Vertex dots */}
      {vertices.map(([lon, lat], i) => {
        const lons = vertices.map(v => v[0])
        const lats = vertices.map(v => v[1])
        const minLon = Math.min(...lons)
        const maxLon = Math.max(...lons)
        const minLat = Math.min(...lats)
        const maxLat = Math.max(...lats)
        const w = maxLon - minLon || 0.001
        const h = maxLat - minLat || 0.001
        const cx = ((lon - minLon) / w * 80 + 10).toFixed(1)
        const cy = ((1 - (lat - minLat) / h) * 80 + 10).toFixed(1)
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r="1.5"
            fill="#C00000"
            stroke="white"
            strokeWidth="0.5"
          />
        )
      })}
    </svg>
  )
}
