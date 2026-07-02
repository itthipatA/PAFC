import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { BlockResult } from '../types'

interface MapViewProps {
  onMapClick: (lat: number, lon: number) => void
  selectedLat: number | null
  selectedLon: number | null
  blocks: BlockResult[]
  mapStyle: string
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

export default function MapView({ onMapClick, selectedLat, selectedLon, blocks, mapStyle }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)

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

  // Switch map style
  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current
    const source = map.getSource('basemap') as maplibregl.RasterTileSource
    if (!source) return

    const style = MAP_STYLES[mapStyle] || MAP_STYLES.positron
    source.setTiles([style.url])
  }, [mapStyle])

  // Update marker
  useEffect(() => {
    if (!mapRef.current || !selectedLat || !selectedLon) return

    const map = mapRef.current
    if (markerRef.current) markerRef.current.remove()

    markerRef.current = new maplibregl.Marker({ color: '#C00000' })
      .setLngLat([selectedLon, selectedLat])
      .addTo(map)

    drawCellRadius(map, selectedLat, selectedLon)
  }, [selectedLat, selectedLon])

  // Load FS links on init
  useEffect(() => {
    if (!mapRef.current) return
    loadFSLinks(mapRef.current)
  }, [])

  return <div ref={containerRef} className="w-full h-full" />
}

function drawCellRadius(map: maplibregl.Map, lat: number, lon: number) {
  const sourceId = 'cell-radius'
  if (map.getLayer(`${sourceId}-fill`)) map.removeLayer(`${sourceId}-fill`)
  if (map.getSource(sourceId)) map.removeSource(sourceId)

  map.addSource(sourceId, {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} },
  })

  map.addLayer({
    id: `${sourceId}-fill`,
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': { stops: [[8, 20], [14, 200]] },
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

    const features = (data.links || []).map((link: any) => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[link.rx.lon, link.rx.lat], [link.tx.lon, link.tx.lat]],
      },
      properties: {
        name: link.name,
        operator: link.operator,
        freq: `${link.frequency.low}-${link.frequency.high} MHz`,
      },
    }))

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

    map.on('click', `${sourceId}-line`, (e) => {
      if (!e.features?.[0]) return
      const p = e.features[0].properties
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`<div style="font-family:Sarabun,sans-serif"><strong>${p.name}</strong><br/><span style="color:#6C757D">${p.operator} | ${p.freq}</span></div>`)
        .addTo(map)
    })

    map.on('mouseenter', `${sourceId}-line`, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', `${sourceId}-line`, () => { map.getCanvas().style.cursor = '' })
  } catch (err) {
    console.warn('FS links not available:', err)
  }
}
