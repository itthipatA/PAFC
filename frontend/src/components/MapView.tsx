import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { circle } from '@turf/turf'
import { useAuth } from '../contexts/AuthContext'
import type { BlockResult, IMTAllocation } from '../types'

interface MapViewProps {
  onMapClick: (lat: number, lon: number) => void
  selectedLat: number | null
  selectedLon: number | null
  blocks: BlockResult[]
  mapStyle: string
  cellRadius?: number
  centerLat?: number | null
  centerLon?: number | null
  clickMode?: 'place' | 'pan'
}

// Map styles
export const MAP_STYLES: Record<string, { label: string; url: string; attribution: string }> = {
  voyager: {
    label: 'Voyager',
    url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
    attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://osm.org">OSM</a>',
  },
  positron: {
    label: 'Positron',
    url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
    attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://osm.org">OSM</a>',
  },
  dark: {
    label: 'Dark Matter',
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://osm.org">OSM</a>',
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© <a href="https://www.esri.com/">Esri</a>',
  },
  osm: {
    label: 'OSM Basic',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://osm.org">OSM</a>',
  },
}

// Haversine distance in km
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Haversine distance in meters
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineKm(lat1, lon1, lat2, lon2) * 1000
}

// Bearing (azimuth) from point 1 to point 2, in degrees (0-360)
function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180)
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// Great-circle destination point given start [lat, lon], bearing (degrees), and distance (meters)
// Returns [lon, lat] (GeoJSON order)
function destPoint(
  lat: number,
  lon: number,
  bearingDeg_: number,
  distanceM: number,
): [number, number] {
  const R = 6371000
  const brg = (bearingDeg_ * Math.PI) / 180
  const dOverR = distanceM / R
  const lat1 = (lat * Math.PI) / 180
  const lon1 = (lon * Math.PI) / 180

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dOverR) +
    Math.cos(lat1) * Math.sin(dOverR) * Math.cos(brg),
  )
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(dOverR) * Math.cos(lat1),
      Math.cos(dOverR) - Math.sin(lat1) * Math.sin(lat2),
    )
  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]
}

function txMarkerEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = 'width:28px !important;height:36px !important;overflow:visible'
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="28" height="36" style="display:block">
      <g stroke="#4A5568" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <line x1="50" y1="25" x2="25" y2="115" stroke-width="3.5" />
        <line x1="50" y1="25" x2="75" y2="115" stroke-width="3.5" />
        <line x1="50" y1="25" x2="50" y2="115" stroke-width="1.5" stroke-dasharray="1,2" />
        <line x1="45" y1="42" x2="55" y2="42" />
        <line x1="40" y1="60" x2="60" y2="60" />
        <line x1="34" y1="80" x2="66" y2="80" />
        <line x1="28" y1="100" x2="72" y2="100" />
        <line x1="45" y1="42" x2="50" y2="60" />
        <line x1="55" y1="42" x2="50" y2="60" />
        <line x1="40" y1="60" x2="50" y2="80" />
        <line x1="60" y1="60" x2="50" y2="80" />
        <line x1="34" y1="80" x2="50" y2="100" />
        <line x1="66" y1="80" x2="50" y2="100" />
        <line x1="28" y1="100" x2="50" y2="115" />
        <line x1="72" y1="100" x2="50" y2="115" />
      </g>
      <g stroke="#2D3748" stroke-width="2.5" stroke-linejoin="round">
        <line x1="50" y1="12" x2="50" y2="35" stroke-width="3.5" stroke-linecap="round" />
        <ellipse cx="32" cy="30" rx="11" ry="15" fill="#CBD5E1" />
        <path d="M 32,15 A 11,15 0 0,0 32,45 Z" fill="#94A3B8" />
        <line x1="32" y1="30" x2="43" y2="30" stroke-width="2.5" />
        <polygon points="43,28 48,30 43,32" fill="#2D3748" />
        <ellipse cx="66" cy="42" rx="8" ry="11" fill="#E2E8F0" />
        <path d="M 66,31 A 8,11 0 0,0 66,53 Z" fill="#CBD5E1" />
        <line x1="66" y1="42" x2="55" y2="42" stroke-width="2" />
        <polygon points="55,40 51,42 55,44" fill="#2D3748" />
      </g>
    </svg>`
  return el
}

function rxMarkerEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = 'width:28px !important;height:36px !important;overflow:visible'
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="28" height="36" style="display:block">
      <g stroke="#4A5568" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <line x1="50" y1="25" x2="25" y2="115" stroke-width="3.5" />
        <line x1="50" y1="25" x2="75" y2="115" stroke-width="3.5" />
        <line x1="50" y1="25" x2="50" y2="115" stroke-width="1.5" stroke-dasharray="1,2" />
        <line x1="45" y1="42" x2="55" y2="42" />
        <line x1="40" y1="60" x2="60" y2="60" />
        <line x1="34" y1="80" x2="66" y2="80" />
        <line x1="28" y1="100" x2="72" y2="100" />
        <line x1="45" y1="42" x2="50" y2="60" />
        <line x1="55" y1="42" x2="50" y2="60" />
        <line x1="40" y1="60" x2="50" y2="80" />
        <line x1="60" y1="60" x2="50" y2="80" />
        <line x1="34" y1="80" x2="50" y2="100" />
        <line x1="66" y1="80" x2="50" y2="100" />
        <line x1="28" y1="100" x2="50" y2="115" />
        <line x1="72" y1="100" x2="50" y2="115" />
      </g>
      <g stroke="#2D3748" stroke-width="2.5" stroke-linejoin="round">
        <line x1="50" y1="12" x2="50" y2="35" stroke-width="3.5" stroke-linecap="round" />
        <ellipse cx="32" cy="30" rx="11" ry="15" fill="#FECACA" />
        <path d="M 32,15 A 11,15 0 0,0 32,45 Z" fill="#FCA5A5" />
        <line x1="32" y1="30" x2="43" y2="30" stroke-width="2.5" />
        <polygon points="43,28 48,30 43,32" fill="#2D3748" />
        <ellipse cx="66" cy="42" rx="8" ry="11" fill="#FEE2E2" />
        <path d="M 66,31 A 8,11 0 0,0 66,53 Z" fill="#FECACA" />
        <line x1="66" y1="42" x2="55" y2="42" stroke-width="2" />
        <polygon points="55,40 51,42 55,44" fill="#2D3748" />
      </g>
    </svg>`
  return el
}

function imtMarkerEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = 'width:28px !important;height:36px !important;overflow:visible'
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="28" height="36" style="display:block">
      <g stroke="#4A5568" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <line x1="40" y1="38" x2="40" y2="112" stroke-width="3" />
        <line x1="50" y1="42" x2="50" y2="115" stroke-width="3" />
        <line x1="60" y1="38" x2="60" y2="112" stroke-width="3" />
        <line x1="40" y1="112" x2="50" y2="94" /><line x1="50" y1="115" x2="60" y2="92" />
        <line x1="40" y1="92" x2="50" y2="94" stroke-width="2"/><line x1="50" y1="94" x2="60" y2="92" stroke-width="2"/>
        <line x1="40" y1="92" x2="50" y2="74" /><line x1="50" y1="94" x2="60" y2="72" />
        <line x1="40" y1="72" x2="50" y2="74" stroke-width="2"/><line x1="50" y1="74" x2="60" y2="72" stroke-width="2"/>
        <line x1="40" y1="72" x2="50" y2="54" /><line x1="50" y1="74" x2="60" y2="52" />
        <line x1="40" y1="52" x2="50" y2="54" stroke-width="2"/><line x1="50" y1="54" x2="60" y2="52" stroke-width="2"/>
        <line x1="40" y1="52" x2="50" y2="38" /><line x1="50" y1="54" x2="60" y2="35" />
        <line x1="40" y1="35" x2="50" y2="38" stroke-width="2.5"/><line x1="50" y1="38" x2="60" y2="35" stroke-width="2.5"/>
      </g>
      <polygon points="35,32 50,36 65,32 50,28" fill="#CBD5E1" stroke="#334155" stroke-width="2" />
      <g>
        <polygon points="30,20 40,24 40,58 30,54" fill="#94A3B8" stroke="#334155" stroke-width="2" stroke-linejoin="round" />
        <polygon points="25,18 30,20 30,54 25,52" fill="#64748B" stroke="#334155" stroke-width="2" stroke-linejoin="round" />
      </g>
      <g>
        <polygon points="60,24 70,20 70,54 60,58" fill="#F1F5F9" stroke="#334155" stroke-width="2" stroke-linejoin="round" />
        <polygon points="70,20 75,18 75,52 70,54" fill="#CBD5E1" stroke="#334155" stroke-width="2" stroke-linejoin="round" />
      </g>
      <line x1="50" y1="28" x2="50" y2="10" stroke="#334155" stroke-width="2.5" stroke-linecap="round" />
    </svg>`
  return el
}

const LAYER_IDS = {
  fsLinksLine: 'fs-links-line',
  fsLinksSource: 'fs-links-source',
  fsTxMarkers: 'fs-tx-markers',
  fsRxMarkers: 'fs-rx-markers',
  fsCoordFill: 'fs-coord-fill',
  fsCoordSource: 'fs-coord-source',
  fsCoordMidFill: 'fs-coord-mid-fill',
  fsCoordMidSource: 'fs-coord-mid-source',
  fsCoordInnerFill: 'fs-coord-inner-fill',
  fsCoordInnerSource: 'fs-coord-inner-source',
  imtCoverageFill: 'imt-coverage-fill',
  imtCoverageOutline: 'imt-coverage-outline',
  imtCoverageSource: 'imt-coverage-source',
  imtCenters: 'imt-centers-fill',
  imtCentersSource: 'imt-centers-source',
  cellRadiusFill: 'cell-radius-fill',
  cellRadiusSource: 'cell-radius-source',
}

export default function MapView({ onMapClick, selectedLat, selectedLon, blocks, mapStyle, cellRadius, centerLat, centerLon, clickMode = 'place' }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const fsMarkersRef = useRef<maplibregl.Marker[]>([])
  const imtMarkersRef = useRef<maplibregl.Marker[]>([])
  const { fetchWithAuth } = useAuth()

  // Init map
  useEffect(() => {
    if (!containerRef.current) return

    const style = MAP_STYLES[mapStyle] || MAP_STYLES.positron

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: [style.url],
            tileSize: 256,
            attribution: style.attribution,
          },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
      },
      center: [100.5, 13.75],
      zoom: 8,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-left')

    // Default cursor
    map.getCanvas().style.cursor = 'grab'
    map.on('dragstart', () => { map.getCanvas().style.cursor = 'grabbing' })
    map.on('dragend', () => { map.getCanvas().style.cursor = 'grab' })

    map.on('click', (e) => {
      if (clickMode === 'place') {
        onMapClick(e.lngLat.lat, e.lngLat.lng)
      }
    })

    mapRef.current = map

    return () => {
      // Clean up all markers
      fsMarkersRef.current.forEach((m) => m.remove())
      fsMarkersRef.current = []
      imtMarkersRef.current.forEach((m) => m.remove())
      imtMarkersRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Switch map style
  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current
    const source = map.getSource('basemap') as maplibregl.RasterTileSource
    if (!source) return

    const style = MAP_STYLES[mapStyle] || MAP_STYLES.positron
    source.setTiles([style.url])
  }, [mapStyle])

  // Auto-pan when centerLat/centerLon change
  useEffect(() => {
    if (!mapRef.current || centerLat == null || centerLon == null) return
    mapRef.current.flyTo({ center: [centerLon, centerLat], zoom: 12, duration: 800 })
  }, [centerLat, centerLon])

  // Update selected-location marker
  useEffect(() => {
    if (!mapRef.current || !selectedLat || !selectedLon) return

    const map = mapRef.current
    if (markerRef.current) markerRef.current.remove()

    markerRef.current = new maplibregl.Marker({ color: '#C00000' })
      .setLngLat([selectedLon, selectedLat])
      .addTo(map)

    drawCellRadius(map, selectedLat, selectedLon, cellRadius)
  }, [selectedLat, selectedLon, cellRadius])

  // Load FS links on map ready
  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current

    map.once('load', () => {
      loadFSLinks(map, fetchWithAuth, fsMarkersRef)
      loadIMTAllocations(map, fetchWithAuth, imtMarkersRef)
    })

    // If map already loaded, call immediately
    if (map.loaded()) {
      loadFSLinks(map, fetchWithAuth, fsMarkersRef)
      loadIMTAllocations(map, fetchWithAuth, imtMarkersRef)
    }
  }, [fetchWithAuth])

  return <div ref={containerRef} className="w-full h-full" />
}

function drawCellRadius(map: maplibregl.Map, lat: number, lon: number, radiusM?: number) {
  const sid = LAYER_IDS.cellRadiusSource
  const fid = LAYER_IDS.cellRadiusFill
  const oid = fid + '-outline'

  if (map.getLayer(oid)) map.removeLayer(oid)
  if (map.getLayer(fid)) map.removeLayer(fid)
  if (map.getSource(sid)) map.removeSource(sid)

  if (radiusM != null) {
    // Use turf.js fixed-radius circle (real-world distance, not zoom-dependent)
    try {
      const circlePoly = circle([lon, lat], radiusM / 1000, {
        steps: 64,
        units: 'kilometers',
      })

      map.addSource(sid, {
        type: 'geojson',
        data: circlePoly,
      })

      map.addLayer({
        id: fid,
        type: 'fill',
        source: sid,
        paint: {
          'fill-color': '#C00000',
          'fill-opacity': 0.12,
        },
      })

      map.addLayer({
        id: oid,
        type: 'line',
        source: sid,
        paint: {
          'line-color': '#C00000',
          'line-width': 2,
          'line-opacity': 0.5,
        },
      })
    } catch (e) {
      console.warn('Failed to draw turf cell radius:', e)
    }
  } else {
    // Zoom-dependent circle (legacy behavior for full-map mode)
    map.addSource(sid, {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} },
    })

    map.addLayer({
      id: fid,
      type: 'circle',
      source: sid,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          8, 20,
          14, 200,
        ],
        'circle-opacity': 0.2,
        'circle-color': '#C00000',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#C00000',
        'circle-stroke-opacity': 0.6,
      },
    })
  }
}

// ─── FS Links ──────────────────────────────────────────────────────────────

function cleanupFSLayers(map: maplibregl.Map, fsMarkersRef: React.MutableRefObject<maplibregl.Marker[]>) {
  // Remove marker-based layers
  fsMarkersRef.current.forEach((m) => m.remove())
  fsMarkersRef.current = []

  // Remove GeoJSON layers
  const ids = [
    LAYER_IDS.fsLinksLine, LAYER_IDS.fsTxMarkers, LAYER_IDS.fsRxMarkers,
    LAYER_IDS.fsCoordFill,
    LAYER_IDS.fsCoordMidFill, LAYER_IDS.fsCoordInnerFill,
  ]
  ids.forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id)
  })
  const sources = [
    LAYER_IDS.fsLinksSource, LAYER_IDS.fsCoordSource,
    LAYER_IDS.fsCoordMidSource, LAYER_IDS.fsCoordInnerSource,
  ]
  sources.forEach((sid) => {
    if (map.getSource(sid)) map.removeSource(sid)
  })
}

// ─── Tapered Coordination Zone (Engineering Precision) ──────────────────────

/**
 * Compute the coordination radius at a specific point along a microwave link,
 * using Free Space Path Loss physics. The radius varies from wide at the
 * endpoints (where the IMT transmitter has line-of-sight proximity) to
 * narrow in the middle (where the slant range to either endpoint is larger).
 *
 * Derivation:
 *   I_target = EIRP - FSPL(sqrt(r² + d²), f)
 *   FSPL = 32.4 + 20*log10(sqrt(r²+d²)_km) + 20*log10(f_MHz)
 *   Solving: r = sqrt(max(0, L * 1e6 - d²))
 *   where L = 10^((EIRP - threshold - 32.4 - 20*log10(f)) / 10)
 *
 * For each sample point we consider interference to BOTH the TX and RX ends
 * and take the tighter (more restrictive) radius.
 */
function taperedCoordinationRadius(
  eirp_dbm: number,
  freq_mhz: number,
  distance_along_link_m: number,
  total_distance_m: number,
  threshold_dbm: number = -114,
): number {
  // Compute the L constant: the squared slant range (in km²) at threshold
  const L = Math.pow(10, (eirp_dbm - threshold_dbm - 32.4 - 20 * Math.log10(freq_mhz)) / 10)
  const L_m2 = L * 1e6  // convert from km² to m²

  // Interference path to TX
  const d_tx = distance_along_link_m
  const r_tx_sq = L_m2 - d_tx * d_tx

  // Interference path to RX
  const d_rx = total_distance_m - distance_along_link_m
  const r_rx_sq = L_m2 - d_rx * d_rx

  // Take the tighter (smaller) of the two constraints
  const r_sq = Math.max(0, Math.min(r_tx_sq, r_rx_sq))
  const radius = Math.sqrt(r_sq)

  // Clamp: minimum 50m for visibility, maximum 2000m
  return Math.max(50, Math.min(2000, radius))
}

/**
 * Legacy single-endpoint coordination radius for popup display.
 * Returns the radius at the endpoint (distance_along = 0).
 */
function calcCoordinationRadius(
  eirp_dbm: number,
  freq_mhz: number,
  threshold_dbm: number = -114,
): number {
  // Free Space Path Loss: FSPL(d) = 32.4 + 20*log10(d_km) + 20*log10(f_MHz)
  // Solve for d where EIRP - FSPL(d) = threshold
  const exponent = (eirp_dbm - threshold_dbm - 32.4 - 20 * Math.log10(freq_mhz)) / 20
  const d_km = Math.pow(10, exponent)
  const radius_m = d_km * 1000
  // Clamp between 50m - 2000m for map visibility
  return Math.max(50, Math.min(2000, radius_m))
}

/**
 * Draw the tapered FS coordination zone using N=80 turf.js circles
 * sampled along the great-circle path. Each circle has 64 steps for a
 * smooth arc; with 80 overlapping circles the visual result is a continuous
 * smooth dog-bone shape. Three gradient layers (100%/60%/30% radii).
 */
function drawTaperedCoordinationZone(map: maplibregl.Map, links: any[]) {
  const N = 80  // high sample count for smooth continuous shape
  const outerFeatures: any[] = []
  const midFeatures: any[] = []
  const innerFeatures: any[] = []

  for (const link of links) {
    const txLat = link.tx?.lat ?? link.tx_lat
    const txLon = link.tx?.lon ?? link.tx_lon
    const rxLat = link.rx?.lat ?? link.rx_lat
    const rxLon = link.rx?.lon ?? link.rx_lon
    const freqLow = link.frequency?.low ?? link.freq_low
    const freqHigh = link.frequency?.high ?? link.freq_high
    const txPower = link.rf?.tx_power ?? link.tx_power ?? 20
    const txAntennaGain = link.rf?.tx_antenna_gain ?? link.tx_antenna_gain ?? 30

    const eirp = txPower + txAntennaGain
    const freqMid = (freqLow + freqHigh) / 2
    const totalDist = haversineM(txLat, txLon, rxLat, rxLon)
    const brg = bearingDeg(txLat, txLon, rxLat, rxLon)

    for (let i = 0; i <= N; i++) {
      const dAlong = (i / N) * totalDist
      // Interpolate along great circle (not straight line in lat/lon)
      const [lon, lat] = destPoint(txLat, txLon, brg, dAlong)

      const r = taperedCoordinationRadius(eirp, freqMid, dAlong, totalDist)
      if (r < 10) continue

      // Outer layer (100% radius)
      try {
        const c1 = circle([lon, lat], r / 1000, { steps: 64, units: 'kilometers' })
        outerFeatures.push(c1)
      } catch (_e) { /* skip invalid circle */ }

      // Mid layer (60% radius)
      const r2 = r * 0.6
      if (r2 >= 10) {
        try {
          const c2 = circle([lon, lat], r2 / 1000, { steps: 64, units: 'kilometers' })
          midFeatures.push(c2)
        } catch (_e) { /* skip invalid circle */ }
      }

      // Inner layer (30% radius)
      const r3 = r * 0.3
      if (r3 >= 10) {
        try {
          const c3 = circle([lon, lat], r3 / 1000, { steps: 64, units: 'kilometers' })
          innerFeatures.push(c3)
        } catch (_e) { /* skip invalid circle */ }
      }
    }
  }

  // Render outer layer (100% radius, blue #60A5FA, 6%, with outline)
  if (outerFeatures.length > 0) {
    map.addSource(LAYER_IDS.fsCoordSource, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: outerFeatures },
    })

    map.addLayer({
      id: LAYER_IDS.fsCoordFill,
      type: 'fill',
      source: LAYER_IDS.fsCoordSource,
      paint: {
        'fill-color': '#60A5FA',
        'fill-opacity': 0.03,
      },
    })
  }

  // Render middle layer (60% radius, amber #F59E0B, 10%, no outline)
  if (midFeatures.length > 0) {
    map.addSource(LAYER_IDS.fsCoordMidSource, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: midFeatures },
    })

    map.addLayer({
      id: LAYER_IDS.fsCoordMidFill,
      type: 'fill',
      source: LAYER_IDS.fsCoordMidSource,
      paint: {
        'fill-color': '#F59E0B',
        'fill-opacity': 0.05,
      },
    })
  }

  // Render inner layer (30% radius, red #EF4444, 8%, no outline)
  if (innerFeatures.length > 0) {
    map.addSource(LAYER_IDS.fsCoordInnerSource, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: innerFeatures },
    })

    map.addLayer({
      id: LAYER_IDS.fsCoordInnerFill,
      type: 'fill',
      source: LAYER_IDS.fsCoordInnerSource,
      paint: {
        'fill-color': '#EF4444',
        'fill-opacity': 0.08,
      },
    })
  }
}


async function loadFSLinks(
  map: maplibregl.Map,
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
  fsMarkersRef: React.MutableRefObject<maplibregl.Marker[]>,
) {
  try {
    const res = await fetchWithAuth('/api/fs-links/')
    if (!res.ok) {
      console.warn('FS links not available (auth required)')
      return
    }
    const data = await res.json()
    const links = data.links || data || []

    // Clean up previous
    cleanupFSLayers(map, fsMarkersRef)

    // Build GeoJSON features for the line layer
    const lineFeatures: any[] = []

    const markers: maplibregl.Marker[] = []

    links.forEach((link: any) => {
      const txLat = link.tx?.lat ?? link.tx_lat
      const txLon = link.tx?.lon ?? link.tx_lon
      const rxLat = link.rx?.lat ?? link.rx_lat
      const rxLon = link.rx?.lon ?? link.rx_lon
      const freqLow = link.frequency?.low ?? link.freq_low
      const freqHigh = link.frequency?.high ?? link.freq_high

      lineFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[txLon, txLat], [rxLon, rxLat]] },
        properties: {
          name: link.name,
          operator: link.operator,
          freqLow,
          freqHigh,
          txLat,
          txLon,
          rxLat,
          rxLon,
          txPower: link.rf?.tx_power ?? link.tx_power ?? 20,
          txAntennaGain: link.rf?.tx_antenna_gain ?? link.tx_antenna_gain ?? 30,
        },
      })

      // TX marker (red)
      const txMarker = new maplibregl.Marker({ element: txMarkerEl() })
        .setLngLat([txLon, txLat])
        .addTo(map)
      txMarker.getElement().addEventListener('click', (e) => {
        e.stopPropagation()
        console.log('TX marker clicked:', link.name)
        const d = haversineKm(txLat, txLon, rxLat, rxLon).toFixed(2)
        const midFreqMHz = (freqLow + freqHigh) / 2
        const txPower = link.rf?.tx_power ?? link.tx_power ?? 20
        const txAntennaGain = link.rf?.tx_antenna_gain ?? link.tx_antenna_gain ?? 30
        const eirp = txPower + txAntennaGain
        const threshold = -114
        const coordTxKm = (calcCoordinationRadius(eirp, midFreqMHz, threshold) / 1000).toFixed(2)
        const coordRxKm = (calcCoordinationRadius(eirp, midFreqMHz, threshold) / 1000).toFixed(2)
        new maplibregl.Popup()
          .setLngLat([txLon, txLat])
          .setHTML(popupHTML(link.name, link.operator, freqLow, freqHigh, d, coordTxKm, coordRxKm, eirp, threshold, 'TX'))
          .addTo(map)
      })
      markers.push(txMarker)

      // RX marker (blue)
      const rxMarker = new maplibregl.Marker({ element: rxMarkerEl() })
        .setLngLat([rxLon, rxLat])
        .addTo(map)
      rxMarker.getElement().addEventListener('click', (e) => {
        e.stopPropagation()
        console.log('RX marker clicked:', link.name)
        const d = haversineKm(txLat, txLon, rxLat, rxLon).toFixed(2)
        const midFreqMHz = (freqLow + freqHigh) / 2
        const txPower = link.rf?.tx_power ?? link.tx_power ?? 20
        const txAntennaGain = link.rf?.tx_antenna_gain ?? link.tx_antenna_gain ?? 30
        const eirp = txPower + txAntennaGain
        const threshold = -114
        const coordTxKm = (calcCoordinationRadius(eirp, midFreqMHz, threshold) / 1000).toFixed(2)
        const coordRxKm = (calcCoordinationRadius(eirp, midFreqMHz, threshold) / 1000).toFixed(2)
        new maplibregl.Popup()
          .setLngLat([rxLon, rxLat])
          .setHTML(popupHTML(link.name, link.operator, freqLow, freqHigh, d, coordTxKm, coordRxKm, eirp, threshold, 'RX'))
          .addTo(map)
      })
      markers.push(rxMarker)
    })

    fsMarkersRef.current = markers

    // Add GeoJSON line source + layer
    map.addSource(LAYER_IDS.fsLinksSource, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: lineFeatures },
    })

    map.addLayer({
      id: LAYER_IDS.fsLinksLine,
      type: 'line',
      source: LAYER_IDS.fsLinksSource,
      paint: {
        'line-color': '#1A365D',
        'line-width': 2,
        'line-dasharray': [4, 2],
        'line-opacity': 0.7,
      },
    })

    // Click on line
    map.on('click', LAYER_IDS.fsLinksLine, (e) => {
      if (!e.features?.[0]) return
      const p = e.features[0].properties
      const d = haversineKm(p.txLat, p.txLon, p.rxLat, p.rxLon).toFixed(2)
      const midFreqMHz = (p.freqLow + p.freqHigh) / 2
      const eirp = (p.txPower ?? 20) + (p.txAntennaGain ?? 30)
      const threshold = -114
      const coordTxKm = (calcCoordinationRadius(eirp, midFreqMHz, threshold) / 1000).toFixed(2)
      const coordRxKm = (calcCoordinationRadius(eirp, midFreqMHz, threshold) / 1000).toFixed(2)
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(popupHTML(p.name, p.operator, p.freqLow, p.freqHigh, d, coordTxKm, coordRxKm, eirp, threshold, ''))
        .addTo(map)
    })

    map.on('mouseenter', LAYER_IDS.fsLinksLine, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', LAYER_IDS.fsLinksLine, () => { map.getCanvas().style.cursor = '' })

    // Draw Coordination Zone (tapered, FSLP-derived) with 3-layer gradient
    drawTaperedCoordinationZone(map, links)
  } catch (err) {
    console.warn('FS links not available:', err)
  }
}

function popupHTML(
  name: string,
  operator: string,
  freqLow: number,
  freqHigh: number,
  distance: string,
  coordRadiusTxKm: string,
  coordRadiusRxKm: string,
  eirp: number,
  threshold: number,
  role: string,
): string {
  const roleText = role ? ` (${role})` : ''
  const midFreqMHz = ((freqLow + freqHigh) / 2).toFixed(1)
  return `
    <div style="font-family:Sarabun,sans-serif;font-size:13px;line-height:1.6;min-width:280px">
      <strong style="color:#1A1A2E">${escapeHTML(name)}${roleText}</strong><br/>
      <span style="color:#6C757D">ผู้ให้บริการ: ${escapeHTML(operator)}</span><br/>
      <span style="color:#6C757D">ความถี่: ${freqLow}-${freqHigh} MHz (Mid: ${midFreqMHz} MHz)</span><br/>
      <span style="color:#6C757D">ระยะทาง: ${distance} km</span><br/>
      <hr style="border:none;border-top:1px solid #E5E7EB;margin:6px 0"/>
      <span style="color:#3B82F6;font-weight:600">Coordination Zone</span><br/>
      <span style="color:#6C757D">
        &nbsp;&nbsp;TX: ${coordRadiusTxKm} km | RX: ${coordRadiusRxKm} km | Tapered
      </span><br/>
      <span style="color:#6C757D">EIRP: ${eirp} dBm | Threshold: ${threshold} dBm</span><br/>
      <span style="color:#6C757D;font-size:11px;line-height:1.4">
        &nbsp;&nbsp;&#x2022; Tapered coordination zone (FSLP-derived)<br/>
        &nbsp;&nbsp;&#x2022; Accounts for slant-range geometry,<br/>
        &nbsp;&nbsp;&nbsp;&nbsp;beam spreading &amp; diffraction
      </span>
    </div>`
}

function escapeHTML(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

// ─── IMT Allocations ───────────────────────────────────────────────────────

function cleanupIMTLayers(map: maplibregl.Map, imtMarkersRef: React.MutableRefObject<maplibregl.Marker[]>) {
  imtMarkersRef.current.forEach((m) => m.remove())
  imtMarkersRef.current = []

  const ids = [LAYER_IDS.imtCoverageFill, LAYER_IDS.imtCoverageOutline, LAYER_IDS.imtCenters]
  ids.forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id)
  })
  if (map.getSource(LAYER_IDS.imtCoverageSource)) map.removeSource(LAYER_IDS.imtCoverageSource)
}

async function loadIMTAllocations(
  map: maplibregl.Map,
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
  imtMarkersRef: React.MutableRefObject<maplibregl.Marker[]>,
) {
  try {
    const res = await fetchWithAuth('/api/imt/')
    if (!res.ok) {
      console.warn('IMT allocations not available (auth required)')
      return
    }
    const data = await res.json()
    const allocations: IMTAllocation[] = data.allocations || data || []

    cleanupIMTLayers(map, imtMarkersRef)

    // Build coverage polygons using turf circle()
    const coverageFeatures: any[] = []
    const markers: maplibregl.Marker[] = []

    allocations.forEach((alloc) => {
      const lat = alloc.center_lat
      const lon = alloc.center_lon

      // Turf circle creates a GeoJSON polygon in km units
      try {
        const coveragePoly = circle([lon, lat], alloc.cell_radius / 1000, {
          steps: 64,
          units: 'kilometers',
        })
        coveragePoly.properties = {
          id: alloc.id,
          name: alloc.name,
          operator: alloc.operator,
          cell_radius: alloc.cell_radius,
          blocks: alloc.blocks,
          created_at: alloc.created_at,
        }
        coverageFeatures.push(coveragePoly)
      } catch (e) {
        console.warn('Failed to create circle for IMT:', alloc.name, e)
      }

      // Center marker
      const el = imtMarkerEl()
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .addTo(map)

      el.addEventListener('click', () => {
        const blocks = alloc.blocks || []
        const totalMHz = blocks
          .filter((b: any) => b.status === 'allocated')
          .reduce((sum: number, b: any) => sum + (b.freq_high - b.freq_low), 0)

        // Build colored blocks HTML for spectrum bar (4800-4990, 10MHz each)
        const spectrumBlocks: string[] = []
        for (let f = 4800; f < 4990; f += 10) {
          const allocBlock = blocks.find((b: any) => b.freq_low === f)
          let bg = '#E5E7EB'  // unallocated - light gray
          if (allocBlock) {
            bg = allocBlock.status === 'allocated' ? '#16A34A' : '#9CA3AF'
          }
          spectrumBlocks.push(
            `<div style="flex:1;height:14px;background:${bg};margin:0 0.5px;border-radius:1px" title="${f}-${f+10} MHz"></div>`
          )
        }
        const blockLabels = [4800, 4820, 4840, 4860, 4880, 4900, 4920, 4940, 4960, 4980, 4990]

        // List allocated blocks
        const allocBlocks = blocks.filter((b: any) => b.status === 'allocated')
        const guardBlocks = blocks.filter((b: any) => b.status === 'guard')

        new maplibregl.Popup({ maxWidth: '360px' })
          .setLngLat([lon, lat])
          .setHTML(`
            <div style="font-family:Sarabun,sans-serif;font-size:12px;line-height:1.5;min-width:280px;max-width:340px">
              <strong style="color:#1A1A2E;font-size:14px">${escapeHTML(alloc.name)}</strong>
              <span style="color:#16A34A;margin-left:4px;font-size:10px;font-weight:600">IMT</span><br/>
              <span style="color:#6C757D">${escapeHTML(alloc.operator)} | ${alloc.cell_radius}m | ${alloc.max_eirp} dBm</span>

              <div style="margin-top:6px;padding:6px;background:#F9FAFB;border-radius:4px;border:1px solid #E5E7EB">
                <div style="display:flex;gap:0;margin:4px 0">
                  ${spectrumBlocks.join('')}
                </div>
                <div style="display:flex;justify-content:space-between;font-size:7px;color:#9CA3AF;font-family:monospace;margin-top:1px">
                  ${blockLabels.map(f => `<span>${f}</span>`).join('')}
                </div>
                <div style="margin-top:4px;font-size:10px;color:#374151">
                  <span style="color:#166534;font-weight:600">■ จัดสรร</span>
                  ${allocBlocks.length > 0 ? `<span style="color:#166534"> ${allocBlocks.map(b => `${b.freq_low}-${b.freq_high}`).join(', ')}</span>` : ''}
                  ${guardBlocks.length > 0 ? ` <span style="color:#6B7280">■ Guard</span>` : ''}
                  <span style="color:#9CA3AF"> ■ ว่าง</span>
                </div>
              </div>
              <div style="margin-top:4px;font-size:10px;color:#6C757D">
                จัดสรร: <strong style="color:#166534">${totalMHz} MHz</strong>
                ${guardBlocks.length > 0 ? ` | Guard: <strong>${guardBlocks.length * 10} MHz</strong>` : ''}
              </div>
            </div>`)
          .addTo(map)
      })
      markers.push(marker)
    })

    imtMarkersRef.current = markers

    if (coverageFeatures.length === 0) return

    // Add coverage GeoJSON source + fill + outline layers
    map.addSource(LAYER_IDS.imtCoverageSource, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: coverageFeatures },
    })

    map.addLayer({
      id: LAYER_IDS.imtCoverageFill,
      type: 'fill',
      source: LAYER_IDS.imtCoverageSource,
      paint: {
        'fill-color': '#16A34A',
        'fill-opacity': 0.15,
      },
    })

    map.addLayer({
      id: LAYER_IDS.imtCoverageOutline,
      type: 'line',
      source: LAYER_IDS.imtCoverageSource,
      paint: {
        'line-color': '#16A34A',
        'line-width': 1,
        'line-opacity': 0.6,
      },
    })

    // Click on coverage
    map.on('click', LAYER_IDS.imtCoverageFill, (e) => {
      if (!e.features?.[0]) return
      const p = e.features[0].properties
      const blocks = p.blocks || []
      const totalMHz = blocks
        .filter((b: any) => b.status === 'allocated')
        .reduce((sum: number, b: any) => sum + (b.freq_high - b.freq_low), 0)

      // Build colored blocks HTML for spectrum bar (4800-4990, 10MHz each)
      const spectrumBlocks: string[] = []
      for (let f = 4800; f < 4990; f += 10) {
        const allocBlock = blocks.find((b: any) => b.freq_low === f)
        let bg = '#E5E7EB'  // unallocated - light gray
        if (allocBlock) {
          bg = allocBlock.status === 'allocated' ? '#16A34A' : '#9CA3AF'
        }
        spectrumBlocks.push(
          `<div style="flex:1;height:14px;background:${bg};margin:0 0.5px;border-radius:1px" title="${f}-${f+10} MHz"></div>`
        )
      }
      const blockLabels = [4800, 4820, 4840, 4860, 4880, 4900, 4920, 4940, 4960, 4980, 4990]
      const allocBlocks = blocks.filter((b: any) => b.status === 'allocated')
      const guardBlocks = blocks.filter((b: any) => b.status === 'guard')
      const allocListStr = allocBlocks.map((b: any) => `${b.freq_low}-${b.freq_high}`).join(', ')
      const labelsStr = blockLabels.map((f: number) => `<span>${f}</span>`).join('')
      const guardStr = guardBlocks.length > 0 ? ` | Guard: <strong>${guardBlocks.length * 10} MHz</strong>` : ''
      const allocGuardLegend = guardBlocks.length > 0 ? ' <span style="color:#6B7280">■ Guard</span>' : ''

      new maplibregl.Popup({ maxWidth: '360px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family:Sarabun,sans-serif;font-size:12px;line-height:1.5;min-width:280px;max-width:340px">
            <strong style="color:#1A1A2E;font-size:14px">${escapeHTML(p.name)}</strong>
            <span style="color:#16A34A;margin-left:4px;font-size:10px;font-weight:600">IMT</span><br/>
            <span style="color:#6C757D">${escapeHTML(p.operator)} | ${p.cell_radius}m | ${p.max_eirp} dBm</span>
            <div style="margin-top:6px;padding:6px;background:#F9FAFB;border-radius:4px;border:1px solid #E5E7EB">
              <div style="display:flex;gap:0;margin:4px 0">${spectrumBlocks.join('')}</div>
              <div style="display:flex;justify-content:space-between;font-size:7px;color:#9CA3AF;font-family:monospace;margin-top:1px">${labelsStr}</div>
              <div style="margin-top:4px;font-size:10px;color:#374151">
                <span style="color:#166534;font-weight:600">■ จัดสรร</span>${allocListStr ? `<span style="color:#166534"> ${allocListStr}</span>` : ''}${allocGuardLegend} <span style="color:#9CA3AF">■ ว่าง</span>
              </div>
            </div>
            <div style="margin-top:4px;font-size:10px;color:#6C757D">จัดสรร: <strong style="color:#166534">${totalMHz} MHz</strong>${guardStr}</div>
          </div>`)
        .addTo(map)
    })
  } catch (err) {
    console.warn('IMT allocations not available:', err)
  }
}
