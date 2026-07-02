import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { circle, lineString } from '@turf/turf'
import buffer from '@turf/buffer'
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

function txMarkerEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.innerHTML = `<div style="width:12px;height:12px;background:#C00000;border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.5)"></div>`
  return el
}

function rxMarkerEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.innerHTML = `<div style="width:12px;height:12px;background:#2563EB;border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.5)"></div>`
  return el
}

function imtMarkerEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.innerHTML = `<div style="width:16px;height:16px;background:#16A34A;border:3px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.5)"></div>`
  return el
}

const LAYER_IDS = {
  fsLinksLine: 'fs-links-line',
  fsLinksSource: 'fs-links-source',
  fsTxMarkers: 'fs-tx-markers',
  fsRxMarkers: 'fs-rx-markers',
  fsCoordFill: 'fs-coord-fill',
  fsCoordOutline: 'fs-coord-outline',
  fsCoordSource: 'fs-coord-source',
  fsCoordLineBufSource: 'fs-coord-linebuf-source',
  fsCoordLineBufFill: 'fs-coord-linebuf-fill',
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
          'fill-opacity': 0.15,
        },
      })

      map.addLayer({
        id: oid,
        type: 'line',
        source: sid,
        paint: {
          'line-color': '#C00000',
          'line-width': 2,
          'line-opacity': 0.6,
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
    LAYER_IDS.fsCoordFill, LAYER_IDS.fsCoordOutline, LAYER_IDS.fsCoordLineBufFill,
  ]
  ids.forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id)
  })
  const sources = [LAYER_IDS.fsLinksSource, LAYER_IDS.fsCoordSource, LAYER_IDS.fsCoordLineBufSource]
  sources.forEach((sid) => {
    if (map.getSource(sid)) map.removeSource(sid)
  })
}

// ─── Coordination Zone Drawing (dog-bone shape) ────────────────────────────

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
  // Clamp between 300m - 2000m for map visibility
  return Math.max(300, Math.min(2000, radius_m))
}

