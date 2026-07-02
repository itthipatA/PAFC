import { useEffect, useRef, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { BlockResult } from '../types'

interface MapViewProps {
  onMapClick: (lat: number, lon: number) => void
  selectedLat: number | null
  selectedLon: number | null
  blocks: BlockResult[]
}

// OpenMapTiles free tile server
const TILE_URL = 'https://tileserver.urbica.co/styles/positron/{z}/{x}/{y}.png'

export default function MapView({ onMapClick, selectedLat, selectedLon, blocks }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [TILE_URL],
            tileSize: 256,
            attribution: '© <a href="https://openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OSM</a>',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [100.5, 13.75],  // Bangkok
      zoom: 8,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-left')

    map.on('click', (e) => {
      onMapClick(e.lngLat.lat, e.lngLat.lng)
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Update marker
  useEffect(() => {
    if (!mapRef.current || !selectedLat || !selectedLon) return

    const map = mapRef.current

    if (markerRef.current) markerRef.current.remove()

    markerRef.current = new maplibregl.Marker({ color: '#C00000' })
      .setLngLat([selectedLon, selectedLat])
      .addTo(map)

    // Draw cell radius circle
    drawCellRadius(map, selectedLat, selectedLon, blocks)
  }, [selectedLat, selectedLon, blocks])

  // Draw FS links when blocks change
  useEffect(() => {
    if (!mapRef.current) return
    loadFSLinks(mapRef.current)
  }, [])

  return <div ref={containerRef} className="w-full h-full" />
}

function drawCellRadius(map: maplibregl.Map, lat: number, lon: number, blocks: BlockResult[]) {
  if (blocks.length === 0) return

  const sourceId = 'cell-radius'
  if (map.getSource(sourceId)) {
    map.removeLayer(`${sourceId}-fill`)
    map.removeSource(sourceId)
  }

  // 500m radius circle in degrees (approximation)
  const radiusDeg = 0.005  // ~500m at equator

  map.addSource(sourceId, {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [lon, lat],
      },
      properties: {},
    },
  })

  map.addLayer({
    id: `${sourceId}-fill`,
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': {
        stops: [[8, 20], [14, 200]],
        base: 2,
      },
      'circle-opacity': 0.2,
      'circle-color': '#C00000',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#C00000',
      'circle-stroke-opacity': 0.6,
    },
  })
}

async function loadFSLinks(map: maplibregl.Map) {
  try {
    const res = await fetch('/api/fs-links/')
    const data = await res.json()

    const features = data.links?.map((link: any) => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [link.rx.lon, link.rx.lat],
          [link.tx.lon, link.tx.lat],
        ],
      },
      properties: {
        name: link.name,
        operator: link.operator,
        freq: `${link.frequency.low}-${link.frequency.high} MHz`,
      },
    })) || []

    const sourceId = 'fs-links'
    if (map.getSource(sourceId)) {
      map.removeLayer(`${sourceId}-line`)
      map.removeSource(sourceId)
    }

    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    })

    map.addLayer({
      id: `${sourceId}-line`,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': '#1A365D',
        'line-width': 2,
        'line-dasharray': [4, 2],
        'line-opacity': 0.7,
      },
    })

    // Click popup
    map.on('click', `${sourceId}-line`, (e) => {
      if (!e.features?.[0]) return
      const p = e.features[0].properties
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family: Sarabun, sans-serif;">
            <strong>${p.name}</strong><br/>
            <span style="color:#6C757D;">${p.operator} | ${p.freq}</span>
          </div>
        `)
        .addTo(map)
    })

    map.on('mouseenter', `${sourceId}-line`, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', `${sourceId}-line`, () => {
      map.getCanvas().style.cursor = ''
    })
  } catch (err) {
    console.warn('Failed to load FS links:', err)
  }
}

export { drawCellRadius, loadFSLinks }
