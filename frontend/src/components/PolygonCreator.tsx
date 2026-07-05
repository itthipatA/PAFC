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
  view3D: boolean
  onView3DChange: (v: boolean) => void
  onParcelReady?: (data: {
    polygon: [number, number][]
    towers: { lat: number; lon: number }[]
    cell_radius_m: number
  }) => void
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
  cell_radius_m?: number
  _step?: number
  _total_steps?: number
  _action?: string
}

export default function PolygonCreator({
  onClose,
  vertices,
  onVerticesChange,
  packResults,
  onPackResultsChange,
  drawingMode,
  onDrawingModeChange,
  view3D,
  onView3DChange,
  onParcelReady,
}: PolygonCreatorProps) {
  const { fetchWithAuth } = useAuth()
  const [cellRadius, setCellRadius] = useState(500)
  const [calculating, setCalculating] = useState(false)
  const [calcError, setCalcError] = useState('')
  const [saveDialogType, setSaveDialogType] = useState<'polygon' | 'towers' | null>(null)
  const [saveFileName, setSaveFileName] = useState('')

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
          animate: true,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || 'การคำนวณล้มเหลว')
      }

      const data = await res.json()
      
      // Play animation steps
      if (data.steps && data.steps.length > 0) {
        const stepDelay = 350  // ms per step
        for (let i = 0; i < data.steps.length; i++) {
          const step = data.steps[i]
          setTimeout(() => {
            onPackResultsChange({
              ...data,
              points: step.points,
              coverage_pct: step.cov_pct,
              _step: i + 1,
              _total_steps: data.steps.length,
              _action: step.action,
            })
          }, i * stepDelay)
        }
        // After all steps, set final result
        setTimeout(() => {
          onPackResultsChange({ ...data, _step: data.steps.length, _total_steps: data.steps.length, _action: 'done' })
          setCalculating(false)
        }, data.steps.length * stepDelay)
      } else {
        onPackResultsChange(data)
        setCalculating(false)
      }

      // Notify parent for parcel mode integration
      onParcelReady?.({
        polygon: polygonCoords,
        towers: data.points.map((p: any) => ({ lat: p.lat, lon: p.lon })),
        cell_radius_m: cellRadius,
      })
    } catch (err: any) {
      setCalcError(err.message || 'เกิดข้อผิดพลาดในการคำนวณ')
    } finally {
      setCalculating(false)
    }
  }

  const handleDownloadGeoJSON = () => {
    if (!isPolygonReady) return
    setSaveFileName('ที่ดิน')
    setSaveDialogType('polygon')
  }

  const handleDownloadPackPoints = () => {
    if (!packResults || !packResults.points) return
    setSaveFileName('tower_positions')
    setSaveDialogType('towers')
  }

  const handleConfirmSave = () => {
    if (saveDialogType === 'polygon') {
      const polygonCoords = [...vertices]
      if (
        polygonCoords[0][0] !== polygonCoords[polygonCoords.length - 1][0] ||
        polygonCoords[0][1] !== polygonCoords[polygonCoords.length - 1][1]
      ) {
        polygonCoords.push(polygonCoords[0])
      }
      const feature = {
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [polygonCoords] },
        properties: { name: saveFileName || 'ที่ดิน' },
      }
      const blob = new Blob([JSON.stringify(feature, null, 2)], { type: 'application/geo+json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${saveFileName || 'ที่ดิน'}.geojson`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } else if (saveDialogType === 'towers' && packResults) {
      const blob = new Blob([JSON.stringify(packResults.points, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${saveFileName || 'tower_positions'}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
    setSaveDialogType(null)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <h2 className="text-base font-bold text-[#1A1A2E]">สร้างโพลีกอนที่ดิน</h2>
        <div className="flex items-center gap-2">
          {vertices.length >= 3 && (
            <button
              onClick={() => onView3DChange(!view3D)}
              className={view3D
                ? 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#C00000] text-white transition-colors'
                : 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors'}
              title={view3D ? 'กลับมุมมอง 2 มิติ' : 'แสดงแบบ 3 มิติ'}
            >
              {view3D ? '2D' : '3D'}
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            title="ปิด"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
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

          {/* Vertex coordinates */}
          {vertices.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-gray-500 mb-2">พิกัดจุดมุม</h4>
              <div className="max-h-[200px] overflow-y-auto border border-gray-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-gray-500 font-medium">มุม</th>
                      <th className="px-2 py-1.5 text-left text-gray-500 font-medium">ละติจูด</th>
                      <th className="px-2 py-1.5 text-left text-gray-500 font-medium">ลองจิจูด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {vertices.map((v, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-2 py-1 font-mono text-gray-400">{i + 1}</td>
                        <td className="px-2 py-1 font-mono text-gray-700">{v[1].toFixed(7)}</td>
                        <td className="px-2 py-1 font-mono text-gray-700">{v[0].toFixed(7)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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

            {/* Animation progress */}
            {packResults._step != null && packResults._total_steps != null && packResults._action !== 'done' && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>
                    {packResults._action === 'init' && 'กำลังวาง grid เริ่มต้น...'}
                    {packResults._action === 'remove' && 'กำลังหาวงกลมที่ไม่จำเป็น...'}
                    {packResults._action === 'gapfill' && 'กำลังเติมวงกลมให้ครอบคลุม...'}
                    {packResults._action === 'shift' && 'กำลังขยับวงกลม optimize coverage...'}
                  </span>
                  <span>{packResults._step}/{packResults._total_steps}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-[#C00000] h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${(packResults._step / packResults._total_steps) * 100}%` }}
                  />
                </div>
              </div>
            )}

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

      {/* Save Dialog Modal */}
      {saveDialogType && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 p-6 w-[320px] animate-scale-in">
            <h3 className="text-sm font-semibold text-[#1A1A2E] mb-4">
              {saveDialogType === 'polygon' ? 'บันทึกไฟล์ที่ดิน' : 'บันทึกตำแหน่งเสา'}
            </h3>
            <label className="text-xs text-gray-500 mb-1 block">ชื่อไฟล์</label>
            <input
              type="text"
              value={saveFileName}
              onChange={(e) => setSaveFileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirmSave()}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C00000]/30 focus:border-[#C00000]"
              placeholder="ระบุชื่อไฟล์..."
              autoFocus
            />
            <p className="text-[10px] text-gray-400 mt-1">
              .{saveDialogType === 'polygon' ? 'geojson' : 'json'}
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setSaveDialogType(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleConfirmSave}
                disabled={!saveFileName.trim()}
                className="px-4 py-2 text-sm bg-[#C00000] text-white rounded-lg hover:bg-[#8B0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                ดาวน์โหลด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