function drawFSCoordinationZone(map: maplibregl.Map, links: any[]) {
  const coordFeatures: any[] = []
  const lineBufFeatures: any[] = []

  links.forEach((link: any) => {
    const txLat = link.tx?.lat ?? link.tx_lat
    const txLon = link.tx?.lon ?? link.tx_lon
    const rxLat = link.rx?.lat ?? link.rx_lat
    const rxLon = link.rx?.lon ?? link.rx_lon
    const freqLow = link.frequency?.low ?? link.freq_low
    const freqHigh = link.frequency?.high ?? link.freq_high
    const txPower = link.rf?.tx_power ?? link.tx_power ?? 20
    const txAntennaGain = link.rf?.tx_antenna_gain ?? link.tx_antenna_gain ?? 30

    const midFreqMHz = (freqLow + freqHigh) / 2
    const eirp = txPower + txAntennaGain
    const threshold = -114

    // Calculate coordination radii for TX and RX ends
    const coordRadiusTxM = calcCoordinationRadius(eirp, midFreqMHz, threshold)
    const coordRadiusRxM = calcCoordinationRadius(eirp, midFreqMHz, threshold)

    const coordRadiusTxKm = coordRadiusTxM / 1000
    const coordRadiusRxKm = coordRadiusRxM / 1000

    try {
      // TX circle
      const txCircle = circle([txLon, txLat], coordRadiusTxKm, {
        steps: 32,
        units: 'kilometers',
      })
      txCircle.properties = {
        name: link.name,
        coordRadiusTxM: coordRadiusTxM.toFixed(0),
        coordRadiusRxM: coordRadiusRxM.toFixed(0),
        eirp,
        threshold,
        midFreqMHz: midFreqMHz.toFixed(1),
      }
      coordFeatures.push(txCircle)

      // RX circle
      const rxCircle = circle([rxLon, rxLat], coordRadiusRxKm, {
        steps: 32,
        units: 'kilometers',
      })
      rxCircle.properties = {
        name: link.name,
        coordRadiusTxM: coordRadiusTxM.toFixed(0),
        coordRadiusRxM: coordRadiusRxM.toFixed(0),
        eirp,
        threshold,
        midFreqMHz: midFreqMHz.toFixed(1),
      }
      coordFeatures.push(rxCircle)

      // Line buffer (200m minimum corridor)
      const linkLine = lineString([[txLon, txLat], [rxLon, rxLat]])
      const lineBuf = buffer(linkLine, 0.2, { units: 'kilometers', steps: 16 })
      if (lineBuf && lineBuf.geometry) {
        lineBuf.properties = {
          name: link.name,
          coordRadiusTxM: coordRadiusTxM.toFixed(0),
          coordRadiusRxM: coordRadiusRxM.toFixed(0),
          eirp,
          threshold,
          midFreqMHz: midFreqMHz.toFixed(1),
        }
        lineBufFeatures.push(lineBuf)
      }
    } catch (e) {
      console.warn('Failed to draw coordination zone for:', link.name, e)
    }
  })

  // Render TX/RX circles — fill + outline
  if (coordFeatures.length > 0) {
    map.addSource(LAYER_IDS.fsCoordSource, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: coordFeatures },
    })

    map.addLayer({
      id: LAYER_IDS.fsCoordFill,
      type: 'fill',
      source: LAYER_IDS.fsCoordSource,
      paint: {
        'fill-color': '#60A5FA',
        'fill-opacity': 0.12,
      },
    })

    map.addLayer({
      id: LAYER_IDS.fsCoordOutline,
      type: 'line',
      source: LAYER_IDS.fsCoordSource,
      paint: {
        'line-color': '#3B82F6',
        'line-width': 2,
      },
    })
  }

  // Render line buffer — fill only (matched color so it visually merges)
  if (lineBufFeatures.length > 0) {
    map.addSource(LAYER_IDS.fsCoordLineBufSource, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: lineBufFeatures },
    })

    map.addLayer({
      id: LAYER_IDS.fsCoordLineBufFill,
      type: 'fill',
      source: LAYER_IDS.fsCoordLineBufSource,
      paint: {
        'fill-color': '#60A5FA',
        'fill-opacity': 0.12,
      },
      // Place below the circle outlines so circles render on top
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

    // Draw Coordination Zone (dog-bone shape)
    drawFSCoordinationZone(map, links)
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
        &nbsp;&nbsp;TX: ${coordRadiusTxKm} km | RX: ${coordRadiusRxKm} km | Corridor: 0.2 km
      </span><br/>
      <span style="color:#6C757D">EIRP: ${eirp} dBm | Threshold: ${threshold} dBm</span><br/>
      <span style="color:#6C757D;font-size:11px;line-height:1.4">
        &nbsp;&nbsp;&#x2022; Microwave protection corridor (200m min)<br/>
        &nbsp;&nbsp;&#x2022; Accounts for Fresnel zone, beam spreading,<br/>
        &nbsp;&nbsp;&nbsp;&nbsp;near-field effects &amp; diffraction
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
        const blocksStr = (alloc.blocks || [])
          .map((b: any) => `${b.freq_low}-${b.freq_high} MHz (${b.status})`)
          .join('<br/>')
        new maplibregl.Popup()
          .setLngLat([lon, lat])
          .setHTML(`
            <div style="font-family:Sarabun,sans-serif;font-size:13px;line-height:1.6;min-width:200px">
              <strong style="color:#1A1A2E">${escapeHTML(alloc.name)}</strong><br/>
              <span style="color:#6C757D">ผู้ให้บริการ: ${escapeHTML(alloc.operator)}</span><br/>
              <span style="color:#6C757D">รัศมีเซลล์: ${alloc.cell_radius} m</span><br/>
              <span style="color:#6C757D">ความสูงเสา: ${alloc.antenna_height} m</span><br/>
              <span style="color:#6C757D">กำลังส่ง: ${alloc.max_eirp} dBm</span><br/>
              ${blocksStr ? `<span style="color:#6C757D">คลื่นที่จัดสรร:<br/>${blocksStr}</span><br/>` : ''}
              <span style="color:#6C757D">วันที่: ${new Date(alloc.created_at).toLocaleDateString('th-TH')}</span>
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
      const blocksStr = (p.blocks || [])
        .map((b: any) => `${b.freq_low}-${b.freq_high} MHz (${b.status})`)
        .join('<br/>')
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family:Sarabun,sans-serif;font-size:13px;line-height:1.6;min-width:200px">
            <strong style="color:#1A1A2E">${escapeHTML(p.name)}</strong><br/>
            <span style="color:#6C757D">ผู้ให้บริการ: ${escapeHTML(p.operator)}</span><br/>
            <span style="color:#6C757D">รัศมีเซลล์: ${p.cell_radius} m</span><br/>
            ${blocksStr ? `<span style="color:#6C757D">คลื่นที่จัดสรร:<br/>${blocksStr}</span><br/>` : ''}
            <span style="color:#6C757D">วันที่: ${new Date(p.created_at).toLocaleDateString('th-TH')}</span>
          </div>`)
        .addTo(map)
    })
  } catch (err) {
    console.warn('IMT allocations not available:', err)
  }
}
