import { useState } from 'react'
import {
  Octagon,
  Trash2,
  Undo2,
  Download,
  X,
  Calculator,
  MapPin,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { Button } from './Button'

interface PolygonCreatorProps {
  onClose: () => void
  vertices: [number, number][]
  onVerticesChange: (vertices: [number, number][]) => void
  packResults: PackResult | null
  onPackResultsChange: (results: PackResult | null) => void
  drawingMode: boolean
  onDrawingModeChange: (mode: boolean) => void
  dashboardRefreshKey: number
  onDashboardRefresh: () => void
}

interface PackPoint {
  lat: number
  lon: number
  type: string
}

interface PackResult {
  points: PackPoint[]
  centroid: { lat: number; lon: number }
  coverage_pct: number
  num_required: number
  recommendation: string
  centroid_coverage_pct?: number
}

export default function PolygonCreator({
  onClose,
  vertices,
  onVerticesChange,
  packResults,
  onPackResultsChange,
  drawingMode,
  onDrawingModeChange,
}: PolygonCreatorProps) {
  const { fetchWithAuth } = useAuth()
  const [cellRadius, setCellRadius] = useState(500)
  const [calculating, setCalculating] = useState(false)
  const [calcError, setCalcError] = useState('')

  const isPolygonReady = vertices.length >= 3

  const handleClosePolygon = () => {
    if (vertices.length < 3) return
    const closed = [...vertices, vertices[0]] as [number, number][]
    onVerticesChange(closed)
  }

  const handleClear = () => {
    onVerticesChange([])
    onPackResultsChange(null)
    setCalcError('')
  }

  const handleUndo = () => {
    onVerticesChange(vertices.slice(0, -1))
    onPackResultsChange(null)
    setCalcError('')
  }

  const handleCalculate = async () => {
    if (!isPolygonReady) return
    setCalculating(true)
    setCalcError('')
    onPackResultsChange(null)

    try {
      const polygonCoords = [...vertices]
      if (
        polygonCoords[0][0] !== polygonCoords[polygonCoords.length - 1][0] ||
        polygonCoords[0][1] !== polygonCoords[polygonCoords.length - 1][1]
      ) {
        polygonCoords.push(polygonCoords[0])
      }

      const geoJSON = {
        type: 'Polygon' as const,
        coordinates: [polygonCoords],
      }

      const res = await fetchWithAuth('/api/polygon/pack-circles', {
        method: 'POST',
        body: JSON.stringify({
          polygon: geoJSON,
          cell_radius_m: cellRadius,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || 'การคำนวณล้มเหลว')
      }

      const data = await res.json()
      onPackResultsChange(data)
    } catch (err: any) {
      setCalcError(err.message || 'เกิดข้อผิดพลาดในการคำนวณ')
    } finally {
      setCalculating(false)
    }
  }

  const handleDownloadGeoJSON = () => {
    if (!isPolygonReady) return

    const polygonCoords = [...vertices]
    if (
      polygonCoords[0][0] !== polygonCoords[polygonCoords.length - 1][0] ||
      polygonCoords[0][1] !== polygonCoords[polygonCoords.length - 1][1]
    ) {
      polygonCoords.push(polygonCoords[0])
    }

    const feature = {
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [polygonCoords],
      },
      properties: { name: 'ที่ดิน' },
    }

    const blob = new Blob([JSON.stringify(feature, null, 2)], { type: 'application/geo+json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ที่ดิน.geojson'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleDownloadPackPoints = () => {
    if (!packResults || !packResults.points) return

    const blob = new Blob([JSON.stringify(packResults.points, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tower_positions.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <h2 className="text-base font-bold text-[#1A1A2E]">สร้างโพลีกอนที่ดิน</h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          title="ปิด"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Section 1: Polygon Drawing */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[#1A1A2E]">สร้างโพลีกอนที่ดิน</h3>
          <p className="text-xs text-gray-500">
            คลิกบนแผนที่เพื่อเพิ่มจุดมุมของที่ดิน กดปุ่ม ปิดรูป เพื่อปิด polygon
          </p>

          <div className="flex flex-wrap gap-2">
            {!drawingMode ? (
              <Button
                variant="primary"
                onClick={() => onDrawingModeChange(true)}
              >
                <MapPin className="w-4 h-4" />
                เริ่มวาด
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => onDrawingModeChange(false)}
              >
                <X className="w-4 h-4" />
                หยุดวาด
              </Button>
            )}

            <Button
              variant="secondary"
              disabled={vertices.length < 3}
              onClick={handleClosePolygon}
            >
              <Octagon className="w-4 h-4" />
              ปิดรูปหลายเหลี่ยม
            </Button>

            <Button
              variant="ghost"
              disabled={vertices.length === 0}
              onClick={handleUndo}
            >
              <Undo2 className="w-4 h-4" />
              ย้อนกลับ
            </Button>

            <Button
              variant="danger"
              disabled={vertices.length === 0}
              onClick={handleClear}
            >
              <Trash2 className="w-4 h-4" />
              ล้างทั้งหมด
            </Button>
          </div>

          <div className="text-sm text-gray-600">
            จำนวนจุด: <span className="font-bold text-[#C00000]">{vertices.length}</span>
          </div>
        </div>

        {/* Section 2: Coverage Calculation */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[#1A1A2E]">คำนวณความครอบคลุม</h3>

          <div className="space-y-2">
            <label className="text-xs text-gray-500">
              รัศมีครอบคลุม: {cellRadius} m
            </label>
            <input
              type="range"
              min={100}
              max={5000}
              step={100}
              value={cellRadius}
              onChange={(e) => setCellRadius(Number(e.target.value))}
              disabled={!isPolygonReady}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#C00000] disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>100 m</span>
              <span>5000 m</span>
            </div>
          </div>

          <Button
            variant="primary"
            disabled={!isPolygonReady || calculating}
            loading={calculating}
            onClick={handleCalculate}
          >
            <Calculator className="w-4 h-4" />
            คำนวณตำแหน่งเสา
          </Button>

          {calcError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {calcError}
            </div>
          )}
        </div>

        {/* Section 3: Results */}
        {packResults && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3 animate-fade-in-up">
            <h3 className="text-sm font-semibold text-[#1A1A2E]">ผลลัพธ์</h3>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="text-sm text-gray-700">
                ครอบคลุม{' '}
                <span className="font-bold text-[#16A34A]">
                  {packResults.coverage_pct.toFixed(1)}%
                </span>{' '}
                ของพื้นที่
              </div>
              <div className="text-sm text-gray-700">
                ใช้เสาสัญญาณ{' '}
                <span className="font-bold text-[#1A1A2E]">
                  {packResults.num_required}
                </span>{' '}
                ต้น
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    packResults.recommendation === 'single'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {packResults.recommendation === 'single' ? 'เสาเดียว' : 'หลายเสา'}
                </span>
              </div>
            </div>

            {/* Centroid info */}
            <div className="text-xs text-gray-500">
              จุดกึ่งกลางที่ดิน:{' '}
              {packResults.centroid.lat.toFixed(6)},{' '}
              {packResults.centroid.lon.toFixed(6)}
            </div>

            {/* Single tower recommendation */}
            {packResults.recommendation === 'single' &&
              packResults.centroid_coverage_pct != null && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="text-sm text-green-700">
                    ใช้งานเสาเดียวที่จุดกึ่งกลางได้ ครอบคลุม{' '}
                    <span className="font-bold">
                      {packResults.centroid_coverage_pct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
          </div>
        )}

        {/* Section 4: Download */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-semibold text-[#1A1A2E]">ดาวน์โหลด</h3>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!isPolygonReady}
              onClick={handleDownloadGeoJSON}
            >
              <Download className="w-4 h-4" />
              ดาวน์โหลดไฟล์ที่ดิน (GeoJSON)
            </Button>

            <Button
              variant="secondary"
              disabled={!packResults}
              onClick={handleDownloadPackPoints}
            >
              <Download className="w-4 h-4" />
              ดาวน์โหลดตำแหน่งเสา (JSON)
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
